-- 0030 — Personal y turnos (D-045).
--
-- * staff_members: fichas del personal de la organización. No exigen cuenta
--   en Nébora (muchos empleados no la tienen); pueden vincularse a la de un
--   miembro. Datos mínimos: nombre, puesto y si está activo (sin teléfono,
--   documento ni salario).
-- * staff_shifts: turnos de una persona en un local, con su intervalo real
--   [inicio, fin) en UTC. Una restricción de exclusión impide que una misma
--   persona tenga dos turnos que se solapen, también en locales distintos y
--   aunque lleguen dos altas a la vez. `during` lo calcula la BD.
-- * RLS: las fichas son de la organización; los turnos siguen además el
--   acceso por local (D-031), como el resto de tablas operativas de un local.

CREATE TABLE staff_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL,
  position        text,
  user_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_members_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT staff_members_position_length CHECK (position IS NULL OR char_length(position) BETWEEN 1 AND 40),
  CONSTRAINT staff_members_org_id_unique UNIQUE (organization_id, id)
);
-- Una cuenta, como mucho una ficha por organización.
CREATE UNIQUE INDEX staff_members_user_unique ON staff_members (organization_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX staff_members_org_idx ON staff_members (organization_id, name);
CREATE TRIGGER staff_members_updated_at BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_members_all ON staff_members FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT, DELETE ON staff_members TO nebora_app;
GRANT UPDATE (name, position, user_id, active) ON staff_members TO nebora_app;

CREATE TABLE staff_shifts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  establishment_id   uuid NOT NULL,
  staff_member_id    uuid NOT NULL,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  during             tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  position           text,
  notes              text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shifts_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_shifts_member_fk FOREIGN KEY (organization_id, staff_member_id)
    REFERENCES staff_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_shifts_time_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '16 hours'),
  CONSTRAINT staff_shifts_position_length CHECK (position IS NULL OR char_length(position) BETWEEN 1 AND 40),
  CONSTRAINT staff_shifts_notes_length CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 200),
  CONSTRAINT staff_shifts_no_overlap EXCLUDE USING gist (staff_member_id WITH =, during WITH &&)
);
CREATE INDEX staff_shifts_est_time_idx ON staff_shifts (organization_id, establishment_id, starts_at);
CREATE TRIGGER staff_shifts_updated_at BEFORE UPDATE ON staff_shifts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_shifts_all ON staff_shifts FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
GRANT SELECT, INSERT, DELETE ON staff_shifts TO nebora_app;
GRANT UPDATE (staff_member_id, starts_at, ends_at, position, notes) ON staff_shifts TO nebora_app;
