-- 0015 — Lista de espera de reservas.
--
-- * Una entrada indica día, franja horaria deseada (hora local del local),
--   comensales y contacto. Al convertirse en reserva queda enlazada a ella.
-- * Son datos personales de clientes: entran en la retención (anonimización
--   tras el plazo, contado desde el día deseado), la exportación y el borrado.

CREATE TABLE waitlist_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  establishment_id    uuid NOT NULL,
  desired_date        date NOT NULL,
  window_start_minute smallint NOT NULL,
  window_end_minute   smallint NOT NULL,
  party_size          smallint NOT NULL,
  customer_name       text NOT NULL,
  customer_phone      text,
  customer_email      text,
  notes               text,
  status              text NOT NULL DEFAULT 'waiting',
  reservation_id      uuid,
  created_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  anonymized_at       timestamptz,
  CONSTRAINT waitlist_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT waitlist_reservation_fk FOREIGN KEY (organization_id, establishment_id, reservation_id)
    REFERENCES reservations (organization_id, establishment_id, id) ON DELETE RESTRICT,
  CONSTRAINT waitlist_window_check
    CHECK (window_start_minute BETWEEN 0 AND 1439 AND window_end_minute > window_start_minute
           AND window_end_minute <= 1440),
  CONSTRAINT waitlist_party_check CHECK (party_size BETWEEN 1 AND 100),
  CONSTRAINT waitlist_status_check CHECK (status IN ('waiting', 'converted', 'cancelled')),
  CONSTRAINT waitlist_converted_check CHECK ((status = 'converted') = (reservation_id IS NOT NULL)),
  CONSTRAINT waitlist_name_length CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  CONSTRAINT waitlist_phone_length CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 40),
  CONSTRAINT waitlist_email_length CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  CONSTRAINT waitlist_notes_length CHECK (notes IS NULL OR char_length(notes) <= 300),
  -- Sin forma de contacto no se puede avisar; tras anonimizar ya no hay contacto.
  CONSTRAINT waitlist_contact_check CHECK (
    anonymized_at IS NOT NULL OR customer_phone IS NOT NULL OR customer_email IS NOT NULL
  ),
  CONSTRAINT waitlist_anonymized_check CHECK (
    anonymized_at IS NULL OR (customer_phone IS NULL AND customer_email IS NULL AND notes IS NULL)
  ),
  CONSTRAINT waitlist_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX waitlist_day_idx ON waitlist_entries (organization_id, establishment_id, desired_date);
CREATE UNIQUE INDEX waitlist_reservation_unique ON waitlist_entries (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE TRIGGER waitlist_entries_updated_at BEFORE UPDATE ON waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY waitlist_entries_all ON waitlist_entries FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT ON waitlist_entries TO nebora_app;
GRANT UPDATE (status, reservation_id, customer_name, customer_phone, customer_email, notes, anonymized_at)
  ON waitlist_entries TO nebora_app;

-- La retención también anonimiza la lista de espera (plazo contado desde el día deseado).
CREATE OR REPLACE FUNCTION app.anonymize_expired_reservations(p_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_days     integer;
  v_count    integer;
  v_waitlist integer;
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
  UPDATE public.waitlist_entries
     SET customer_name = 'Cliente anonimizado', customer_phone = NULL, customer_email = NULL, notes = NULL,
         status = CASE WHEN status = 'waiting' THEN 'cancelled' ELSE status END, anonymized_at = now()
   WHERE organization_id = p_org AND anonymized_at IS NULL
     AND desired_date < (now() - make_interval(days => v_days))::date;
  GET DIAGNOSTICS v_waitlist = ROW_COUNT;
  IF v_count + v_waitlist > 0 THEN
    INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (p_org, app.current_user_id(), 'privacy.retention_applied', 'organization', p_org,
            jsonb_build_object('anonymized', v_count, 'waitlistAnonymized', v_waitlist, 'retentionDays', v_days));
  END IF;
  RETURN v_count + v_waitlist;
END
$$;
