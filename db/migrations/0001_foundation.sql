-- 0001 — Fundación: identidad, organizaciones, establecimientos, membresías,
-- auditoría y aislamiento multiempresa con Row Level Security (RLS).
--
-- Modelo de confianza:
--   * Las tablas pertenecen al rol que ejecuta las migraciones (propietario).
--   * La aplicación se conecta como `nebora_app`: sin SUPERUSER, sin BYPASSRLS y
--     sin ser propietaria de las tablas, por lo que RLS se aplica siempre.
--   * En cada transacción la aplicación fija `app.user_id` (usuario autenticado
--     por el servidor) y, si opera dentro de una organización, `app.org_id`.
--   * RLS es defensa en profundidad frente a errores de consulta; la autorización
--     por permisos se comprueba además en la capa de servicios.

CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nebora_app') THEN
    CREATE ROLE nebora_app NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO nebora_app;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Contexto de la transacción. Valores vacíos o ausentes se tratan como NULL,
-- lo que hace que todas las políticas denieguen el acceso.
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Identidad (global, no pertenece a ninguna organización)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 120)
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- El identificador es el SHA-256 (hex) del token; el token en claro solo existe
-- en la cookie del cliente.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CONSTRAINT sessions_id_format CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Intentos de inicio de sesión para limitar la fuerza bruta por cuenta.
CREATE TABLE auth_login_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        citext NOT NULL,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_login_attempts_email_time_idx ON auth_login_attempts (email, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- Organizaciones y membresías
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT organizations_slug_format CHECK (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$')
);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            text NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
  CONSTRAINT memberships_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT memberships_org_user_unique UNIQUE (organization_id, user_id)
);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Funciones de comprobación de membresía. Son SECURITY DEFINER para poder
-- consultar `memberships` sin recursión de políticas; solo devuelven booleanos
-- y siempre se evalúan para el usuario del contexto, nunca para uno arbitrario.
CREATE FUNCTION app.is_member(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
    WHERE m.organization_id = p_org
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND u.status = 'active'
  )
$$;

CREATE FUNCTION app.has_org_role(p_org uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
    WHERE m.organization_id = p_org
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND u.status = 'active'
      AND m.role = ANY (p_roles)
  )
$$;

-- Acceso de organización activo: la organización del contexto coincide con la
-- fila y el usuario del contexto es miembro activo.
CREATE FUNCTION app.can_access_org(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_org IS NOT NULL
     AND p_org = app.current_org_id()
     AND app.is_member(p_org)
$$;

-- Crear una organización y la membresía de propietario de forma atómica. Es la
-- única vía de alta de organizaciones para el rol de aplicación.
CREATE FUNCTION app.create_organization(p_name text, p_slug text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_org  uuid;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = v_user AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'authenticated active user required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (name, slug) VALUES (p_name, p_slug)
  RETURNING id INTO v_org;

  INSERT INTO public.memberships (organization_id, user_id, role)
  VALUES (v_org, v_user, 'owner');

  RETURN v_org;
END
$$;

-- ---------------------------------------------------------------------------
-- Establecimientos
-- ---------------------------------------------------------------------------

CREATE TABLE establishments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            citext NOT NULL,
  timezone        text NOT NULL DEFAULT 'Europe/Madrid',
  address         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT establishments_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT establishments_slug_format CHECK (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'),
  CONSTRAINT establishments_address_length CHECK (address IS NULL OR char_length(address) <= 300),
  CONSTRAINT establishments_org_slug_unique UNIQUE (organization_id, slug),
  -- Permite FKs compuestas (organization_id, establishment_id) en tablas hijas,
  -- que impiden relacionar filas de organizaciones distintas.
  CONSTRAINT establishments_org_id_unique UNIQUE (organization_id, id)
);
CREATE TRIGGER establishments_updated_at BEFORE UPDATE ON establishments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auditoría (solo inserción y lectura para la aplicación)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_action_format CHECK (action ~ '^[a-z_]+\.[a-z_]+$')
);
CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events   ENABLE ROW LEVEL SECURITY;

-- organizations: lectura si es miembro (también fuera del contexto de una
-- organización, para listar las propias); modificación solo en contexto y por
-- owner/admin. Sin políticas de INSERT/DELETE: se deniegan.
CREATE POLICY organizations_select ON organizations FOR SELECT TO nebora_app
  USING (app.is_member(id));
CREATE POLICY organizations_update ON organizations FOR UPDATE TO nebora_app
  USING (app.can_access_org(id) AND app.has_org_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (app.can_access_org(id) AND app.has_org_role(id, ARRAY['owner', 'admin']));

-- memberships: el usuario ve las suyas; dentro de una organización ve las de
-- sus compañeros. Solo owner/admin escriben.
CREATE POLICY memberships_select ON memberships FOR SELECT TO nebora_app
  USING (user_id = app.current_user_id() OR app.can_access_org(organization_id));
CREATE POLICY memberships_insert ON memberships FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id)
              AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY memberships_update ON memberships FOR UPDATE TO nebora_app
  USING (app.can_access_org(organization_id)
         AND app.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (app.can_access_org(organization_id)
              AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY memberships_delete ON memberships FOR DELETE TO nebora_app
  USING (app.can_access_org(organization_id)
         AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));

CREATE POLICY establishments_all ON establishments FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id))
  WITH CHECK (app.can_access_org(organization_id));

CREATE POLICY audit_events_select ON audit_events FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id)
              AND (actor_user_id IS NULL OR actor_user_id = app.current_user_id()));

-- ---------------------------------------------------------------------------
-- Privilegios del rol de aplicación (mínimo privilegio)
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

GRANT SELECT, INSERT ON users TO nebora_app;
GRANT UPDATE (display_name, password_hash, status) ON users TO nebora_app;
GRANT SELECT, INSERT, DELETE ON sessions TO nebora_app;
GRANT UPDATE (last_seen_at, expires_at, revoked_at) ON sessions TO nebora_app;
GRANT SELECT, INSERT, DELETE ON auth_login_attempts TO nebora_app;

GRANT SELECT ON organizations TO nebora_app;
GRANT UPDATE (name) ON organizations TO nebora_app;
GRANT SELECT, INSERT, DELETE ON memberships TO nebora_app;
GRANT UPDATE (role, status) ON memberships TO nebora_app;
GRANT SELECT, INSERT, DELETE ON establishments TO nebora_app;
GRANT UPDATE (name, slug, timezone, address) ON establishments TO nebora_app;
GRANT SELECT, INSERT ON audit_events TO nebora_app;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO nebora_app;
GRANT EXECUTE ON FUNCTION app.current_org_id() TO nebora_app;
GRANT EXECUTE ON FUNCTION app.is_member(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.has_org_role(uuid, text[]) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.can_access_org(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.create_organization(text, text) TO nebora_app;
