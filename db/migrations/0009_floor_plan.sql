-- 0009 — Plano de sala: zonas y mesas.
--
-- * Cada zona pertenece a un establecimiento y define un plano en cuadrícula
--   (ancho × alto en celdas). Las mesas se colocan en celdas enteras.
-- * La mesa referencia (organization_id, establishment_id, zone_id): no puede
--   quedar en una zona de otro establecimiento ni de otra organización.
-- * Dos mesas activas de una misma zona no pueden solaparse en el plano
--   (restricción de exclusión), aunque se muevan a la vez.
-- * Que la mesa quede dentro de los límites del plano se valida con un
--   trigger porque depende de las dimensiones de la zona.

CREATE TABLE zones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  name             text NOT NULL,
  position         integer NOT NULL DEFAULT 0,
  plan_width       smallint NOT NULL DEFAULT 16,
  plan_height      smallint NOT NULL DEFAULT 10,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zones_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT zones_name_length CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT zones_plan_size CHECK (plan_width BETWEEN 4 AND 40 AND plan_height BETWEEN 4 AND 40),
  CONSTRAINT zones_establishment_name_unique UNIQUE (establishment_id, name),
  CONSTRAINT zones_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT zones_org_est_id_unique UNIQUE (organization_id, establishment_id, id)
);

CREATE TABLE dining_tables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  zone_id          uuid NOT NULL,
  name             text NOT NULL,
  min_capacity     smallint NOT NULL DEFAULT 1,
  max_capacity     smallint NOT NULL,
  shape            text NOT NULL DEFAULT 'square',
  x                smallint NOT NULL,
  y                smallint NOT NULL,
  width            smallint NOT NULL DEFAULT 2,
  height           smallint NOT NULL DEFAULT 2,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dining_tables_zone_fk FOREIGN KEY (organization_id, establishment_id, zone_id)
    REFERENCES zones (organization_id, establishment_id, id) ON DELETE RESTRICT,
  CONSTRAINT dining_tables_name_length CHECK (char_length(name) BETWEEN 1 AND 20),
  CONSTRAINT dining_tables_capacity_check
    CHECK (min_capacity >= 1 AND max_capacity >= min_capacity AND max_capacity <= 50),
  CONSTRAINT dining_tables_shape_check CHECK (shape IN ('round', 'square', 'rectangle')),
  CONSTRAINT dining_tables_geometry_check
    CHECK (x >= 0 AND y >= 0 AND width BETWEEN 1 AND 8 AND height BETWEEN 1 AND 8),
  CONSTRAINT dining_tables_establishment_name_unique UNIQUE (establishment_id, name),
  CONSTRAINT dining_tables_org_id_unique UNIQUE (organization_id, id),
  -- Rectángulo semiabierto [x, x+w) × [y, y+h): mesas contiguas no se solapan.
  CONSTRAINT dining_tables_no_overlap EXCLUDE USING gist (
    zone_id WITH =,
    box(point(x + 0.01, y + 0.01), point(x + width - 0.01, y + height - 0.01)) WITH &&
  ) WHERE (active)
);
CREATE INDEX dining_tables_zone_idx ON dining_tables (organization_id, zone_id);
CREATE TRIGGER dining_tables_updated_at BEFORE UPDATE ON dining_tables
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- La mesa debe caber en el plano de su zona; y una zona no puede encogerse
-- dejando mesas fuera.
CREATE FUNCTION app.check_table_in_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_w smallint;
  v_h smallint;
BEGIN
  SELECT plan_width, plan_height INTO v_w, v_h FROM zones WHERE id = NEW.zone_id;
  IF NEW.x + NEW.width > v_w OR NEW.y + NEW.height > v_h THEN
    RAISE EXCEPTION 'table outside plan' USING ERRCODE = '23514', CONSTRAINT = 'dining_tables_inside_plan';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER dining_tables_inside_plan BEFORE INSERT OR UPDATE ON dining_tables
  FOR EACH ROW EXECUTE FUNCTION app.check_table_in_plan();

CREATE FUNCTION app.check_zone_fits_tables() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dining_tables t WHERE t.zone_id = NEW.id
              AND (t.x + t.width > NEW.plan_width OR t.y + t.height > NEW.plan_height)) THEN
    RAISE EXCEPTION 'zone too small for its tables' USING ERRCODE = '23514', CONSTRAINT = 'zones_fit_tables';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER zones_fit_tables BEFORE UPDATE OF plan_width, plan_height ON zones
  FOR EACH ROW EXECUTE FUNCTION app.check_zone_fits_tables();

ALTER TABLE zones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY zones_all ON zones FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY dining_tables_all ON dining_tables FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));

GRANT SELECT, INSERT, DELETE ON zones TO nebora_app;
GRANT UPDATE (name, position, plan_width, plan_height) ON zones TO nebora_app;
GRANT SELECT, INSERT, DELETE ON dining_tables TO nebora_app;
GRANT UPDATE (zone_id, name, min_capacity, max_capacity, shape, x, y, width, height, active) ON dining_tables TO nebora_app;
