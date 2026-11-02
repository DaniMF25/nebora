-- 0031 — Planes de la organización (D-046).
--
-- * organizations.plan: 'basic' (web, cartas y estadísticas), 'advanced'
--   (+ reservas, sala, miembros, personal y turnos) o 'pro' (+ gestión:
--   catálogo con costes, inventario, proveedores y compras). Las nuevas
--   empiezan en Básico; las existentes pasan a PRO para no ocultarles nada.
-- * El servidor deriva los permisos del plan. Cambiarlo es cosa del
--   propietario (aún no hay proveedor de cobros) y lo hace el servidor; la
--   política de organizations ya exige rol owner/admin para actualizar.
-- * Al bajar a Básico el servidor desactiva la reserva online de todos los
--   locales, de modo que las funciones públicas (web, reserva, lista de
--   espera) dejan de ofrecerla también en la base de datos.

ALTER TABLE organizations
  ADD COLUMN plan text NOT NULL DEFAULT 'basic',
  ADD CONSTRAINT organizations_plan_check CHECK (plan IN ('basic', 'advanced', 'pro'));
UPDATE organizations SET plan = 'pro';
GRANT UPDATE (plan) ON organizations TO nebora_app;

-- Garantía en la BD: con plan Básico no se puede activar la reserva online.
CREATE FUNCTION app.check_booking_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.public_enabled
     AND (SELECT o.plan FROM public.organizations o WHERE o.id = NEW.organization_id) = 'basic' THEN
    RAISE EXCEPTION 'plan_without_booking' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.check_booking_plan() FROM PUBLIC;
CREATE TRIGGER reservation_settings_booking_plan BEFORE INSERT OR UPDATE OF public_enabled ON reservation_settings
  FOR EACH ROW EXECUTE FUNCTION app.check_booking_plan();
