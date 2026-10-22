-- 0004 — Cartas digitales: catálogo de productos, cartas con categorías en
-- borrador y versiones publicadas inmutables.
--
-- Flujo: se edita el borrador (menu_sections + menu_items que apuntan a
-- productos del catálogo). Publicar genera una instantánea JSON completa en
-- menu_versions (solo inserción) y apunta menus.published_version_id a ella.
-- La página pública solo lee esa instantánea mediante app.published_menu().

-- Alérgenos de declaración obligatoria en la UE (Reglamento 1169/2011, anexo II).
CREATE FUNCTION app.valid_allergens(p text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p <@ ARRAY['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts',
                    'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::text[]
$$;

CREATE TABLE menu_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  price_cents     integer NOT NULL,
  allergens       text[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_products_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT menu_products_description_length CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT menu_products_price_check CHECK (price_cents BETWEEN 0 AND 100000000),
  CONSTRAINT menu_products_allergens_check CHECK (app.valid_allergens(allergens)),
  CONSTRAINT menu_products_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX menu_products_org_idx ON menu_products (organization_id, name);
CREATE TRIGGER menu_products_updated_at BEFORE UPDATE ON menu_products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE menus (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  establishment_id     uuid NOT NULL,
  name                 text NOT NULL,
  slug                 citext NOT NULL,
  theme                text NOT NULL DEFAULT 'moderno',
  published_version_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menus_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT menus_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT menus_slug_format CHECK (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'),
  CONSTRAINT menus_theme_check CHECK (theme IN ('moderno', 'clasico', 'futurista', 'mediterraneo')),
  CONSTRAINT menus_establishment_slug_unique UNIQUE (establishment_id, slug),
  CONSTRAINT menus_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX menus_establishment_idx ON menus (organization_id, establishment_id);
CREATE TRIGGER menus_updated_at BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE menu_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  menu_id         uuid NOT NULL,
  name            text NOT NULL,
  position        integer NOT NULL,
  CONSTRAINT menu_sections_menu_fk FOREIGN KEY (organization_id, menu_id)
    REFERENCES menus (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT menu_sections_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT menu_sections_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX menu_sections_menu_idx ON menu_sections (menu_id, position);

CREATE TABLE menu_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  section_id          uuid NOT NULL,
  product_id          uuid NOT NULL,
  position            integer NOT NULL,
  price_override_cents integer,
  CONSTRAINT menu_items_section_fk FOREIGN KEY (organization_id, section_id)
    REFERENCES menu_sections (organization_id, id) ON DELETE CASCADE,
  -- RESTRICT: un producto usado en un borrador no se puede borrar (se archiva).
  CONSTRAINT menu_items_product_fk FOREIGN KEY (organization_id, product_id)
    REFERENCES menu_products (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT menu_items_price_check CHECK (price_override_cents IS NULL OR price_override_cents BETWEEN 0 AND 100000000),
  CONSTRAINT menu_items_section_product_unique UNIQUE (section_id, product_id)
);
CREATE INDEX menu_items_section_idx ON menu_items (section_id, position);
CREATE INDEX menu_items_product_idx ON menu_items (organization_id, product_id);

CREATE TABLE menu_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  menu_id              uuid NOT NULL,
  version_number       integer NOT NULL,
  snapshot             jsonb NOT NULL,
  published_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  published_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_versions_menu_fk FOREIGN KEY (organization_id, menu_id)
    REFERENCES menus (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT menu_versions_number_check CHECK (version_number >= 1),
  CONSTRAINT menu_versions_menu_number_unique UNIQUE (menu_id, version_number),
  CONSTRAINT menu_versions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT menu_versions_menu_id_unique UNIQUE (menu_id, id)
);

-- La versión publicada debe ser una versión de la misma carta.
ALTER TABLE menus ADD CONSTRAINT menus_published_version_fk
  FOREIGN KEY (id, published_version_id) REFERENCES menu_versions (menu_id, id);

ALTER TABLE menu_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_products_all ON menu_products FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY menus_all ON menus FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY menu_sections_all ON menu_sections FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY menu_items_all ON menu_items FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY menu_versions_select ON menu_versions FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY menu_versions_insert ON menu_versions FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND published_by_user_id = app.current_user_id());

GRANT SELECT, INSERT, DELETE ON menu_products TO nebora_app;
GRANT UPDATE (name, description, price_cents, allergens, active) ON menu_products TO nebora_app;
GRANT SELECT, INSERT, DELETE ON menus TO nebora_app;
GRANT UPDATE (name, slug, theme, published_version_id) ON menus TO nebora_app;
GRANT SELECT, INSERT, DELETE ON menu_sections TO nebora_app;
GRANT UPDATE (name, position) ON menu_sections TO nebora_app;
GRANT SELECT, INSERT, DELETE ON menu_items TO nebora_app;
GRANT UPDATE (position, price_override_cents) ON menu_items TO nebora_app;
-- Versiones inmutables: sin UPDATE ni DELETE.
GRANT SELECT, INSERT ON menu_versions TO nebora_app;

-- Lectura pública: SOLO la instantánea de la versión publicada. Nunca devuelve
-- borradores ni identificadores internos.
CREATE FUNCTION app.published_menu(p_org_slug text, p_establishment_slug text, p_menu_slug text)
RETURNS TABLE (version_number integer, published_at timestamptz, snapshot jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT v.version_number, v.published_at, v.snapshot
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.menus m ON m.organization_id = o.id AND m.establishment_id = e.id
    JOIN public.menu_versions v ON v.id = m.published_version_id AND v.menu_id = m.id
   WHERE o.slug = p_org_slug::citext
     AND e.slug = p_establishment_slug::citext
     AND m.slug = p_menu_slug::citext
$$;

REVOKE ALL ON FUNCTION app.published_menu(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.valid_allergens(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.published_menu(text, text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.valid_allergens(text[]) TO nebora_app;
