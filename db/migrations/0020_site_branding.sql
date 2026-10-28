-- 0020 — Marca de la web del local: logotipo, color y tipografía.
--
-- * logo_media_id: imagen reprocesada como las demás (WebP con transparencia,
--   sin metadatos). Solo es pública si el perfil está publicado.
-- * accent_color: color de marca (#rrggbb) que sustituye al de acento del
--   estilo; NULL = el del estilo.
-- * font_pairing: combinación tipográfica elegida entre las del estilo (la
--   lista la valida el servidor); NULL o de otro estilo = la original. D-034.

ALTER TABLE establishment_profiles
  ADD COLUMN logo_media_id uuid,
  ADD COLUMN accent_color text,
  ADD COLUMN font_pairing text,
  ADD CONSTRAINT establishment_profiles_logo_fk FOREIGN KEY (organization_id, logo_media_id)
    REFERENCES media_assets (organization_id, id) ON DELETE SET NULL (logo_media_id),
  ADD CONSTRAINT establishment_profiles_accent_format CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT establishment_profiles_font_pairing_format
    CHECK (font_pairing IS NULL OR font_pairing ~ '^[a-z0-9-]{1,40}$');
GRANT UPDATE (logo_media_id, accent_color, font_pairing) ON establishment_profiles TO nebora_app;

-- La web pública devuelve también la marca (cambia el tipo de resultado).
DROP FUNCTION app.public_site(text, text);
CREATE FUNCTION app.public_site(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (organization_id uuid, establishment_id uuid, organization_name text, establishment_name text,
               timezone text, address text, theme text, tagline text, hero_eyebrow text, hero_title text,
               hero_text text, hero_media_id uuid, phone text, whatsapp text, instagram text, highlights jsonb,
               featured_menu_slug text, featured_menu_code text, booking_enabled boolean,
               languages text[], i18n jsonb, logo_media_id uuid, accent_color text, font_pairing text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, e.id, o.name, e.name, e.timezone, e.address, p.theme, p.tagline, p.hero_eyebrow, p.hero_title,
         p.hero_text, p.hero_media_id, p.phone, p.whatsapp, p.instagram, p.highlights,
         m.slug::text, m.public_code,
         COALESCE((SELECT s.public_enabled FROM public.reservation_settings s WHERE s.establishment_id = e.id), false),
         e.languages, p.i18n, p.logo_media_id, p.accent_color, p.font_pairing
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
    LEFT JOIN public.menus m ON m.organization_id = p.organization_id AND m.id = p.featured_menu_id
                             AND m.published_version_id IS NOT NULL
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND p.published
$$;
REVOKE ALL ON FUNCTION app.public_site(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site(text, text) TO nebora_app;

-- Imagen pública: también el logotipo de un perfil publicado.
CREATE OR REPLACE FUNCTION app.public_media(p_id uuid)
RETURNS TABLE (content_type text, data bytea, sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.content_type, a.data, a.sha256 FROM public.media_assets a
   WHERE a.id = p_id AND (
     EXISTS (SELECT 1 FROM public.establishment_profiles p
              WHERE (p.hero_media_id = a.id OR p.logo_media_id = a.id) AND p.published)
     OR EXISTS (
       SELECT 1 FROM public.menus m JOIN public.menu_versions v ON v.id = m.published_version_id
        WHERE m.organization_id = a.organization_id
          AND jsonb_path_exists(v.snapshot, '$.sections[*].items[*] ? (@.imageId == $id)',
                                jsonb_build_object('id', a.id::text)))
   )
$$;
