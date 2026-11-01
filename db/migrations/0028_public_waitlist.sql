-- 0028 — Lista de espera desde la web (D-042).
--
-- Cuando no quedan horas online, el cliente puede apuntarse a la lista de
-- espera del día: franja deseada, comensales, contacto y consentimiento. Igual
-- que la reserva pública, solo funciona con la reserva online activada, aplica
-- las reglas del local en la BD y es idempotente por clave del formulario.

ALTER TABLE waitlist_entries
  ADD COLUMN source text NOT NULL DEFAULT 'staff',
  ADD COLUMN consent_at timestamptz,
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT waitlist_source_check CHECK (source IN ('staff', 'public')),
  ADD CONSTRAINT waitlist_public_consent CHECK (source <> 'public' OR consent_at IS NOT NULL),
  ADD CONSTRAINT waitlist_key_length CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100);
CREATE UNIQUE INDEX waitlist_idempotency_unique ON waitlist_entries (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION app.public_join_waitlist(
  p_establishment uuid, p_date date, p_window_start integer, p_window_end integer, p_party integer,
  p_name text, p_phone text, p_email text, p_notes text, p_key text)
RETURNS TABLE (entry_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  s     public.reservation_settings%ROWTYPE;
  v_id  uuid;
  v_today date;
BEGIN
  SELECT * INTO s FROM public.reservation_settings WHERE establishment_id = p_establishment;
  IF NOT FOUND OR NOT s.public_enabled THEN
    RAISE EXCEPTION 'public_booking_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT w.id INTO v_id FROM public.waitlist_entries w
   WHERE w.organization_id = s.organization_id AND w.idempotency_key = p_key AND w.source = 'public';
  IF FOUND THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  IF p_party < s.min_party OR p_party > s.max_party THEN
    RAISE EXCEPTION 'party_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  SELECT (now() AT TIME ZONE e.timezone)::date INTO v_today
    FROM public.establishments e WHERE e.id = p_establishment;
  IF p_date < v_today OR p_date > v_today + s.max_days_ahead THEN
    RAISE EXCEPTION 'outside_booking_window' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.waitlist_entries (organization_id, establishment_id, desired_date, window_start_minute,
                                       window_end_minute, party_size, customer_name, customer_phone,
                                       customer_email, notes, source, consent_at, idempotency_key)
  VALUES (s.organization_id, p_establishment, p_date, p_window_start, p_window_end, p_party,
          p_name, p_phone, p_email, p_notes, 'public', now(), p_key)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (s.organization_id, NULL, 'waitlist.joined_public', 'waitlist_entry', v_id,
          jsonb_build_object('partySize', p_party));
  RETURN QUERY SELECT v_id, false;
END
$$;
REVOKE ALL ON FUNCTION app.public_join_waitlist(uuid, date, integer, integer, integer, text, text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_join_waitlist(uuid, date, integer, integer, integer, text, text, text, text, text)
  TO nebora_app;
