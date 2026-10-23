-- 0011 — Reservas públicas desde la web.
--
-- La ruta pública no tiene usuario ni organización en el contexto, así que
-- RLS no le da acceso a nada. Solo puede usar funciones SECURITY DEFINER
-- estrechas que:
--   * únicamente funcionan si el establecimiento tiene la reserva pública
--     activada;
--   * devuelven lo mínimo (horario, capacidades de mesa, intervalos ocupados)
--     y nunca datos de otros clientes;
--   * crean la reserva aplicando en BD las reglas del establecimiento y la
--     exclusión por mesa (asignación automática con reintento en la siguiente
--     mesa candidata si otra petición la ocupó a la vez).
-- La comprobación del horario de apertura (zona horaria, cambios de hora) la
-- hace el servidor antes de llamar a app.public_book.

CREATE TABLE reservation_settings (
  establishment_id      uuid PRIMARY KEY,
  organization_id       uuid NOT NULL,
  public_enabled        boolean NOT NULL DEFAULT false,
  min_party             smallint NOT NULL DEFAULT 1,
  max_party             smallint NOT NULL DEFAULT 8,
  duration_minutes      smallint NOT NULL DEFAULT 90,
  slot_interval_minutes smallint NOT NULL DEFAULT 15,
  min_notice_minutes    integer NOT NULL DEFAULT 120,
  max_days_ahead        smallint NOT NULL DEFAULT 30,
  auto_confirm          boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_settings_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT reservation_settings_party_check CHECK (min_party >= 1 AND max_party >= min_party AND max_party <= 50),
  CONSTRAINT reservation_settings_duration_check CHECK (duration_minutes BETWEEN 30 AND 300),
  CONSTRAINT reservation_settings_interval_check CHECK (slot_interval_minutes IN (15, 30, 60)),
  CONSTRAINT reservation_settings_notice_check CHECK (min_notice_minutes BETWEEN 0 AND 10080),
  CONSTRAINT reservation_settings_window_check CHECK (max_days_ahead BETWEEN 1 AND 365)
);
CREATE TRIGGER reservation_settings_updated_at BEFORE UPDATE ON reservation_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE reservation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservation_settings_all ON reservation_settings FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT ON reservation_settings TO nebora_app;
GRANT UPDATE (public_enabled, min_party, max_party, duration_minutes, slot_interval_minutes,
              min_notice_minutes, max_days_ahead, auto_confirm) ON reservation_settings TO nebora_app;

ALTER TABLE reservations
  ADD COLUMN source text NOT NULL DEFAULT 'staff',
  ADD COLUMN public_code text,
  ADD COLUMN consent_at timestamptz,
  ADD CONSTRAINT reservations_source_check CHECK (source IN ('staff', 'public')),
  ADD CONSTRAINT reservations_public_code_format CHECK (public_code IS NULL OR public_code ~ '^[0-9A-F]{10}$'),
  ADD CONSTRAINT reservations_public_consent CHECK (source <> 'public' OR (consent_at IS NOT NULL AND public_code IS NOT NULL)),
  ADD CONSTRAINT reservations_public_code_unique UNIQUE (public_code);

-- ---------------------------------------------------------------------------
-- Límite de peticiones (sin datos personales en claro: el servidor envía
-- identificadores ya resumidos con hash).
-- ---------------------------------------------------------------------------

CREATE TABLE rate_limit_hits (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_hits_bucket_length CHECK (char_length(bucket) BETWEEN 1 AND 200)
);
CREATE INDEX rate_limit_hits_bucket_time_idx ON rate_limit_hits (bucket, hit_at);
-- Sin políticas ni privilegios: solo accesible mediante app.rate_limit_hit.
ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;

-- Registra un intento y devuelve false si se supera el máximo en la ventana.
CREATE FUNCTION app.rate_limit_hit(p_bucket text, p_window_seconds integer, p_max integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rate:' || p_bucket));
  DELETE FROM public.rate_limit_hits
   WHERE bucket = p_bucket AND hit_at < now() - make_interval(secs => p_window_seconds);
  SELECT count(*) INTO v_count FROM public.rate_limit_hits WHERE bucket = p_bucket;
  IF v_count >= p_max THEN
    RETURN false;
  END IF;
  INSERT INTO public.rate_limit_hits (bucket) VALUES (p_bucket);
  RETURN true;
END
$$;

-- ---------------------------------------------------------------------------
-- Lectura pública mínima
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.public_booking_info(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (establishment_id uuid, establishment_name text, organization_name text, timezone text,
               min_party smallint, max_party smallint, duration_minutes smallint, slot_interval_minutes smallint,
               min_notice_minutes integer, max_days_ahead smallint, auto_confirm boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.id, e.name, o.name, e.timezone, s.min_party, s.max_party, s.duration_minutes, s.slot_interval_minutes,
         s.min_notice_minutes, s.max_days_ahead, s.auto_confirm
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.reservation_settings s ON s.establishment_id = e.id AND s.organization_id = e.organization_id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND s.public_enabled
$$;

CREATE FUNCTION app.public_enabled(p_establishment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.reservation_settings WHERE establishment_id = p_establishment AND public_enabled)
$$;

CREATE FUNCTION app.public_opening_hours(p_establishment uuid)
RETURNS TABLE (weekday smallint, opens_minute smallint, duration_minutes smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT h.weekday, h.opens_minute, h.duration_minutes FROM public.opening_hours h
   WHERE h.establishment_id = p_establishment AND app.public_enabled(p_establishment)
$$;

CREATE FUNCTION app.public_schedule_exceptions(p_establishment uuid, p_from date, p_to date)
RETURNS TABLE (date text, closed boolean, slots jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT to_char(e.date, 'YYYY-MM-DD'), e.closed,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('opensMinute', s.opens_minute, 'durationMinutes', s.duration_minutes))
                     FROM public.schedule_exception_slots s WHERE s.exception_id = e.id), '[]'::jsonb)
    FROM public.schedule_exceptions e
   WHERE e.establishment_id = p_establishment AND e.date BETWEEN p_from AND p_to
     AND app.public_enabled(p_establishment)
$$;

CREATE FUNCTION app.public_tables(p_establishment uuid)
RETURNS TABLE (id uuid, min_capacity smallint, max_capacity smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT t.id, t.min_capacity, t.max_capacity FROM public.dining_tables t
   WHERE t.establishment_id = p_establishment AND t.active AND app.public_enabled(p_establishment)
$$;

-- Intervalos ocupados por mesa (sin ningún dato de las reservas).
CREATE FUNCTION app.public_busy(p_establishment uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (table_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT rt.table_id, lower(rt.during), upper(rt.during) FROM public.reservation_tables rt
   WHERE rt.establishment_id = p_establishment AND rt.active
     AND rt.during && tstzrange(p_from, p_to, '[)')
     AND app.public_enabled(p_establishment)
$$;

-- Reserva pública ya creada con esa clave (reenvíos del mismo formulario).
CREATE FUNCTION app.public_booking_by_key(p_establishment uuid, p_key text)
RETURNS TABLE (public_code text, status text, starts_at timestamptz, party_size smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.public_code, r.status, r.starts_at, r.party_size FROM public.reservations r
   WHERE r.establishment_id = p_establishment AND r.idempotency_key = p_key AND r.source = 'public'
$$;

-- ---------------------------------------------------------------------------
-- Alta pública
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.public_book(
  p_establishment uuid, p_starts timestamptz, p_ends timestamptz, p_party integer,
  p_name text, p_phone text, p_email text, p_notes text, p_tables uuid[], p_key text)
RETURNS TABLE (reservation_id uuid, public_code text, status text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  s       public.reservation_settings%ROWTYPE;
  v_id    uuid;
  v_code  text;
  v_status text;
  v_table uuid;
BEGIN
  SELECT * INTO s FROM public.reservation_settings WHERE establishment_id = p_establishment;
  IF NOT FOUND OR NOT s.public_enabled THEN
    RAISE EXCEPTION 'public_booking_disabled' USING ERRCODE = 'P0001';
  END IF;

  IF p_key IS NOT NULL THEN
    SELECT r.id, r.public_code, r.status INTO v_id, v_code, v_status FROM public.reservations r
     WHERE r.organization_id = s.organization_id AND r.idempotency_key = p_key AND r.source = 'public';
    IF FOUND THEN
      RETURN QUERY SELECT v_id, v_code, v_status, true;
      RETURN;
    END IF;
  END IF;

  IF p_party < s.min_party OR p_party > s.max_party THEN
    RAISE EXCEPTION 'party_out_of_range' USING ERRCODE = 'P0001';
  END IF;
  IF p_ends - p_starts <> make_interval(mins => s.duration_minutes) THEN
    RAISE EXCEPTION 'invalid_duration' USING ERRCODE = 'P0001';
  END IF;
  IF p_starts < now() + make_interval(mins => s.min_notice_minutes)
     OR p_starts > now() + make_interval(days => s.max_days_ahead + 1) THEN
    RAISE EXCEPTION 'outside_booking_window' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_status := CASE WHEN s.auto_confirm THEN 'confirmed' ELSE 'pending' END;

  INSERT INTO public.reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status,
                                   customer_name, customer_phone, customer_email, notes, idempotency_key,
                                   source, public_code, consent_at)
  VALUES (s.organization_id, p_establishment, p_starts, p_ends, p_party, v_status,
          p_name, p_phone, p_email, p_notes, p_key, 'public', v_code, now())
  RETURNING id INTO v_id;

  -- Prueba las mesas candidatas en orden; si otra reserva simultánea ocupó
  -- una, la exclusión lo detecta y se pasa a la siguiente.
  FOREACH v_table IN ARRAY p_tables LOOP
    IF EXISTS (SELECT 1 FROM public.dining_tables t
                WHERE t.id = v_table AND t.organization_id = s.organization_id
                  AND t.establishment_id = p_establishment AND t.active AND t.max_capacity >= p_party) THEN
      BEGIN
        INSERT INTO public.reservation_tables (organization_id, establishment_id, reservation_id, table_id, during, active)
        VALUES (s.organization_id, p_establishment, v_id, v_table, 'empty', false);
        INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (s.organization_id, NULL, 'reservation.created_public', 'reservation', v_id,
                jsonb_build_object('partySize', p_party, 'status', v_status));
        RETURN QUERY SELECT v_id, v_code, v_status, false;
        RETURN;
      EXCEPTION WHEN exclusion_violation THEN
        -- Mesa ocupada entretanto: probar la siguiente.
      END;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'no_availability' USING ERRCODE = 'P0001';
END
$$;

REVOKE ALL ON FUNCTION app.rate_limit_hit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_booking_info(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_opening_hours(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_schedule_exceptions(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_tables(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_busy(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_booking_by_key(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_booking_by_key(uuid, text) TO nebora_app;
REVOKE ALL ON FUNCTION app.public_book(uuid, timestamptz, timestamptz, integer, text, text, text, text, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rate_limit_hit(text, integer, integer) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_booking_info(text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_enabled(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_opening_hours(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_schedule_exceptions(uuid, date, date) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_tables(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_busy(uuid, timestamptz, timestamptz) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_book(uuid, timestamptz, timestamptz, integer, text, text, text, text, uuid[], text) TO nebora_app;
