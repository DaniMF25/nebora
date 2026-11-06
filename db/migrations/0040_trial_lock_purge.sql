-- 0040 — Fin de la prueba: bloqueo, 15 días de web y borrado (D-068).
--
-- Cuando termina la prueba sin haber elegido plan (o se crea una organización
-- sin prueba), la organización queda bloqueada (locked_at): el panel solo deja
-- elegir plan. La web y la carta siguen visibles 15 días; después, si sigue
-- bloqueada, la organización se borra con todos sus datos
-- (app.purge_locked_organizations). Las cuentas de usuario no se borran: pueden
-- pertenecer a otras organizaciones.

ALTER TABLE organizations ADD COLUMN locked_at timestamptz;
CREATE INDEX organizations_locked_idx ON organizations (locked_at) WHERE locked_at IS NOT NULL;
-- La aplicación bloquea al crear sin prueba y desbloquea al elegir plan.
GRANT UPDATE (locked_at) ON organizations TO nebora_app;

-- La aplicación solo puede quitar el bloqueo o ponerlo con la hora actual:
-- nunca fecharlo en el pasado para adelantar el borrado de una organización.
CREATE FUNCTION app.check_organization_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user = 'nebora_app' AND NEW.locked_at IS NOT NULL
     AND NEW.locked_at IS DISTINCT FROM OLD.locked_at AND NEW.locked_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'bloqueo con fecha no permitida' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'organizations_lock_now';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER organizations_lock_now BEFORE UPDATE OF locked_at ON organizations
  FOR EACH ROW EXECUTE FUNCTION app.check_organization_lock();

-- Constancia de las organizaciones borradas, sin datos de nadie (ni nombre).
CREATE TABLE purged_organizations (
  id          uuid PRIMARY KEY,
  locked_at   timestamptz NOT NULL,
  purged_at   timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON purged_organizations FROM PUBLIC;

-- Al vencer la prueba: plan Básico (aspecto y permisos mínimos), reserva online
-- desactivada, invitaciones anuladas y bloqueada hasta que se elija plan.
CREATE OR REPLACE FUNCTION app.expire_trials() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    SELECT id FROM public.organizations WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now() FOR UPDATE SKIP LOCKED
  ), booking AS (
    UPDATE public.reservation_settings s SET public_enabled = false
      FROM expired e WHERE s.organization_id = e.id AND s.public_enabled
  ), invitations AS (
    UPDATE public.invitations i SET revoked_at = now()
      FROM expired e WHERE i.organization_id = e.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
  )
  UPDATE public.organizations o SET plan = 'basic', trial_ends_at = NULL, locked_at = coalesce(o.locked_at, now())
    FROM expired e WHERE o.id = e.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- Borra por completo una organización y todo lo que depende de ella. Recorre
-- todas las tablas con organization_id y repite mientras alguna fila dependa de
-- otra (claves compuestas sin cascada): así no hay que mantener una lista a mano
-- y ninguna tabla nueva se queda fuera. Solo la llama purge_locked_organizations.
CREATE FUNCTION app.purge_organization(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tables text[];
  v_pending text[];
  v_table text;
  v_pass integer := 0;
BEGIN
  SELECT array_agg(format('%I.%I', c.table_schema, c.table_name) ORDER BY c.table_name)
    INTO v_tables
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE';
  v_pending := v_tables;
  WHILE cardinality(v_pending) > 0 LOOP
    v_pass := v_pass + 1;
    IF v_pass > 50 THEN
      RAISE EXCEPTION 'No se pudo borrar la organización %: quedan %', p_org, v_pending;
    END IF;
    v_tables := v_pending;
    v_pending := '{}';
    FOREACH v_table IN ARRAY v_tables LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE organization_id = $1', v_table) USING p_org;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Otra tabla aún apunta a estas filas: se reintenta en la siguiente vuelta.
        v_pending := v_pending || v_table;
      END;
    END LOOP;
  END LOOP;
  DELETE FROM public.organizations WHERE id = p_org;
END
$$;
REVOKE ALL ON FUNCTION app.purge_organization(uuid) FROM PUBLIC;

-- Borra las organizaciones que llevan más de 15 días bloqueadas. Devuelve cuántas.
CREATE FUNCTION app.purge_locked_organizations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id, locked_at FROM public.organizations
     WHERE locked_at IS NOT NULL AND locked_at <= now() - interval '15 days'
     FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.purged_organizations (id, locked_at) VALUES (r.id, r.locked_at) ON CONFLICT (id) DO NOTHING;
    PERFORM app.purge_organization(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION app.purge_locked_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_locked_organizations() TO nebora_app;
