-- 0003 — Horarios de apertura y excepciones por fecha.
--
-- Las horas se guardan en minutos locales del establecimiento (0..1439) más una
-- duración (1..1440), interpretados con `establishments.timezone`. Un turno que
-- pasa de medianoche (p. ej. 20:00–02:00) se representa con su duración.
-- Las tablas hijas usan FKs compuestas (organization_id, establishment_id), lo
-- que impide asociarlas a un establecimiento de otra organización.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE opening_hours (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  weekday          smallint NOT NULL,          -- ISO: 1 = lunes … 7 = domingo
  opens_minute     smallint NOT NULL,
  duration_minutes smallint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Minutos desde el lunes 00:00; permite detectar solapes con una restricción.
  week_range       int4range GENERATED ALWAYS AS (
    int4range((weekday - 1) * 1440 + opens_minute,
              (weekday - 1) * 1440 + opens_minute + duration_minutes)
  ) STORED,
  CONSTRAINT opening_hours_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT opening_hours_weekday_check CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT opening_hours_opens_check CHECK (opens_minute BETWEEN 0 AND 1439),
  CONSTRAINT opening_hours_duration_check CHECK (duration_minutes BETWEEN 1 AND 1440),
  -- Garantía en BD contra turnos solapados (el cruce domingo→lunes lo valida el dominio).
  CONSTRAINT opening_hours_no_overlap EXCLUDE USING gist (establishment_id WITH =, week_range WITH &&)
);
CREATE INDEX opening_hours_establishment_idx ON opening_hours (organization_id, establishment_id);

-- Una excepción por fecha local: cerrado todo el día o con turnos especiales
-- (que sustituyen al horario semanal de ese día).
CREATE TABLE schedule_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  date             date NOT NULL,
  closed           boolean NOT NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_exceptions_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT schedule_exceptions_note_length CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT schedule_exceptions_date_unique UNIQUE (establishment_id, date),
  CONSTRAINT schedule_exceptions_org_id_unique UNIQUE (organization_id, id)
);

CREATE TABLE schedule_exception_slots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  exception_id     uuid NOT NULL,
  opens_minute     smallint NOT NULL,
  duration_minutes smallint NOT NULL,
  day_range        int4range GENERATED ALWAYS AS (
    int4range(opens_minute, opens_minute + duration_minutes)
  ) STORED,
  CONSTRAINT schedule_exception_slots_exception_fk FOREIGN KEY (organization_id, exception_id)
    REFERENCES schedule_exceptions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT schedule_exception_slots_opens_check CHECK (opens_minute BETWEEN 0 AND 1439),
  CONSTRAINT schedule_exception_slots_duration_check CHECK (duration_minutes BETWEEN 1 AND 1440),
  CONSTRAINT schedule_exception_slots_no_overlap EXCLUDE USING gist (exception_id WITH =, day_range WITH &&)
);

-- Un día marcado como cerrado no puede tener turnos.
CREATE FUNCTION app.check_exception_slot_not_closed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedule_exceptions WHERE id = NEW.exception_id AND closed) THEN
    RAISE EXCEPTION 'closed exception cannot have slots' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER schedule_exception_slots_not_closed BEFORE INSERT OR UPDATE ON schedule_exception_slots
  FOR EACH ROW EXECUTE FUNCTION app.check_exception_slot_not_closed();

ALTER TABLE opening_hours            ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exception_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY opening_hours_all ON opening_hours FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY schedule_exceptions_all ON schedule_exceptions FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
CREATE POLICY schedule_exception_slots_all ON schedule_exception_slots FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));

-- Los horarios se sustituyen completos (borrar + insertar): no hace falta UPDATE.
GRANT SELECT, INSERT, DELETE ON opening_hours TO nebora_app;
GRANT SELECT, INSERT, DELETE ON schedule_exceptions TO nebora_app;
GRANT SELECT, INSERT, DELETE ON schedule_exception_slots TO nebora_app;
