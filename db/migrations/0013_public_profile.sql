-- 0013 — Perfil público del local, imágenes y platos destacados.
--
-- * media_assets: imágenes ya reprocesadas por el servidor (WebP, sin
--   metadatos) guardadas en la BD de forma PROVISIONAL mientras no haya un
--   servicio de almacenamiento configurado. Límite de tamaño por CHECK.
-- * Las imágenes solo son públicas si las usa un perfil publicado o un
--   producto incluido en una carta publicada (app.public_media); el resto
--   (borradores, productos no publicados) no se sirve a anónimos.
-- * establishment_profiles: contenido de la página pública del local.
-- * Slugs de organización reservados: la web pública vive en /<org>/<local>,
--   así que una organización no puede llamarse como una ruta de la aplicación.

ALTER TABLE organizations ADD CONSTRAINT organizations_slug_not_reserved CHECK (
  slug::text NOT IN ('app', 'api', 'login', 'register', 'invite', 'logout', 'm', 'q', 'r', 'media', 'static',
                     'public', 'admin', 'assets', 'favicon', 'robots', 'sitemap', 'nebora')
);

CREATE TABLE media_assets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  content_type       text NOT NULL,
  width              integer NOT NULL,
  height             integer NOT NULL,
  byte_size          integer NOT NULL,
  sha256             text NOT NULL,
  data               bytea NOT NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_type_check CHECK (content_type = 'image/webp'),
  CONSTRAINT media_assets_size_check CHECK (byte_size BETWEEN 1 AND 1500000 AND octet_length(data) = byte_size),
  CONSTRAINT media_assets_dims_check CHECK (width BETWEEN 1 AND 4000 AND height BETWEEN 1 AND 4000),
  CONSTRAINT media_assets_sha_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_assets_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX media_assets_org_idx ON media_assets (organization_id, created_at DESC);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_assets_all ON media_assets FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT, DELETE ON media_assets TO nebora_app;

-- Foto de producto y marca de «recomendado» por elemento de carta.
ALTER TABLE menu_products
  ADD COLUMN image_media_id uuid,
  ADD CONSTRAINT menu_products_image_fk FOREIGN KEY (organization_id, image_media_id)
    REFERENCES media_assets (organization_id, id) ON DELETE SET NULL (image_media_id);
GRANT UPDATE (image_media_id) ON menu_products TO nebora_app;

ALTER TABLE menu_items ADD COLUMN recommended boolean NOT NULL DEFAULT false;
GRANT UPDATE (recommended) ON menu_items TO nebora_app;

CREATE TABLE establishment_profiles (
  establishment_id uuid PRIMARY KEY,
  organization_id  uuid NOT NULL,
  published        boolean NOT NULL DEFAULT false,
  theme            text NOT NULL DEFAULT 'mediterraneo',
  tagline          text,
  hero_eyebrow     text,
  hero_title       text,
  hero_text        text,
  hero_media_id    uuid,
  phone            text,
  whatsapp         text,
  instagram        text,
  highlights       jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured_menu_id uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT establishment_profiles_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT establishment_profiles_hero_fk FOREIGN KEY (organization_id, hero_media_id)
    REFERENCES media_assets (organization_id, id) ON DELETE SET NULL (hero_media_id),
  CONSTRAINT establishment_profiles_menu_fk FOREIGN KEY (organization_id, featured_menu_id)
    REFERENCES menus (organization_id, id) ON DELETE SET NULL (featured_menu_id),
  CONSTRAINT establishment_profiles_theme_check CHECK (theme IN ('moderno', 'clasico', 'futurista', 'mediterraneo')),
  CONSTRAINT establishment_profiles_lengths CHECK (
    coalesce(char_length(tagline), 0) <= 60 AND coalesce(char_length(hero_eyebrow), 0) <= 60 AND
    coalesce(char_length(hero_title), 0) <= 120 AND coalesce(char_length(hero_text), 0) <= 400 AND
    coalesce(char_length(phone), 0) <= 40
  ),
  CONSTRAINT establishment_profiles_whatsapp_format CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{6,15}$'),
  CONSTRAINT establishment_profiles_instagram_format CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  CONSTRAINT establishment_profiles_highlights_check
    CHECK (jsonb_typeof(highlights) = 'array' AND jsonb_array_length(highlights) <= 3)
);
CREATE TRIGGER establishment_profiles_updated_at BEFORE UPDATE ON establishment_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE establishment_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY establishment_profiles_all ON establishment_profiles FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT ON establishment_profiles TO nebora_app;
GRANT UPDATE (published, theme, tagline, hero_eyebrow, hero_title, hero_text, hero_media_id, phone, whatsapp,
              instagram, highlights, featured_menu_id) ON establishment_profiles TO nebora_app;

-- ---------------------------------------------------------------------------
-- Lectura pública
-- ---------------------------------------------------------------------------

-- Perfil publicado con datos del local y horario (no incluye datos privados).
CREATE FUNCTION app.public_site(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (organization_id uuid, establishment_id uuid, organization_name text, establishment_name text,
               timezone text, address text, theme text, tagline text, hero_eyebrow text, hero_title text,
               hero_text text, hero_media_id uuid, phone text, whatsapp text, instagram text, highlights jsonb,
               featured_menu_slug text, featured_menu_code text, booking_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, e.id, o.name, e.name, e.timezone, e.address, p.theme, p.tagline, p.hero_eyebrow, p.hero_title,
         p.hero_text, p.hero_media_id, p.phone, p.whatsapp, p.instagram, p.highlights,
         m.slug::text, m.public_code,
         COALESCE((SELECT s.public_enabled FROM public.reservation_settings s WHERE s.establishment_id = e.id), false)
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
    LEFT JOIN public.menus m ON m.organization_id = p.organization_id AND m.id = p.featured_menu_id
                             AND m.published_version_id IS NOT NULL
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND p.published
$$;

CREATE FUNCTION app.public_site_hours(p_establishment uuid)
RETURNS TABLE (weekday smallint, opens_minute smallint, duration_minutes smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT h.weekday, h.opens_minute, h.duration_minutes FROM public.opening_hours h
   WHERE h.establishment_id = p_establishment
     AND EXISTS (SELECT 1 FROM public.establishment_profiles p WHERE p.establishment_id = p_establishment AND p.published)
   ORDER BY h.weekday, h.opens_minute
$$;

-- Imagen pública solo si la usa un perfil publicado o una carta publicada.
CREATE FUNCTION app.public_media(p_id uuid)
RETURNS TABLE (content_type text, data bytea, sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.content_type, a.data, a.sha256 FROM public.media_assets a
   WHERE a.id = p_id AND (
     EXISTS (SELECT 1 FROM public.establishment_profiles p WHERE p.hero_media_id = a.id AND p.published)
     OR EXISTS (
       SELECT 1 FROM public.menus m JOIN public.menu_versions v ON v.id = m.published_version_id
        WHERE m.organization_id = a.organization_id
          AND jsonb_path_exists(v.snapshot, '$.sections[*].items[*] ? (@.imageId == $id)',
                                jsonb_build_object('id', a.id::text)))
   )
$$;

REVOKE ALL ON FUNCTION app.public_site(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_site_hours(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_media(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site(text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_site_hours(uuid) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.public_media(uuid) TO nebora_app;
