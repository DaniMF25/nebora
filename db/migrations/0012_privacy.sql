-- 0012 — Datos personales de clientes: retención y anonimización.
--
-- * privacy_settings: plazo de conservación (días tras el fin de la reserva)
--   por organización. Solo owner/admin lo modifican (también en la política).
-- * Anonimizar una reserva borra nombre, teléfono, correo y comentarios y
--   conserva los datos no personales (fecha, comensales, mesas, estado).
-- * app.purge_rate_limits elimina huellas antiguas del límite de peticiones.

CREATE TABLE privacy_settings (
  organization_id         uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  customer_retention_days integer NOT NULL DEFAULT 365,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_settings_retention_check CHECK (customer_retention_days BETWEEN 30 AND 3650)
);
CREATE TRIGGER privacy_settings_updated_at BEFORE UPDATE ON privacy_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY privacy_settings_select ON privacy_settings FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY privacy_settings_insert ON privacy_settings FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY privacy_settings_update ON privacy_settings FOR UPDATE TO nebora_app
  USING (app.can_access_org(organization_id) AND app.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (app.can_access_org(organization_id) AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
GRANT SELECT, INSERT ON privacy_settings TO nebora_app;
GRANT UPDATE (customer_retention_days) ON privacy_settings TO nebora_app;

ALTER TABLE reservations
  ADD COLUMN anonymized_at timestamptz,
  ADD CONSTRAINT reservations_anonymized_check CHECK (
    anonymized_at IS NULL OR (customer_phone IS NULL AND customer_email IS NULL AND notes IS NULL)
  );
GRANT UPDATE (anonymized_at) ON reservations TO nebora_app;
CREATE INDEX reservations_org_ends_idx ON reservations (organization_id, ends_at) WHERE anonymized_at IS NULL;

CREATE FUNCTION app.purge_rate_limits(p_older_than_hours integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.rate_limit_hits WHERE hit_at < now() - make_interval(hours => p_older_than_hours);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION app.purge_rate_limits(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_rate_limits(integer) TO nebora_app;

-- La página pública informa del plazo de conservación.
DROP FUNCTION app.public_booking_info(text, text);
CREATE FUNCTION app.public_booking_info(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (establishment_id uuid, establishment_name text, organization_name text, timezone text,
               min_party smallint, max_party smallint, duration_minutes smallint, slot_interval_minutes smallint,
               min_notice_minutes integer, max_days_ahead smallint, auto_confirm boolean,
               customer_retention_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.id, e.name, o.name, e.timezone, s.min_party, s.max_party, s.duration_minutes, s.slot_interval_minutes,
         s.min_notice_minutes, s.max_days_ahead, s.auto_confirm, COALESCE(p.customer_retention_days, 365)
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.reservation_settings s ON s.establishment_id = e.id AND s.organization_id = e.organization_id
    LEFT JOIN public.privacy_settings p ON p.organization_id = o.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND s.public_enabled
$$;
REVOKE ALL ON FUNCTION app.public_booking_info(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_booking_info(text, text) TO nebora_app;

-- Anonimiza las reservas cuyo fin es anterior al plazo de conservación.
-- Llamada desde la aplicación: solo sobre la organización del contexto y por
-- owner/admin. Llamada desde el proceso programado (otro rol de conexión,
-- p. ej. el propietario del esquema): para la organización indicada.
CREATE FUNCTION app.anonymize_expired_reservations(p_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_days  integer;
  v_count integer;
BEGIN
  IF session_user = 'nebora_app'
     AND NOT (app.can_access_org(p_org) AND app.has_org_role(p_org, ARRAY['owner', 'admin'])) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE((SELECT customer_retention_days FROM public.privacy_settings WHERE organization_id = p_org), 365)
    INTO v_days;
  UPDATE public.reservations
     SET customer_name = 'Cliente anonimizado', customer_phone = NULL, customer_email = NULL, notes = NULL,
         anonymized_at = now()
   WHERE organization_id = p_org AND anonymized_at IS NULL
     AND ends_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (p_org, app.current_user_id(), 'privacy.retention_applied', 'organization', p_org,
            jsonb_build_object('anonymized', v_count, 'retentionDays', v_days));
  END IF;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION app.anonymize_expired_reservations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.anonymize_expired_reservations(uuid) TO nebora_app;
