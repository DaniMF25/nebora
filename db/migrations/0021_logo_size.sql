-- 0021 — Tamaño del logotipo en la cabecera de la web: pequeño, mediano o
-- grande (D-034).

ALTER TABLE establishment_profiles
  ADD COLUMN logo_size text NOT NULL DEFAULT 'medium',
  ADD CONSTRAINT establishment_profiles_logo_size_check CHECK (logo_size IN ('small', 'medium', 'large'));
GRANT UPDATE (logo_size) ON establishment_profiles TO nebora_app;

-- La web pública devuelve también el tamaño (cambia el tipo de resultado).
DROP FUNCTION app.public_site(text, text);
CREATE FUNCTION app.public_site(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (organization_id uuid, establishment_id uuid, organization_name text, establishment_name text,
               timezone text, address text, theme text, tagline text, hero_eyebrow text, hero_title text,
               hero_text text, hero_media_id uuid, phone text, whatsapp text, instagram text, highlights jsonb,
               featured_menu_slug text, featured_menu_code text, booking_enabled boolean,
               languages text[], i18n jsonb, logo_media_id uuid, accent_color text, font_pairing text,
               logo_size text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, e.id, o.name, e.name, e.timezone, e.address, p.theme, p.tagline, p.hero_eyebrow, p.hero_title,
         p.hero_text, p.hero_media_id, p.phone, p.whatsapp, p.instagram, p.highlights,
         m.slug::text, m.public_code,
         COALESCE((SELECT s.public_enabled FROM public.reservation_settings s WHERE s.establishment_id = e.id), false),
         e.languages, p.i18n, p.logo_media_id, p.accent_color, p.font_pairing, p.logo_size
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
    LEFT JOIN public.menus m ON m.organization_id = p.organization_id AND m.id = p.featured_menu_id
                             AND m.published_version_id IS NOT NULL
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND p.published
$$;
REVOKE ALL ON FUNCTION app.public_site(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site(text, text) TO nebora_app;
