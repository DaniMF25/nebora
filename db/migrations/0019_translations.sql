-- 0019 — Traducciones de la web y las cartas.
--
-- * Cada local elige sus idiomas adicionales (el español es el idioma de
--   origen y siempre está). Lista cerrada: en, fr, de, it, pt, ca.
-- * Las traducciones se guardan junto a lo que traducen, en una columna
--   `i18n` (jsonb): { "<idioma>": { <campos traducidos>, "src": "<huella>" } }.
--   Así heredan las políticas RLS de su fila (organización y, en cartas y web,
--   local). `src` es la huella del texto en español del que se tradujo: si el
--   original cambia, la traducción se marca como desactualizada.
-- * Traducción manual. Un traductor automático se podría añadir después como
--   adaptador que rellene estas mismas columnas. D-033.
-- * Las cartas publicadas llevan sus traducciones en la instantánea: cambiar
--   una traducción requiere volver a publicar (como cualquier otro cambio).

CREATE FUNCTION app.valid_languages(p text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p <@ ARRAY['en', 'fr', 'de', 'it', 'pt', 'ca']::text[]
     AND cardinality(p) = (SELECT count(DISTINCT x) FROM unnest(p) x)
$$;

-- Estructura de una columna i18n: objeto con idiomas válidos; cada idioma, un
-- objeto cuyos valores son textos (o la lista de destacados de la web). El
-- tamaño total se limita; la longitud de cada campo la valida el servidor.
CREATE FUNCTION app.valid_i18n(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND octet_length(p::text) <= 60000
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p) AS l(lang, val)
        WHERE l.lang NOT IN ('en', 'fr', 'de', 'it', 'pt', 'ca')
           OR jsonb_typeof(l.val) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_each(l.val) AS f(k, v)
                       WHERE jsonb_typeof(f.v) NOT IN ('string', 'array')))
$$;

ALTER TABLE establishments
  ADD COLUMN languages text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT establishments_languages_check CHECK (app.valid_languages(languages));
GRANT UPDATE (languages) ON establishments TO nebora_app;

ALTER TABLE menu_products ADD COLUMN i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT menu_products_i18n_check CHECK (app.valid_i18n(i18n));
ALTER TABLE menus ADD COLUMN i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT menus_i18n_check CHECK (app.valid_i18n(i18n));
ALTER TABLE menu_sections ADD COLUMN i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT menu_sections_i18n_check CHECK (app.valid_i18n(i18n));
ALTER TABLE establishment_profiles ADD COLUMN i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT establishment_profiles_i18n_check CHECK (app.valid_i18n(i18n));
GRANT UPDATE (i18n) ON menu_products TO nebora_app;
GRANT UPDATE (i18n) ON menus TO nebora_app;
GRANT UPDATE (i18n) ON menu_sections TO nebora_app;
GRANT UPDATE (i18n) ON establishment_profiles TO nebora_app;

-- La web pública devuelve también los idiomas del local y las traducciones
-- del perfil (cambia el tipo de resultado: se recrea).
DROP FUNCTION app.public_site(text, text);
CREATE FUNCTION app.public_site(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (organization_id uuid, establishment_id uuid, organization_name text, establishment_name text,
               timezone text, address text, theme text, tagline text, hero_eyebrow text, hero_title text,
               hero_text text, hero_media_id uuid, phone text, whatsapp text, instagram text, highlights jsonb,
               featured_menu_slug text, featured_menu_code text, booking_enabled boolean,
               languages text[], i18n jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, e.id, o.name, e.name, e.timezone, e.address, p.theme, p.tagline, p.hero_eyebrow, p.hero_title,
         p.hero_text, p.hero_media_id, p.phone, p.whatsapp, p.instagram, p.highlights,
         m.slug::text, m.public_code,
         COALESCE((SELECT s.public_enabled FROM public.reservation_settings s WHERE s.establishment_id = e.id), false),
         e.languages, p.i18n
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
    LEFT JOIN public.menus m ON m.organization_id = p.organization_id AND m.id = p.featured_menu_id
                             AND m.published_version_id IS NOT NULL
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND p.published
$$;
REVOKE ALL ON FUNCTION app.public_site(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site(text, text) TO nebora_app;
