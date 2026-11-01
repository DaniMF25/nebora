-- 0026 — Reserva online traducida (D-040): la información pública de reserva
-- incluye los idiomas que ofrece el local (cambia el tipo de resultado).

DROP FUNCTION app.public_booking_info(text, text);
CREATE FUNCTION app.public_booking_info(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (establishment_id uuid, establishment_name text, organization_name text, timezone text,
               min_party smallint, max_party smallint, duration_minutes smallint, slot_interval_minutes smallint,
               min_notice_minutes integer, max_days_ahead smallint, auto_confirm boolean,
               customer_retention_days integer, languages text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.id, e.name, o.name, e.timezone, s.min_party, s.max_party, s.duration_minutes, s.slot_interval_minutes,
         s.min_notice_minutes, s.max_days_ahead, s.auto_confirm, COALESCE(p.customer_retention_days, 365),
         e.languages
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.reservation_settings s ON s.establishment_id = e.id AND s.organization_id = e.organization_id
    LEFT JOIN public.privacy_settings p ON p.organization_id = o.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND s.public_enabled
$$;
REVOKE ALL ON FUNCTION app.public_booking_info(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_booking_info(text, text) TO nebora_app;
