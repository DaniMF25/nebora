-- 0006 — Inventario: ingredientes, almacenes, movimientos y saldos.
--
-- Integridad:
--   * stock_movements es de solo inserción para la aplicación. Las correcciones
--     son movimientos compensatorios que referencian al original.
--   * stock_levels NO es escribible por la aplicación: lo actualiza un trigger
--     AFTER INSERT de stock_movements, de modo que el stock no puede cambiar sin
--     un movimiento. El UPSERT es atómico y serializa por (almacén, ingrediente).
--   * El saldo no puede ser negativo (CHECK): una salida sin stock suficiente
--     aborta la transacción completa.
--   * Cada movimiento lleva una clave de idempotencia única por organización;
--     un reintento no vuelve a aplicar el movimiento.
-- Cantidades en la unidad base del ingrediente (g, ml o unidades), numeric(14,3).

CREATE TABLE ingredients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  base_unit       text NOT NULL,
  reorder_level   numeric(14, 3),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredients_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT ingredients_base_unit_check CHECK (base_unit IN ('g', 'ml', 'unit')),
  CONSTRAINT ingredients_reorder_level_check CHECK (reorder_level IS NULL OR reorder_level >= 0),
  CONSTRAINT ingredients_org_name_unique UNIQUE (organization_id, name),
  CONSTRAINT ingredients_org_id_unique UNIQUE (organization_id, id)
);
CREATE TRIGGER ingredients_updated_at BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE warehouses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT warehouses_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT warehouses_establishment_name_unique UNIQUE (establishment_id, name),
  CONSTRAINT warehouses_org_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE stock_levels (
  organization_id uuid NOT NULL,
  warehouse_id    uuid NOT NULL,
  ingredient_id   uuid NOT NULL,
  quantity        numeric(14, 3) NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, ingredient_id),
  CONSTRAINT stock_levels_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_levels_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_levels_non_negative CHECK (quantity >= 0)
);
CREATE INDEX stock_levels_org_idx ON stock_levels (organization_id);

CREATE TABLE stock_movements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  warehouse_id         uuid NOT NULL,
  ingredient_id        uuid NOT NULL,
  kind                 text NOT NULL,
  quantity_delta       numeric(14, 3) NOT NULL,
  note                 text,
  idempotency_key      text NOT NULL,
  corrects_movement_id uuid,
  created_by_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- RESTRICT: borrar un ingrediente o almacén con historial perdería la
  -- trazabilidad; deben archivarse.
  CONSTRAINT stock_movements_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_kind_check
    CHECK (kind IN ('receipt', 'consumption', 'waste', 'adjustment', 'correction')),
  CONSTRAINT stock_movements_delta_nonzero CHECK (quantity_delta <> 0),
  -- El signo debe corresponder al tipo de movimiento.
  CONSTRAINT stock_movements_sign_check CHECK (
    (kind = 'receipt' AND quantity_delta > 0) OR
    (kind IN ('consumption', 'waste') AND quantity_delta < 0) OR
    kind IN ('adjustment', 'correction')
  ),
  CONSTRAINT stock_movements_correction_check
    CHECK ((kind = 'correction') = (corrects_movement_id IS NOT NULL)),
  CONSTRAINT stock_movements_note_length CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT stock_movements_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  CONSTRAINT stock_movements_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT stock_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT stock_movements_corrects_fk FOREIGN KEY (organization_id, corrects_movement_id)
    REFERENCES stock_movements (organization_id, id)
);
-- Un movimiento solo puede corregirse una vez.
CREATE UNIQUE INDEX stock_movements_single_correction ON stock_movements (corrects_movement_id)
  WHERE corrects_movement_id IS NOT NULL;
CREATE INDEX stock_movements_org_time_idx ON stock_movements (organization_id, created_at DESC);
CREATE INDEX stock_movements_item_idx ON stock_movements (warehouse_id, ingredient_id, created_at DESC);

-- Aplica el movimiento al saldo. SECURITY DEFINER porque la aplicación no
-- tiene privilegios de escritura sobre stock_levels.
CREATE FUNCTION app.apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Se asegura la fila con saldo 0 y después se suma el delta. (Un único
  -- INSERT ... ON CONFLICT DO UPDATE no sirve: PostgreSQL valida el CHECK sobre
  -- la fila propuesta antes de resolver el conflicto, rechazando deltas negativos.)
  INSERT INTO public.stock_levels (organization_id, warehouse_id, ingredient_id, quantity)
  VALUES (NEW.organization_id, NEW.warehouse_id, NEW.ingredient_id, 0)
  ON CONFLICT (warehouse_id, ingredient_id) DO NOTHING;
  -- El UPDATE bloquea la fila: movimientos concurrentes del mismo artículo se
  -- serializan y el CHECK (quantity >= 0) se evalúa sobre el saldo real.
  UPDATE public.stock_levels
     SET quantity = quantity + NEW.quantity_delta, updated_at = now()
   WHERE warehouse_id = NEW.warehouse_id AND ingredient_id = NEW.ingredient_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();
REVOKE ALL ON FUNCTION app.apply_stock_movement() FROM PUBLIC;

ALTER TABLE ingredients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingredients_all ON ingredients FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY warehouses_all ON warehouses FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY stock_levels_select ON stock_levels FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND created_by_user_id = app.current_user_id());

GRANT SELECT, INSERT, DELETE ON ingredients TO nebora_app;
GRANT UPDATE (name, reorder_level, active) ON ingredients TO nebora_app;
GRANT SELECT, INSERT, DELETE ON warehouses TO nebora_app;
GRANT UPDATE (name) ON warehouses TO nebora_app;
GRANT SELECT ON stock_levels TO nebora_app;
GRANT SELECT, INSERT ON stock_movements TO nebora_app;
