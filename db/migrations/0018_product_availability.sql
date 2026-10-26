-- 0018 — Productos disponibles por local.
--
-- El catálogo de productos sigue siendo común, pero cada producto puede estar
-- disponible en todos los locales (por defecto, también en los que se creen
-- después) o solo en algunos. Una carta solo puede incluir productos
-- disponibles en su local: lo garantiza un trigger además del servidor.
-- Las versiones ya publicadas no cambian (son instantáneas inmutables). D-032.

ALTER TABLE menu_products ADD COLUMN all_establishments boolean NOT NULL DEFAULT true;
GRANT UPDATE (all_establishments) ON menu_products TO nebora_app;

CREATE TABLE product_establishments (
  organization_id  uuid NOT NULL,
  product_id       uuid NOT NULL,
  establishment_id uuid NOT NULL,
  PRIMARY KEY (product_id, establishment_id),
  CONSTRAINT product_establishments_product_fk FOREIGN KEY (organization_id, product_id)
    REFERENCES menu_products (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT product_establishments_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX product_establishments_est_idx ON product_establishments (organization_id, establishment_id);

-- Catálogo común: cualquier miembro de la organización lo lee; escribir exige
-- el permiso de catálogo, que comprueba el servidor (como en menu_products).
ALTER TABLE product_establishments ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_establishments_all ON product_establishments FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id)) WITH CHECK (app.can_access_org(organization_id));
GRANT SELECT, INSERT, DELETE ON product_establishments TO nebora_app;

-- ¿Está el producto disponible en el local? SECURITY DEFINER para que el
-- trigger no dependa de lo que el usuario vea (p. ej. un miembro limitado).
CREATE FUNCTION app.product_available_in(p_org uuid, p_product uuid, p_establishment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.menu_products p
     WHERE p.organization_id = p_org AND p.id = p_product
       AND (p.all_establishments OR EXISTS (
             SELECT 1 FROM public.product_establishments pe
              WHERE pe.organization_id = p_org AND pe.product_id = p_product
                AND pe.establishment_id = p_establishment)))
$$;
REVOKE ALL ON FUNCTION app.product_available_in(uuid, uuid, uuid) FROM PUBLIC;

CREATE FUNCTION app.menu_items_product_available() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_est uuid;
BEGIN
  SELECT m.establishment_id INTO v_est
    FROM public.menu_sections s
    JOIN public.menus m ON m.organization_id = s.organization_id AND m.id = s.menu_id
   WHERE s.organization_id = NEW.organization_id AND s.id = NEW.section_id;
  -- Un producto de otra organización lo rechaza la FK compuesta; aquí solo la disponibilidad.
  IF EXISTS (SELECT 1 FROM public.menu_products p WHERE p.organization_id = NEW.organization_id AND p.id = NEW.product_id)
     AND NOT app.product_available_in(NEW.organization_id, NEW.product_id, v_est) THEN
    RAISE EXCEPTION 'product_not_available' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER menu_items_product_available BEFORE INSERT ON menu_items
  FOR EACH ROW EXECUTE FUNCTION app.menu_items_product_available();
GRANT EXECUTE ON FUNCTION app.product_available_in(uuid, uuid, uuid) TO nebora_app;
