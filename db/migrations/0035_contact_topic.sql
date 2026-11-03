-- 0035 — Motivo del mensaje de contacto (D-052): reserva de grupo, evento,
-- alergias u otra consulta. Opcional; la bandeja del panel lo muestra.

ALTER TABLE contact_messages
  ADD COLUMN topic text,
  ADD CONSTRAINT contact_messages_topic_check CHECK (topic IS NULL OR topic IN ('group', 'event', 'allergies', 'other'));

DROP FUNCTION app.public_contact(uuid, text, text, text, text, text);
CREATE FUNCTION app.public_contact(
  p_establishment uuid, p_name text, p_email text, p_phone text, p_message text, p_key text, p_topic text)
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
                                       customer_phone, message, consent_at, idempotency_key, topic)
  VALUES (v_org, p_establishment, p_name, p_email, p_phone, p_message, now(), p_key, p_topic)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_org, NULL, 'contact.received', 'contact_message', v_id, jsonb_build_object('topic', p_topic));
  RETURN QUERY SELECT v_id, false;
END
$$;
REVOKE ALL ON FUNCTION app.public_contact(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_contact(uuid, text, text, text, text, text, text) TO nebora_app;
