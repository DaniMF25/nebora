-- 0025 — Galería de imágenes de la web del local (D-039).
--
-- Fotos con pie opcional y orden, por local. Cada foto es un media_asset
-- propio (se sube para la galería): al quitarla se borra también el archivo y
-- libera cupo. Solo son públicas si la web del local está publicada.

CREATE TABLE site_gallery_images (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  media_id         uuid NOT NULL,
  caption          text,
  position         integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_gallery_images_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT site_gallery_images_media_fk FOREIGN KEY (organization_id, media_id)
    REFERENCES media_assets (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT site_gallery_images_caption_length CHECK (caption IS NULL OR char_length(caption) BETWEEN 1 AND 120),
  CONSTRAINT site_gallery_images_media_unique UNIQUE (media_id)
);
CREATE INDEX site_gallery_images_establishment_idx ON site_gallery_images (organization_id, establishment_id, position);

ALTER TABLE site_gallery_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_gallery_images_all ON site_gallery_images FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
GRANT SELECT, INSERT, DELETE ON site_gallery_images TO nebora_app;
GRANT UPDATE (caption, position) ON site_gallery_images TO nebora_app;

-- Galería de una web publicada (vacía si no lo está).
CREATE FUNCTION app.public_site_gallery(p_establishment uuid)
RETURNS TABLE (media_id uuid, caption text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT g.media_id, g.caption
    FROM public.site_gallery_images g
    JOIN public.establishment_profiles p ON p.organization_id = g.organization_id AND p.establishment_id = g.establishment_id
   WHERE g.establishment_id = p_establishment AND p.published
   ORDER BY g.position, g.id
$$;
REVOKE ALL ON FUNCTION app.public_site_gallery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site_gallery(uuid) TO nebora_app;

-- Imagen pública: también las fotos de la galería de una web publicada.
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
     OR EXISTS (
       SELECT 1 FROM public.menu_specials s
         JOIN public.menu_products pr ON pr.organization_id = s.organization_id AND pr.id = s.product_id
        WHERE pr.organization_id = a.organization_id AND pr.image_media_id = a.id AND app.special_is_public(s))
     OR EXISTS (
       SELECT 1 FROM public.site_gallery_images g
         JOIN public.establishment_profiles p ON p.organization_id = g.organization_id
                                             AND p.establishment_id = g.establishment_id
        WHERE g.organization_id = a.organization_id AND g.media_id = a.id AND p.published)
   )
$$;
