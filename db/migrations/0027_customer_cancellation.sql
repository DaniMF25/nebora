-- 0027 — Cancelación de reservas online por el cliente (D-041).
--
-- Cada reserva online guarda la huella (sha256, hex) de un token aleatorio que
-- solo conoce el cliente: va en el enlace de cancelación que ve al reservar.
-- Con él, y sin sesión, puede ver su reserva y cancelarla hasta su hora de
-- inicio. Las funciones públicas solo devuelven lo imprescindible.

ALTER TABLE reservations
  ADD COLUMN cancel_token_hash text,
  ADD CONSTRAINT reservations_cancel_token_format CHECK (cancel_token_hash IS NULL OR cancel_token_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX reservations_cancel_token_unique ON reservations (cancel_token_hash) WHERE cancel_token_hash IS NOT NULL;

-- Fija (o renueva, si el mismo formulario se reenvía) el token de la reserva
-- online identificada por su clave de idempotencia, que solo conoce quien la creó.
CREATE FUNCTION app.public_set_cancel_token(p_establishment uuid, p_key text, p_hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH u AS (
    UPDATE public.reservations SET cancel_token_hash = p_hash
     WHERE establishment_id = p_establishment AND idempotency_key = p_key AND source = 'public'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u)
$$;

-- Reserva a la que corresponde un token, solo dentro del local indicado.
CREATE FUNCTION app.public_cancellation(p_org_slug text, p_establishment_slug text, p_hash text)
RETURNS TABLE (public_code text, starts_at timestamptz, party_size smallint, status text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.public_code, r.starts_at, r.party_size, r.status, e.timezone
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.reservations r ON r.organization_id = e.organization_id AND r.establishment_id = e.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext
     AND r.cancel_token_hash = p_hash AND r.source = 'public'
$$;

-- Cancela la reserva del token. Resultado: cancelled, already_cancelled,
-- not_cancellable (en mesa, finalizada o no presentada), too_late (ya empezó)
-- o not_found.
CREATE FUNCTION app.public_cancel(p_org_slug text, p_establishment_slug text, p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r public.reservations%ROWTYPE;
BEGIN
  SELECT res.* INTO r
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.reservations res ON res.organization_id = e.organization_id AND res.establishment_id = e.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext
     AND res.cancel_token_hash = p_hash AND res.source = 'public'
     FOR UPDATE OF res;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF r.status = 'cancelled' THEN
    RETURN 'already_cancelled';
  END IF;
  IF r.status NOT IN ('pending', 'confirmed') THEN
    RETURN 'not_cancellable';
  END IF;
  IF r.starts_at <= now() THEN
    RETURN 'too_late';
  END IF;
  -- El trigger de reservas libera la mesa al cambiar el estado.
  UPDATE public.reservations SET status = 'cancelled' WHERE id = r.id;
  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (r.organization_id, NULL, 'reservation.cancelled_by_customer', 'reservation', r.id, '{}'::jsonb);
  RETURN 'cancelled';
END
$$;

REVOKE ALL ON FUNCTION app.public_set_cancel_token(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_cancellation(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_cancel(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_set_cancel_token(uuid, text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_cancellation(text, text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_cancel(text, text, text) TO nebora_app;
