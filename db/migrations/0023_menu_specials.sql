-- 0023 — Fuera de carta (D-037).
--
-- Platos del catálogo ofrecidos fuera de carta en un local, con precio
-- especial y vigencia opcionales (fechas locales del establecimiento,
-- inclusivas). No forman parte de las versiones publicadas de las cartas: se
-- muestran al momento en las páginas públicas del local, como primera sección
-- de sus cartas. Acceso por local igual que las cartas (D-031).

CREATE TABLE menu_specials (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  establishment_id     uuid NOT NULL,
  product_id           uuid NOT NULL,
  price_override_cents integer,
  starts_on            date,
  ends_on              date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_specials_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT menu_specials_product_fk FOREIGN KEY (organization_id, product_id)
    REFERENCES menu_products (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT menu_specials_price_check
    CHECK (price_override_cents IS NULL OR price_override_cents BETWEEN 0 AND 100000000),
  CONSTRAINT menu_specials_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT menu_specials_establishment_product_unique UNIQUE (establishment_id, product_id)
);
CREATE INDEX menu_specials_establishment_idx ON menu_specials (organization_id, establishment_id, created_at);
CREATE INDEX menu_specials_product_idx ON menu_specials (organization_id, product_id);

ALTER TABLE menu_specials ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_specials_all ON menu_specials FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
GRANT SELECT, INSERT, DELETE ON menu_specials TO nebora_app;

-- Como en las cartas (D-032): solo productos disponibles en el local.
CREATE FUNCTION app.menu_specials_product_available() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Un producto de otra organización lo rechaza la FK compuesta; aquí solo la disponibilidad.
  IF EXISTS (SELECT 1 FROM public.menu_products p WHERE p.organization_id = NEW.organization_id AND p.id = NEW.product_id)
     AND NOT app.product_available_in(NEW.organization_id, NEW.product_id, NEW.establishment_id) THEN
    RAISE EXCEPTION 'product_not_available' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER menu_specials_product_available BEFORE INSERT ON menu_specials
  FOR EACH ROW EXECUTE FUNCTION app.menu_specials_product_available();

-- ¿Se ve hoy en las páginas públicas? Local con web o alguna carta publicada,
-- producto activo y disponible en el local, y fecha local dentro de la vigencia.
CREATE FUNCTION app.special_is_public(s public.menu_specials) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.establishments e
      JOIN public.menu_products p ON p.organization_id = s.organization_id AND p.id = s.product_id
     WHERE e.organization_id = s.organization_id AND e.id = s.establishment_id
       AND p.active
       AND app.product_available_in(s.organization_id, s.product_id, s.establishment_id)
       AND (now() AT TIME ZONE e.timezone)::date BETWEEN COALESCE(s.starts_on, '-infinity'::date)
                                                     AND COALESCE(s.ends_on, 'infinity'::date)
       AND (EXISTS (SELECT 1 FROM public.menus m
                     WHERE m.organization_id = e.organization_id AND m.establishment_id = e.id
                       AND m.published_version_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.establishment_profiles pr
                        WHERE pr.organization_id = e.organization_id AND pr.establishment_id = e.id AND pr.published))
  )
$$;
REVOKE ALL ON FUNCTION app.special_is_public(public.menu_specials) FROM PUBLIC;

CREATE FUNCTION app.public_specials(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (product_name text, description text, price_cents integer, allergens text[], image_media_id uuid,
               i18n jsonb, languages text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.name, p.description, COALESCE(s.price_override_cents, p.price_cents), p.allergens, p.image_media_id,
         p.i18n, e.languages
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.menu_specials s ON s.organization_id = o.id AND s.establishment_id = e.id
    JOIN public.menu_products p ON p.organization_id = s.organization_id AND p.id = s.product_id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND app.special_is_public(s)
   ORDER BY s.created_at, s.id
$$;
REVOKE ALL ON FUNCTION app.public_specials(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_specials(text, text) TO nebora_app;

-- Imagen pública: también la foto de un plato fuera de carta que se ve hoy.
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
   )
$$;
