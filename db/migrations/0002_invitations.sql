-- 0002 — Invitaciones a organizaciones.
--
-- El token de invitación (256 bits) solo existe en el enlace que se entrega al
-- invitado; aquí se guarda su SHA-256. Cada invitación está ligada a un correo,
-- caduca y solo puede aceptarse una vez. No se puede invitar como propietario.

CREATE TABLE invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email               citext NOT NULL,
  role                text NOT NULL,
  token_hash          text NOT NULL UNIQUE,
  invited_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  accepted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at          timestamptz,
  CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'manager', 'staff')),
  CONSTRAINT invitations_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invitations_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT invitations_single_outcome CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
-- Como máximo una invitación abierta por correo y organización.
CREATE UNIQUE INDEX invitations_open_unique ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_org_idx ON invitations (organization_id, created_at DESC);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Solo owner/admin de la organización del contexto gestionan invitaciones.
CREATE POLICY invitations_select ON invitations FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id)
         AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY invitations_insert ON invitations FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id)
              AND app.has_org_role(organization_id, ARRAY['owner', 'admin'])
              AND invited_by_user_id = app.current_user_id());
CREATE POLICY invitations_update ON invitations FOR UPDATE TO nebora_app
  USING (app.can_access_org(organization_id)
         AND app.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (app.can_access_org(organization_id)
              AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));

GRANT SELECT, INSERT ON invitations TO nebora_app;
GRANT UPDATE (revoked_at) ON invitations TO nebora_app;

-- Vista mínima de una invitación a partir del hash de su token, para la
-- página de aceptación (el invitado aún no es miembro y RLS no le deja verla).
-- Quien conoce el token ya tiene derecho a estos datos.
CREATE FUNCTION app.invitation_by_token(p_token_hash text)
RETURNS TABLE (organization_name text, email text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.name,
         i.email::text,
         i.role,
         CASE
           WHEN i.accepted_at IS NOT NULL THEN 'accepted'
           WHEN i.revoked_at IS NOT NULL THEN 'revoked'
           WHEN i.expires_at <= now() THEN 'expired'
           ELSE 'pending'
         END
    FROM public.invitations i
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash
$$;

-- Acepta una invitación para el usuario del contexto. Bloquea la fila para que
-- dos aceptaciones simultáneas no puedan usar el mismo token.
CREATE FUNCTION app.accept_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user  uuid := app.current_user_id();
  v_email citext;
  v_inv   public.invitations%ROWTYPE;
BEGIN
  SELECT email INTO v_email FROM public.users WHERE id = v_user AND status = 'active';
  IF v_user IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'authenticated active user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.invitations
   WHERE token_hash = p_token_hash
     FOR UPDATE;

  IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL
     OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.email <> v_email THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships
              WHERE organization_id = v_inv.organization_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.memberships (organization_id, user_id, role)
  VALUES (v_inv.organization_id, v_user, v_inv.role);

  UPDATE public.invitations
     SET accepted_at = now(), accepted_by_user_id = v_user
   WHERE id = v_inv.id;

  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_inv.organization_id, v_user, 'invitation.accepted', 'invitation', v_inv.id,
          jsonb_build_object('role', v_inv.role));

  RETURN v_inv.organization_id;
END
$$;

REVOKE ALL ON FUNCTION app.invitation_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_by_token(text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.accept_invitation(text) TO nebora_app;

-- Las funciones futuras del esquema app no serán ejecutables por PUBLIC por defecto.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
