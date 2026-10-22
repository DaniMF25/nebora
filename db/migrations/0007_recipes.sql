-- 0007 — Recetas y escandallos.
--
-- * Cada ingrediente puede declarar sus alérgenos y un coste de referencia en
--   céntimos por unidad de referencia: por kg (ingredientes en g), por litro
--   (en ml) o por unidad. Sin coste, el escandallo se marca como incompleto.
-- * recipe_lines: ingredientes por ración de un producto de la carta, en la
--   unidad base del ingrediente.

ALTER TABLE ingredients
  ADD COLUMN allergens text[] NOT NULL DEFAULT '{}',
  ADD COLUMN cost_cents_per_ref numeric(14, 4),
  ADD COLUMN cost_updated_at timestamptz,
  ADD CONSTRAINT ingredients_allergens_check CHECK (app.valid_allergens(allergens)),
  ADD CONSTRAINT ingredients_cost_check CHECK (cost_cents_per_ref IS NULL OR cost_cents_per_ref >= 0);

GRANT UPDATE (allergens, cost_cents_per_ref, cost_updated_at) ON ingredients TO nebora_app;

CREATE TABLE recipe_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  product_id      uuid NOT NULL,
  ingredient_id   uuid NOT NULL,
  quantity        numeric(14, 3) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipe_lines_product_fk FOREIGN KEY (organization_id, product_id)
    REFERENCES menu_products (organization_id, id) ON DELETE CASCADE,
  -- Un ingrediente usado en recetas no se puede borrar (se archiva).
  CONSTRAINT recipe_lines_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT recipe_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT recipe_lines_product_ingredient_unique UNIQUE (product_id, ingredient_id)
);
CREATE INDEX recipe_lines_org_product_idx ON recipe_lines (organization_id, product_id);
CREATE INDEX recipe_lines_ingredient_idx ON recipe_lines (organization_id, ingredient_id);

ALTER TABLE recipe_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipe_lines_all ON recipe_lines FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));

GRANT SELECT, INSERT, DELETE ON recipe_lines TO nebora_app;
GRANT UPDATE (quantity) ON recipe_lines TO nebora_app;
