-- 0010 — Reservas y asignación de mesas.
--
-- Integridad frente a reservas concurrentes:
--   * reservation_tables guarda, por mesa asignada, el intervalo de la reserva
--     (`during`) y si bloquea la mesa (`active`). Una restricción de exclusión
--     impide que dos asignaciones activas de la misma mesa se solapen, aunque
--     lleguen dos peticiones a la vez. Los intervalos son semiabiertos [inicio,
--     fin): reservas consecutivas no se solapan.
--   * `during` y `active` no los escribe la aplicación: los copia un trigger
--     desde la reserva al insertar y los sincroniza cuando cambian sus horas o
--     su estado, de modo que no pueden desincronizarse.
--   * FKs compuestas con establishment_id: una reserva solo puede usar mesas
--     de su propio establecimiento y organización.
-- Datos personales mínimos del cliente (nombre y, opcionalmente, contacto).

ALTER TABLE dining_tables
  ADD CONSTRAINT dining_tables_org_est_id_unique UNIQUE (organization_id, establishment_id, id);

CREATE TABLE reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  establishment_id   uuid NOT NULL,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  party_size         smallint NOT NULL,
  status             text NOT NULL DEFAULT 'confirmed',
  customer_name      text NOT NULL,
  customer_phone     text,
  customer_email     text,
  notes              text,
  idempotency_key    text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT reservations_time_check
    CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '8 hours'),
  CONSTRAINT reservations_party_check CHECK (party_size BETWEEN 1 AND 100),
  CONSTRAINT reservations_status_check
    CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT reservations_name_length CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  CONSTRAINT reservations_phone_length CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 40),
  CONSTRAINT reservations_email_length CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
  CONSTRAINT reservations_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT reservations_key_length CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100),
  CONSTRAINT reservations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT reservations_org_est_id_unique UNIQUE (organization_id, establishment_id, id)
);
CREATE UNIQUE INDEX reservations_idempotency_unique ON reservations (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX reservations_est_time_idx ON reservations (organization_id, establishment_id, starts_at);
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Estados que ocupan la mesa.
CREATE FUNCTION app.reservation_blocks(p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('pending', 'confirmed', 'seated')
$$;

CREATE TABLE reservation_tables (
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  reservation_id   uuid NOT NULL,
  table_id         uuid NOT NULL,
  during           tstzrange NOT NULL,
  active           boolean NOT NULL,
  PRIMARY KEY (reservation_id, table_id),
  CONSTRAINT reservation_tables_reservation_fk FOREIGN KEY (organization_id, establishment_id, reservation_id)
    REFERENCES reservations (organization_id, establishment_id, id) ON DELETE CASCADE,
  CONSTRAINT reservation_tables_table_fk FOREIGN KEY (organization_id, establishment_id, table_id)
    REFERENCES dining_tables (organization_id, establishment_id, id) ON DELETE RESTRICT,
  CONSTRAINT reservation_tables_no_overlap EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)
);
CREATE INDEX reservation_tables_org_idx ON reservation_tables (organization_id, establishment_id);

-- Copia el intervalo y el estado de la reserva en cada asignación.
CREATE FUNCTION app.fill_reservation_table() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = NEW.reservation_id;
  NEW.during := tstzrange(r.starts_at, r.ends_at, '[)');
  NEW.active := app.reservation_blocks(r.status);
  RETURN NEW;
END
$$;
CREATE TRIGGER reservation_tables_fill BEFORE INSERT ON reservation_tables
  FOR EACH ROW EXECUTE FUNCTION app.fill_reservation_table();

CREATE FUNCTION app.sync_reservation_tables() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.reservation_tables
     SET during = tstzrange(NEW.starts_at, NEW.ends_at, '[)'),
         active = app.reservation_blocks(NEW.status)
   WHERE reservation_id = NEW.id;
  RETURN NULL;
END
$$;
CREATE TRIGGER reservations_sync_tables AFTER UPDATE OF starts_at, ends_at, status ON reservations
  FOR EACH ROW EXECUTE FUNCTION app.sync_reservation_tables();

REVOKE ALL ON FUNCTION app.fill_reservation_table() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_reservation_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reservation_blocks(text) TO nebora_app;

ALTER TABLE reservations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservations_all ON reservations FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY reservation_tables_select ON reservation_tables FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY reservation_tables_insert ON reservation_tables FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY reservation_tables_delete ON reservation_tables FOR DELETE TO nebora_app
  USING (app.can_access_org(organization_id));

-- Las reservas no se borran: se cancelan (trazabilidad).
GRANT SELECT, INSERT ON reservations TO nebora_app;
GRANT UPDATE (starts_at, ends_at, party_size, status, customer_name, customer_phone, customer_email, notes)
  ON reservations TO nebora_app;
-- Sin UPDATE: `during` y `active` solo los escriben los triggers.
GRANT SELECT, INSERT, DELETE ON reservation_tables TO nebora_app;
