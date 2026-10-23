-- 0014 — Traspasos entre almacenes y recuentos físicos.
--
-- * Un traspaso son dos movimientos (salida del origen y entrada en el destino)
--   ligados a una fila de stock_transfers. Un trigger diferido comprueba al
--   confirmar la transacción que existen las dos patas con la cantidad exacta:
--   nunca puede quedar una a medias.
-- * Un recuento guarda las cantidades contadas por artículo. Al aplicarlo,
--   app.apply_stock_count bloquea cada saldo, calcula la diferencia en ese
--   instante y genera un movimiento `count` por diferencia, todo atómico.
-- * Los movimientos de traspaso y de recuento no se corrigen individualmente
--   (descuadraría el traspaso o el recuento): se compensan con otro traspaso o
--   recuento.

ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_kind_check,
  DROP CONSTRAINT stock_movements_sign_check,
  ADD CONSTRAINT stock_movements_kind_check
    CHECK (kind IN ('receipt', 'consumption', 'waste', 'adjustment', 'correction', 'transfer_out', 'transfer_in', 'count')),
  ADD CONSTRAINT stock_movements_sign_check CHECK (
    (kind IN ('receipt', 'transfer_in') AND quantity_delta > 0) OR
    (kind IN ('consumption', 'waste', 'transfer_out') AND quantity_delta < 0) OR
    kind IN ('adjustment', 'correction', 'count')
  );

CREATE TABLE stock_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  from_warehouse_id   uuid NOT NULL,
  to_warehouse_id     uuid NOT NULL,
  ingredient_id       uuid NOT NULL,
  quantity            numeric(14, 3) NOT NULL,
  note                text,
  idempotency_key     text NOT NULL,
  created_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_from_fk FOREIGN KEY (organization_id, from_warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfers_to_fk FOREIGN KEY (organization_id, to_warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfers_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfers_distinct CHECK (from_warehouse_id <> to_warehouse_id),
  CONSTRAINT stock_transfers_quantity_check CHECK (quantity > 0),
  CONSTRAINT stock_transfers_note_length CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT stock_transfers_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 90),
  CONSTRAINT stock_transfers_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT stock_transfers_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX stock_transfers_org_time_idx ON stock_transfers (organization_id, created_at DESC);

CREATE TABLE stock_counts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  warehouse_id       uuid NOT NULL,
  status             text NOT NULL DEFAULT 'open',
  note               text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  closed_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  closed_at          timestamptz,
  CONSTRAINT stock_counts_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_counts_status_check CHECK (status IN ('open', 'applied', 'cancelled')),
  CONSTRAINT stock_counts_closed_check CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT stock_counts_note_length CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT stock_counts_org_id_unique UNIQUE (organization_id, id)
);
-- Un único recuento abierto por almacén.
CREATE UNIQUE INDEX stock_counts_one_open ON stock_counts (warehouse_id) WHERE status = 'open';
CREATE INDEX stock_counts_org_time_idx ON stock_counts (organization_id, created_at DESC);

CREATE TABLE stock_count_lines (
  organization_id     uuid NOT NULL,
  count_id            uuid NOT NULL,
  ingredient_id       uuid NOT NULL,
  counted_quantity    numeric(14, 3) NOT NULL,
  -- Saldo del sistema en el momento de aplicar (null mientras está abierto).
  expected_quantity   numeric(14, 3),
  counted_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (count_id, ingredient_id),
  CONSTRAINT stock_count_lines_count_fk FOREIGN KEY (organization_id, count_id)
    REFERENCES stock_counts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT stock_count_lines_ingredient_fk FOREIGN KEY (organization_id, ingredient_id)
    REFERENCES ingredients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_count_lines_quantity_check CHECK (counted_quantity >= 0)
);

ALTER TABLE stock_movements
  ADD COLUMN transfer_id uuid,
  ADD COLUMN count_id uuid,
  ADD CONSTRAINT stock_movements_transfer_fk FOREIGN KEY (organization_id, transfer_id)
    REFERENCES stock_transfers (organization_id, id),
  ADD CONSTRAINT stock_movements_count_fk FOREIGN KEY (organization_id, count_id)
    REFERENCES stock_counts (organization_id, id),
  ADD CONSTRAINT stock_movements_transfer_link
    CHECK ((kind IN ('transfer_out', 'transfer_in')) = (transfer_id IS NOT NULL)),
  ADD CONSTRAINT stock_movements_count_link CHECK ((kind = 'count') = (count_id IS NOT NULL));
CREATE UNIQUE INDEX stock_movements_transfer_leg ON stock_movements (transfer_id, kind) WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX stock_movements_count_item ON stock_movements (count_id, ingredient_id) WHERE count_id IS NOT NULL;

-- Las dos patas del traspaso deben existir al confirmar la transacción.
CREATE FUNCTION app.check_stock_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements m
                  WHERE m.transfer_id = NEW.id AND m.kind = 'transfer_out' AND m.warehouse_id = NEW.from_warehouse_id
                    AND m.ingredient_id = NEW.ingredient_id AND m.quantity_delta = -NEW.quantity)
     OR NOT EXISTS (SELECT 1 FROM public.stock_movements m
                  WHERE m.transfer_id = NEW.id AND m.kind = 'transfer_in' AND m.warehouse_id = NEW.to_warehouse_id
                    AND m.ingredient_id = NEW.ingredient_id AND m.quantity_delta = NEW.quantity) THEN
    RAISE EXCEPTION 'traspaso incompleto' USING ERRCODE = 'check_violation', CONSTRAINT = 'stock_transfers_balanced';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER stock_transfers_balanced AFTER INSERT ON stock_transfers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_stock_transfer();

-- Ni traspasos ni recuentos se corrigen pata a pata.
CREATE FUNCTION app.check_stock_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.kind = 'correction' AND EXISTS (
       SELECT 1 FROM public.stock_movements o
        WHERE o.id = NEW.corrects_movement_id AND o.kind IN ('transfer_out', 'transfer_in', 'count')) THEN
    RAISE EXCEPTION 'movimiento no corregible' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'stock_movements_correction_kind';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_movements_correction_kind BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.check_stock_correction();

-- Reglas para el rol de la aplicación (los triggers son SECURITY INVOKER: dentro
-- de app.apply_stock_count, que es SECURITY DEFINER, current_user es el
-- propietario y no se aplican):
--   * las líneas solo cambian mientras el recuento está abierto y nunca fijan
--     el saldo esperado;
--   * un recuento solo puede pasar de abierto a cancelado.
CREATE FUNCTION app.check_stock_count_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user = 'nebora_app' THEN
    IF NOT EXISTS (SELECT 1 FROM public.stock_counts c
                    WHERE c.id = COALESCE(NEW.count_id, OLD.count_id) AND c.status = 'open') THEN
      RAISE EXCEPTION 'recuento cerrado' USING ERRCODE = 'check_violation', CONSTRAINT = 'stock_count_lines_open';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.expected_quantity IS NOT NULL THEN
      RAISE EXCEPTION 'saldo esperado reservado' USING ERRCODE = 'check_violation', CONSTRAINT = 'stock_count_lines_open';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER stock_count_lines_open BEFORE INSERT OR UPDATE OR DELETE ON stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION app.check_stock_count_line();

CREATE FUNCTION app.check_stock_count_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user = 'nebora_app' AND NOT (OLD.status = 'open' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'cambio de estado no permitido' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'stock_counts_transition';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_counts_transition BEFORE UPDATE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION app.check_stock_count_status();

-- Aplica un recuento abierto: por cada línea bloquea el saldo, guarda el saldo
-- esperado y registra un movimiento `count` con la diferencia (si la hay).
-- Solo miembros con rol owner/admin/manager de la organización activa.
CREATE FUNCTION app.apply_stock_count(p_count uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org uuid;
  v_wh uuid;
  v_line record;
  v_current numeric(14, 3);
  v_changes integer := 0;
BEGIN
  SELECT organization_id, warehouse_id INTO v_org, v_wh
    FROM public.stock_counts WHERE id = p_count AND status = 'open' FOR UPDATE;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'recuento no abierto' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (app.can_access_org(v_org) AND app.has_org_role(v_org, ARRAY['owner', 'admin', 'manager'])) THEN
    RAISE EXCEPTION 'sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR v_line IN
    SELECT ingredient_id, counted_quantity FROM public.stock_count_lines
     WHERE count_id = p_count ORDER BY ingredient_id
  LOOP
    INSERT INTO public.stock_levels (organization_id, warehouse_id, ingredient_id, quantity)
    VALUES (v_org, v_wh, v_line.ingredient_id, 0)
    ON CONFLICT (warehouse_id, ingredient_id) DO NOTHING;
    SELECT quantity INTO v_current FROM public.stock_levels
     WHERE warehouse_id = v_wh AND ingredient_id = v_line.ingredient_id FOR UPDATE;
    UPDATE public.stock_count_lines SET expected_quantity = v_current
     WHERE count_id = p_count AND ingredient_id = v_line.ingredient_id;
    IF v_line.counted_quantity <> v_current THEN
      INSERT INTO public.stock_movements
        (organization_id, warehouse_id, ingredient_id, kind, quantity_delta, note, idempotency_key, count_id,
         created_by_user_id)
      VALUES (v_org, v_wh, v_line.ingredient_id, 'count', v_line.counted_quantity - v_current, 'Recuento',
              'count-' || p_count || '-' || v_line.ingredient_id, p_count, app.current_user_id());
      v_changes := v_changes + 1;
    END IF;
  END LOOP;
  UPDATE public.stock_counts SET status = 'applied', closed_at = now(), closed_by_user_id = app.current_user_id()
   WHERE id = p_count;
  RETURN v_changes;
END
$$;

REVOKE ALL ON FUNCTION app.check_stock_transfer() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.check_stock_correction() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.check_stock_count_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.check_stock_count_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.apply_stock_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.apply_stock_count(uuid) TO nebora_app;

ALTER TABLE stock_transfers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_transfers_select ON stock_transfers FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY stock_transfers_insert ON stock_transfers FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND created_by_user_id = app.current_user_id());
CREATE POLICY stock_counts_all ON stock_counts FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY stock_count_lines_all ON stock_count_lines FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));

GRANT SELECT, INSERT ON stock_transfers TO nebora_app;
GRANT SELECT, INSERT ON stock_counts TO nebora_app;
-- Cancelar lo hace la aplicación; aplicar, solo app.apply_stock_count.
GRANT UPDATE (status, closed_at, closed_by_user_id) ON stock_counts TO nebora_app;
GRANT SELECT, INSERT, DELETE ON stock_count_lines TO nebora_app;
GRANT UPDATE (counted_quantity, counted_by_user_id, updated_at) ON stock_count_lines TO nebora_app;
