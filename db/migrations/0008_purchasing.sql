-- 0008 — Proveedores, pedidos de compra y recepciones.
--
-- * Las líneas de pedido guardan cantidad en unidad base del ingrediente y
--   precio en céntimos por unidad de referencia (kg, litro o unidad).
-- * Cada recepción genera movimientos de stock de tipo entrada (en la misma
--   transacción) y queda enlazada a ellos. Lo recibido por línea se calcula a
--   partir de las líneas de recepción; no se almacena por duplicado.
-- * Recepciones idempotentes por clave única por organización.

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  contact_name    text,
  email           text,
  phone           text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT suppliers_contact_length CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  CONSTRAINT suppliers_email_length CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT suppliers_phone_length CHECK (phone IS NULL OR char_length(phone) <= 40),
  CONSTRAINT suppliers_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT suppliers_org_name_unique UNIQUE (organization_id, name),
  CONSTRAINT suppliers_org_id_unique UNIQUE (organization_id, id)
);
CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  number             integer NOT NULL,
  supplier_id        uuid NOT NULL,
  warehouse_id       uuid NOT NULL,
  status             text NOT NULL DEFAULT 'draft',
  expected_date      date,
  notes              text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_supplier_fk FOREIGN KEY (organization_id, supplier_id)
    REFERENCES suppliers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled')),
  CONSTRAINT purchase_orders_number_check CHECK (number >= 1),
  CONSTRAINT purchase_orders_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT purchase_orders_org_number_unique UNIQUE (organization_id, number),
  CONSTRAINT purchase_orders_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX purchase_orders_org_status_idx ON purchase_orders (organization_id, status, created_at DESC);
CREATE TRIGGER purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE purchase_order_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  order_id             uuid NOT NULL,
  ingredient_id        uuid NOT NULL,
  quantity_ordered     numeric(14, 3) NOT NULL,
  unit_price_cents     numeric(14, 4) NOT NULL,
  CONSTRAINT purchase_order_lines_order_fk FOREIGN KEY (organization_id, order_id)
    REFERENCES purchase_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_lines_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_order_lines_quantity_check CHECK (quantity_ordered > 0),
  CONSTRAINT purchase_order_lines_price_check CHECK (unit_price_cents >= 0),
  CONSTRAINT purchase_order_lines_order_ingredient_unique UNIQUE (order_id, ingredient_id),
  CONSTRAINT purchase_order_lines_org_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE goods_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  order_id            uuid NOT NULL,
  idempotency_key     text NOT NULL,
  note                text,
  received_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipts_order_fk FOREIGN KEY (organization_id, order_id)
    REFERENCES purchase_orders (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_note_length CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT goods_receipts_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 60),
  CONSTRAINT goods_receipts_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT goods_receipts_org_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE goods_receipt_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_id      uuid NOT NULL,
  order_line_id   uuid NOT NULL,
  quantity        numeric(14, 3) NOT NULL,
  movement_id     uuid NOT NULL,
  CONSTRAINT goods_receipt_lines_receipt_fk FOREIGN KEY (organization_id, receipt_id)
    REFERENCES goods_receipts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_order_line_fk FOREIGN KEY (organization_id, order_line_id)
    REFERENCES purchase_order_lines (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_movement_fk FOREIGN KEY (organization_id, movement_id)
    REFERENCES stock_movements (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT goods_receipt_lines_movement_unique UNIQUE (movement_id)
);
CREATE INDEX goods_receipt_lines_order_line_idx ON goods_receipt_lines (order_line_id);

ALTER TABLE suppliers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines  ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_all ON suppliers FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY purchase_orders_all ON purchase_orders FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY purchase_order_lines_all ON purchase_order_lines FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY goods_receipts_select ON goods_receipts FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY goods_receipts_insert ON goods_receipts FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND received_by_user_id = app.current_user_id());
CREATE POLICY goods_receipt_lines_select ON goods_receipt_lines FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY goods_receipt_lines_insert ON goods_receipt_lines FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id));

GRANT SELECT, INSERT ON suppliers TO nebora_app;
GRANT UPDATE (name, contact_name, email, phone, notes, active) ON suppliers TO nebora_app;
GRANT SELECT, INSERT ON purchase_orders TO nebora_app;
GRANT UPDATE (status, expected_date, notes, sent_at) ON purchase_orders TO nebora_app;
GRANT SELECT, INSERT, DELETE ON purchase_order_lines TO nebora_app;
GRANT UPDATE (quantity_ordered, unit_price_cents) ON purchase_order_lines TO nebora_app;
-- Recepciones: solo inserción (trazabilidad).
GRANT SELECT, INSERT ON goods_receipts TO nebora_app;
GRANT SELECT, INSERT ON goods_receipt_lines TO nebora_app;
