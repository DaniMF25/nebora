-- 0033 — Mensajes del formulario de contacto de la web (D-049).
--
-- * Sin proveedor de correo, los mensajes llegan a una bandeja del panel.
-- * Son datos personales de clientes: consentimiento obligatorio y entran en
--   la retención (anonimización tras el plazo), la exportación y el borrado.
-- * El alta pública solo es posible con la web publicada y plan Avanzado o
--   superior (app.public_contact, SECURITY DEFINER); idempotente por clave.
-- * RLS con el acceso por local (D-031).

CREATE TABLE contact_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  customer_name    text NOT NULL,
  customer_email   text,
  customer_phone   text,
  message          text,
  status           text NOT NULL DEFAULT 'new',
  consent_at       timestamptz,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  anonymized_at    timestamptz,
  CONSTRAINT contact_messages_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT contact_messages_status_check CHECK (status IN ('new', 'read', 'archived')),
  CONSTRAINT contact_messages_name_length CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  CONSTRAINT contact_messages_email_length CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  CONSTRAINT contact_messages_phone_length CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 40),
  CONSTRAINT contact_messages_message_length CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 2000),
  CONSTRAINT contact_messages_key_length CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100),
  -- Sin consentimiento no se guarda; sin contacto no se puede responder (salvo ya anonimizado).
  CONSTRAINT contact_messages_consent_check CHECK (anonymized_at IS NOT NULL OR consent_at IS NOT NULL),
  CONSTRAINT contact_messages_contact_check CHECK (
    anonymized_at IS NOT NULL OR customer_email IS NOT NULL OR customer_phone IS NOT NULL
  ),
  CONSTRAINT contact_messages_anonymized_check CHECK (
    anonymized_at IS NULL OR (customer_email IS NULL AND customer_phone IS NULL AND message IS NULL)
  ),
  CONSTRAINT contact_messages_message_present CHECK (anonymized_at IS NOT NULL OR message IS NOT NULL)
);
CREATE INDEX contact_messages_inbox_idx ON contact_messages (organization_id, establishment_id, created_at DESC);
CREATE UNIQUE INDEX contact_messages_idempotency_unique ON contact_messages (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_messages_all ON contact_messages FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
-- La aplicación no inserta directamente (solo app.public_contact): lee, marca y borra.
GRANT SELECT, DELETE ON contact_messages TO nebora_app;
GRANT UPDATE (status, read_at, customer_name, customer_email, customer_phone, message, anonymized_at)
  ON contact_messages TO nebora_app;

-- Alta desde la web pública: solo con la web publicada y plan Avanzado o superior.
CREATE FUNCTION app.public_contact(
  p_establishment uuid, p_name text, p_email text, p_phone text, p_message text, p_key text)
RETURNS TABLE (message_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  v_org  uuid;
  v_id   uuid;
BEGIN
  SELECT e.organization_id INTO v_org
    FROM public.establishments e
    JOIN public.organizations o ON o.id = e.organization_id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
   WHERE e.id = p_establishment AND p.published AND o.plan IN ('advanced', 'pro');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.id INTO v_id FROM public.contact_messages m
   WHERE m.organization_id = v_org AND m.idempotency_key = p_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  INSERT INTO public.contact_messages (organization_id, establishment_id, customer_name, customer_email,
                                       customer_phone, message, consent_at, idempotency_key)
  VALUES (v_org, p_establishment, p_name, p_email, p_phone, p_message, now(), p_key)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_org, NULL, 'contact.received', 'contact_message', v_id, '{}'::jsonb);
  RETURN QUERY SELECT v_id, false;
END
$$;
REVOKE ALL ON FUNCTION app.public_contact(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_contact(uuid, text, text, text, text, text) TO nebora_app;

-- La retención también anonimiza los mensajes (plazo contado desde su llegada).
CREATE OR REPLACE FUNCTION app.anonymize_expired_reservations(p_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_days     integer;
  v_count    integer;
  v_waitlist integer;
  v_messages integer;
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
  UPDATE public.contact_messages
     SET customer_name = 'Cliente anonimizado', customer_phone = NULL, customer_email = NULL, message = NULL,
         anonymized_at = now()
   WHERE organization_id = p_org AND anonymized_at IS NULL
     AND created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_messages = ROW_COUNT;
  IF v_count + v_waitlist + v_messages > 0 THEN
    INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (p_org, app.current_user_id(), 'privacy.retention_applied', 'organization', p_org,
            jsonb_build_object('anonymized', v_count, 'waitlistAnonymized', v_waitlist,
                               'messagesAnonymized', v_messages, 'retentionDays', v_days));
  END IF;
  RETURN v_count + v_waitlist + v_messages;
END
$$;

-- Plazo de conservación de datos de clientes de la organización de un local,
-- para el texto de consentimiento de la página de contacto (sin sesión).
CREATE FUNCTION app.public_retention_days(p_establishment_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT ps.customer_retention_days FROM public.privacy_settings ps
                    WHERE ps.organization_id = e.organization_id), 365)
    FROM public.establishments e WHERE e.id = p_establishment_id
$$;
REVOKE ALL ON FUNCTION app.public_retention_days(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_retention_days(uuid) TO nebora_app;
