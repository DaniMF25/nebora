-- 0036 — Historias de la web del local (D-059).
--
-- Avisos destacados tipo «historias» (evento, nueva apertura, cambio de
-- horario…) que se ven arriba de la portada y, la primera vez, se abren a
-- pantalla completa. Cada historia tiene titular, texto corto, foto opcional
-- (archivo propio, se borra con ella), botón opcional y fechas de inicio y fin
-- (días locales del local, ambos incluidos). Desde el plan Avanzado (lo
-- comprueba el servicio; la BD sirve la foto solo si el plan lo permite).

CREATE TABLE site_stories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  title            text NOT NULL,
  body             text,
  media_id         uuid,
  cta_kind         text NOT NULL DEFAULT 'none',
  cta_label        text,
  cta_url          text,
  starts_on        date,
  ends_on          date,
  position         integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_stories_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT site_stories_media_fk FOREIGN KEY (organization_id, media_id)
    REFERENCES media_assets (organization_id, id) ON DELETE SET NULL (media_id),
  CONSTRAINT site_stories_media_unique UNIQUE (media_id),
  CONSTRAINT site_stories_title_length CHECK (char_length(title) BETWEEN 1 AND 60),
  CONSTRAINT site_stories_body_length CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 280),
  CONSTRAINT site_stories_cta_kind CHECK (cta_kind IN ('none', 'booking', 'menu', 'contact', 'url')),
  -- Enlace propio: solo https y con texto del botón; el resto de botones no llevan enlace.
  CONSTRAINT site_stories_cta_url CHECK (
    (cta_kind = 'url' AND cta_url ~ '^https://[^\s]+$' AND char_length(cta_url) <= 500
       AND cta_label IS NOT NULL AND char_length(cta_label) BETWEEN 1 AND 30)
    OR (cta_kind <> 'url' AND cta_url IS NULL AND cta_label IS NULL)
  ),
  CONSTRAINT site_stories_dates CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX site_stories_establishment_idx ON site_stories (organization_id, establishment_id, position);
CREATE TRIGGER site_stories_updated_at BEFORE UPDATE ON site_stories
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE site_stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_stories_all ON site_stories FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
GRANT SELECT, INSERT, DELETE ON site_stories TO nebora_app;
GRANT UPDATE (title, body, media_id, cta_kind, cta_label, cta_url, starts_on, ends_on, position) ON site_stories TO nebora_app;

-- ¿Está la historia vigente hoy (en la hora del local), con la web publicada y un plan que la incluye?
CREATE FUNCTION app.story_is_public(s public.site_stories) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.establishments e
      JOIN public.organizations o ON o.id = e.organization_id
      JOIN public.establishment_profiles p ON p.organization_id = e.organization_id AND p.establishment_id = e.id
     WHERE e.organization_id = s.organization_id AND e.id = s.establishment_id
       AND p.published AND o.plan <> 'basic'
       AND (now() AT TIME ZONE e.timezone)::date
           BETWEEN coalesce(s.starts_on, '-infinity'::date) AND coalesce(s.ends_on, 'infinity'::date)
  )
$$;
REVOKE ALL ON FUNCTION app.story_is_public(public.site_stories) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.story_is_public(public.site_stories) TO nebora_app;

-- Historias públicas de un local, en orden (vacío si no hay o la web no se ve).
CREATE FUNCTION app.public_site_stories(p_establishment uuid)
RETURNS TABLE (id uuid, title text, body text, media_id uuid, cta_kind text, cta_label text, cta_url text,
               updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.id, s.title, s.body, s.media_id, s.cta_kind, s.cta_label, s.cta_url, s.updated_at
    FROM public.site_stories s
   WHERE s.establishment_id = p_establishment AND app.story_is_public(s)
   ORDER BY s.position, s.id
$$;
REVOKE ALL ON FUNCTION app.public_site_stories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site_stories(uuid) TO nebora_app;

-- Imagen pública: también la foto de una historia vigente. Y, de paso, la
-- galería deja de servir sus fotos en el plan Básico (antes seguían siendo
-- accesibles por su enlace directo aunque la web ya no las mostrara).
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
         JOIN public.organizations o ON o.id = g.organization_id
        WHERE g.organization_id = a.organization_id AND g.media_id = a.id AND p.published AND o.plan <> 'basic')
     OR EXISTS (
       SELECT 1 FROM public.site_stories st
        WHERE st.organization_id = a.organization_id AND st.media_id = a.id AND app.story_is_public(st))
   )
$$;
