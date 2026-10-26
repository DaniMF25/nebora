-- 0017 — Acceso de los miembros a locales concretos.
--
-- Hasta ahora un miembro veía todos los locales de su organización. Ahora
-- cada membresía tiene «todos los locales» (por defecto, y obligatorio para
-- propietarios y administradores) o una lista de locales. Se aplica en dos
-- niveles: el servidor (contexto del tenant y servicios) y RLS en PostgreSQL,
-- que añade la comprobación de local a todas las tablas operativas de un
-- local. El catálogo común (productos, ingredientes, recetas, proveedores,
-- imágenes) sigue siendo de toda la organización. Ver D-031.
--
-- Las funciones públicas SECURITY DEFINER (web, carta, reservas online,
-- estadísticas) no cambian: no dependen del usuario.

ALTER TABLE memberships
  ADD COLUMN all_establishments boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT memberships_admins_all_establishments
    CHECK (role NOT IN ('owner', 'admin') OR all_establishments),
  ADD CONSTRAINT memberships_org_id_unique UNIQUE (organization_id, id);
GRANT UPDATE (all_establishments) ON memberships TO nebora_app;

CREATE TABLE membership_establishments (
  organization_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  establishment_id uuid NOT NULL,
  PRIMARY KEY (membership_id, establishment_id),
  CONSTRAINT membership_establishments_membership_fk FOREIGN KEY (organization_id, membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT membership_establishments_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX membership_establishments_est_idx ON membership_establishments (organization_id, establishment_id);

ALTER TABLE membership_establishments ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_establishments_select ON membership_establishments FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
CREATE POLICY membership_establishments_write ON membership_establishments FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND app.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (app.can_access_org(organization_id) AND app.has_org_role(organization_id, ARRAY['owner', 'admin']));
GRANT SELECT, INSERT, DELETE ON membership_establishments TO nebora_app;

-- Ámbito del usuario del contexto en la organización del contexto. Son
-- SECURITY DEFINER (como app.is_member) para leer membresías sin recursión de
-- políticas, y siempre se evalúan para el usuario y la organización del
-- contexto. En las políticas se usan como subconsultas escalares
-- «(SELECT app.…())» para que se evalúen una vez por consulta.
CREATE FUNCTION app.all_establishments_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT m.all_establishments FROM public.memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.organization_id = app.current_org_id() AND m.user_id = app.current_user_id()
       AND m.status = 'active' AND u.status = 'active'), false)
$$;

CREATE FUNCTION app.establishment_scope() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(me.establishment_id), '{}'::uuid[])
    FROM public.membership_establishments me
    JOIN public.memberships m ON m.organization_id = me.organization_id AND m.id = me.membership_id
    JOIN public.users u ON u.id = m.user_id
   WHERE m.organization_id = app.current_org_id() AND m.user_id = app.current_user_id()
     AND m.status = 'active' AND u.status = 'active'
$$;

REVOKE ALL ON FUNCTION app.all_establishments_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.establishment_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.all_establishments_access() TO nebora_app;
GRANT EXECUTE ON FUNCTION app.establishment_scope() TO nebora_app;

-- ---------------------------------------------------------------------------
-- Políticas: se añade el ámbito de locales a cada tabla operativa.
-- ---------------------------------------------------------------------------

DROP POLICY establishments_all ON establishments;
CREATE POLICY establishments_all ON establishments FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY opening_hours_all ON opening_hours;
CREATE POLICY opening_hours_all ON opening_hours FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY schedule_exceptions_all ON schedule_exceptions;
CREATE POLICY schedule_exceptions_all ON schedule_exceptions FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY menus_all ON menus;
CREATE POLICY menus_all ON menus FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY warehouses_all ON warehouses;
CREATE POLICY warehouses_all ON warehouses FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY zones_all ON zones;
CREATE POLICY zones_all ON zones FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY dining_tables_all ON dining_tables;
CREATE POLICY dining_tables_all ON dining_tables FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY reservations_all ON reservations;
CREATE POLICY reservations_all ON reservations FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY reservation_settings_all ON reservation_settings;
CREATE POLICY reservation_settings_all ON reservation_settings FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY waitlist_entries_all ON waitlist_entries;
CREATE POLICY waitlist_entries_all ON waitlist_entries FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY establishment_profiles_all ON establishment_profiles;
CREATE POLICY establishment_profiles_all ON establishment_profiles FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY schedule_exception_slots_all ON schedule_exception_slots;
CREATE POLICY schedule_exception_slots_all ON schedule_exception_slots FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR exception_id IN (SELECT id FROM public.schedule_exceptions)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR exception_id IN (SELECT id FROM public.schedule_exceptions)));

DROP POLICY menu_sections_all ON menu_sections;
CREATE POLICY menu_sections_all ON menu_sections FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR menu_id IN (SELECT id FROM public.menus)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR menu_id IN (SELECT id FROM public.menus)));

DROP POLICY menu_items_all ON menu_items;
CREATE POLICY menu_items_all ON menu_items FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR section_id IN (SELECT id FROM public.menu_sections)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR section_id IN (SELECT id FROM public.menu_sections)));

DROP POLICY purchase_orders_all ON purchase_orders;
CREATE POLICY purchase_orders_all ON purchase_orders FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)));

DROP POLICY purchase_order_lines_all ON purchase_order_lines;
CREATE POLICY purchase_order_lines_all ON purchase_order_lines FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR order_id IN (SELECT id FROM public.purchase_orders)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR order_id IN (SELECT id FROM public.purchase_orders)));

DROP POLICY stock_counts_all ON stock_counts;
CREATE POLICY stock_counts_all ON stock_counts FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)));

DROP POLICY stock_count_lines_all ON stock_count_lines;
CREATE POLICY stock_count_lines_all ON stock_count_lines FOR ALL TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR count_id IN (SELECT id FROM public.stock_counts)))
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR count_id IN (SELECT id FROM public.stock_counts)));

DROP POLICY menu_versions_select ON menu_versions;
CREATE POLICY menu_versions_select ON menu_versions FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR menu_id IN (SELECT id FROM public.menus)));
DROP POLICY menu_versions_insert ON menu_versions;
CREATE POLICY menu_versions_insert ON menu_versions FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND published_by_user_id = app.current_user_id() AND ((SELECT app.all_establishments_access()) OR menu_id IN (SELECT id FROM public.menus)));

DROP POLICY stock_levels_select ON stock_levels;
CREATE POLICY stock_levels_select ON stock_levels FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)));

DROP POLICY stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)));
DROP POLICY stock_movements_insert ON stock_movements;
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND created_by_user_id = app.current_user_id() AND ((SELECT app.all_establishments_access()) OR warehouse_id IN (SELECT id FROM public.warehouses)));

-- Un traspaso se ve desde los dos locales; registrarlo exige acceso a ambos.
DROP POLICY stock_transfers_select ON stock_transfers;
CREATE POLICY stock_transfers_select ON stock_transfers FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR from_warehouse_id IN (SELECT id FROM public.warehouses)
                     OR to_warehouse_id IN (SELECT id FROM public.warehouses)));
DROP POLICY stock_transfers_insert ON stock_transfers;
CREATE POLICY stock_transfers_insert ON stock_transfers FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND created_by_user_id = app.current_user_id()
              AND ((SELECT app.all_establishments_access()) OR (from_warehouse_id IN (SELECT id FROM public.warehouses)
                             AND to_warehouse_id IN (SELECT id FROM public.warehouses))));

DROP POLICY goods_receipts_select ON goods_receipts;
CREATE POLICY goods_receipts_select ON goods_receipts FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR order_id IN (SELECT id FROM public.purchase_orders)));
DROP POLICY goods_receipts_insert ON goods_receipts;
CREATE POLICY goods_receipts_insert ON goods_receipts FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND received_by_user_id = app.current_user_id() AND ((SELECT app.all_establishments_access()) OR order_id IN (SELECT id FROM public.purchase_orders)));
DROP POLICY goods_receipt_lines_select ON goods_receipt_lines;
CREATE POLICY goods_receipt_lines_select ON goods_receipt_lines FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR receipt_id IN (SELECT id FROM public.goods_receipts)));
DROP POLICY goods_receipt_lines_insert ON goods_receipt_lines;
CREATE POLICY goods_receipt_lines_insert ON goods_receipt_lines FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR receipt_id IN (SELECT id FROM public.goods_receipts)));

DROP POLICY reservation_tables_select ON reservation_tables;
CREATE POLICY reservation_tables_select ON reservation_tables FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
DROP POLICY reservation_tables_insert ON reservation_tables;
CREATE POLICY reservation_tables_insert ON reservation_tables FOR INSERT TO nebora_app
  WITH CHECK (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));
DROP POLICY reservation_tables_delete ON reservation_tables;
CREATE POLICY reservation_tables_delete ON reservation_tables FOR DELETE TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

DROP POLICY page_view_daily_select ON page_view_daily;
CREATE POLICY page_view_daily_select ON page_view_daily FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id) AND ((SELECT app.all_establishments_access()) OR establishment_id = ANY ((SELECT app.establishment_scope())::uuid[])));

-- ---------------------------------------------------------------------------
-- Invitaciones con ámbito: NULL = todos los locales.
-- ---------------------------------------------------------------------------

ALTER TABLE invitations
  ADD COLUMN establishment_ids uuid[],
  ADD CONSTRAINT invitations_admin_all_establishments CHECK (role <> 'admin' OR establishment_ids IS NULL),
  ADD CONSTRAINT invitations_establishment_ids_size
    CHECK (establishment_ids IS NULL OR cardinality(establishment_ids) BETWEEN 1 AND 200);

CREATE OR REPLACE FUNCTION app.accept_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user       uuid := app.current_user_id();
  v_email      citext;
  v_inv        public.invitations%ROWTYPE;
  v_membership uuid;
BEGIN
  SELECT email INTO v_email FROM public.users WHERE id = v_user AND status = 'active';
  IF v_user IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'authenticated active user required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.invitations
   WHERE token_hash = p_token_hash
     FOR UPDATE;

  IF NOT FOUND OR v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL
     OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.email <> v_email THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.memberships
              WHERE organization_id = v_inv.organization_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.memberships (organization_id, user_id, role, all_establishments)
  VALUES (v_inv.organization_id, v_user, v_inv.role, v_inv.establishment_ids IS NULL)
  RETURNING id INTO v_membership;

  -- Solo locales que sigan existiendo en la organización de la invitación.
  IF v_inv.establishment_ids IS NOT NULL THEN
    INSERT INTO public.membership_establishments (organization_id, membership_id, establishment_id)
    SELECT v_inv.organization_id, v_membership, e.id
      FROM public.establishments e
     WHERE e.organization_id = v_inv.organization_id AND e.id = ANY (v_inv.establishment_ids);
  END IF;

  UPDATE public.invitations
     SET accepted_at = now(), accepted_by_user_id = v_user
   WHERE id = v_inv.id;

  INSERT INTO public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_inv.organization_id, v_user, 'invitation.accepted', 'invitation', v_inv.id,
          jsonb_build_object('role', v_inv.role, 'all_establishments', v_inv.establishment_ids IS NULL));

  RETURN v_inv.organization_id;
END
$$;
