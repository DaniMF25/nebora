-- 0022 — Cartas con horario (D-036).
--
-- * menus.availability: NULL = la carta se sirve siempre; si no, turnos
--   semanales con el mismo formato que el horario de apertura
--   ({weekday 1..7, opensMinute 0..1439, durationMinutes 1..1440}, en hora
--   local del establecimiento; pueden cruzar la medianoche). Es configuración
--   viva, no forma parte de la versión publicada: cambiarla no requiere volver
--   a publicar. El servidor valida solapes; la BD, la forma de cada turno.
-- * app.public_menus: cartas publicadas de un local para las páginas
--   públicas (elegir la carta del momento y enlazar las demás). Solo devuelve
--   datos de la versión publicada (nombre y traducciones de la instantánea),
--   el horario y si es la destacada de la web.

ALTER TABLE menus
  ADD COLUMN availability jsonb,
  ADD CONSTRAINT menus_availability_shape CHECK (
    availability IS NULL OR (
      jsonb_typeof(availability) = 'array'
      AND jsonb_array_length(availability) BETWEEN 1 AND 42
      AND jsonb_array_length(availability) = jsonb_array_length(jsonb_path_query_array(availability,
        '$[*] ? (@.weekday >= 1 && @.weekday <= 7 && @.weekday == @.weekday.floor()
                 && @.opensMinute >= 0 && @.opensMinute <= 1439 && @.opensMinute == @.opensMinute.floor()
                 && @.durationMinutes >= 1 && @.durationMinutes <= 1440
                 && @.durationMinutes == @.durationMinutes.floor())'))
    )
  );
GRANT UPDATE (availability) ON menus TO nebora_app;

CREATE FUNCTION app.public_menus(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (slug text, menu_name text, menu_name_i18n jsonb, availability jsonb, featured boolean,
               timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.slug::text, v.snapshot->>'menuName', v.snapshot->'menuNameI18n', m.availability,
         COALESCE(p.featured_menu_id = m.id, false), e.timezone
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.menus m ON m.organization_id = o.id AND m.establishment_id = e.id
    JOIN public.menu_versions v ON v.id = m.published_version_id AND v.menu_id = m.id
    LEFT JOIN public.establishment_profiles p ON p.organization_id = e.organization_id AND p.establishment_id = e.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext
   ORDER BY m.created_at, m.id
$$;
REVOKE ALL ON FUNCTION app.public_menus(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_menus(text, text) TO nebora_app;
