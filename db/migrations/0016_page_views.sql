-- 0016 — Estadísticas de visitas de la web, las cartas y los QR.
--
-- * Solo contadores diarios agregados por local, carta y tipo: no se guarda
--   ninguna IP, huella, cookie ni identificador del visitante (no son datos
--   personales y no requieren consentimiento ni plazo de conservación).
-- * El día es el día local del establecimiento.
-- * Solo se cuentan páginas publicadas. La aplicación no puede escribir en la
--   tabla: lo hace únicamente con las funciones app.record_*, que resuelven
--   el destino por sus identificadores públicos.
-- * Los recuentos son orientativos: un visitante puede recargar o forzar
--   visitas. Ver D-029.

CREATE TABLE page_view_daily (
  organization_id  uuid NOT NULL,
  establishment_id uuid NOT NULL,
  -- NULL para la web del local; la carta en las visitas a cartas y QR.
  menu_id          uuid,
  kind             text NOT NULL,
  day              date NOT NULL,
  views            integer NOT NULL DEFAULT 0,
  CONSTRAINT page_view_daily_kind_check CHECK (kind IN ('site', 'menu', 'qr')),
  CONSTRAINT page_view_daily_target_check CHECK ((kind = 'site') = (menu_id IS NULL)),
  CONSTRAINT page_view_daily_views_check CHECK (views >= 0),
  CONSTRAINT page_view_daily_establishment_fk FOREIGN KEY (organization_id, establishment_id)
    REFERENCES establishments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT page_view_daily_menu_fk FOREIGN KEY (organization_id, menu_id)
    REFERENCES menus (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT page_view_daily_unique UNIQUE NULLS NOT DISTINCT (establishment_id, menu_id, kind, day)
);
CREATE INDEX page_view_daily_est_day_idx ON page_view_daily (organization_id, establishment_id, day);

ALTER TABLE page_view_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_view_daily_select ON page_view_daily FOR SELECT TO nebora_app
  USING (app.can_access_org(organization_id));
GRANT SELECT ON page_view_daily TO nebora_app;

CREATE FUNCTION app.bump_page_view(p_org uuid, p_establishment uuid, p_menu uuid, p_kind text, p_timezone text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.page_view_daily AS d (organization_id, establishment_id, menu_id, kind, day, views)
  VALUES (p_org, p_establishment, p_menu, p_kind, (now() AT TIME ZONE p_timezone)::date, 1)
  ON CONFLICT ON CONSTRAINT page_view_daily_unique DO UPDATE SET views = d.views + 1
$$;
REVOKE ALL ON FUNCTION app.bump_page_view(uuid, uuid, uuid, text, text) FROM PUBLIC;

-- Visita a la web publicada del local.
CREATE FUNCTION app.record_site_view(p_org_slug text, p_establishment_slug text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
BEGIN
  SELECT e.organization_id, e.id, e.timezone INTO r
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.establishment_profiles p ON p.establishment_id = e.id AND p.organization_id = e.organization_id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND p.published;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app.bump_page_view(r.organization_id, r.id, NULL, 'site', r.timezone);
  RETURN true;
END
$$;

-- Visita a una carta publicada.
CREATE FUNCTION app.record_menu_view(p_org_slug text, p_establishment_slug text, p_menu_slug text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
BEGIN
  SELECT m.organization_id, m.establishment_id, m.id, e.timezone INTO r
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.menus m ON m.organization_id = o.id AND m.establishment_id = e.id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND m.slug = p_menu_slug::citext
     AND m.published_version_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app.bump_page_view(r.organization_id, r.establishment_id, r.id, 'menu', r.timezone);
  RETURN true;
END
$$;

-- Escaneo del QR (enlace corto /q/<código>) de una carta publicada.
CREATE FUNCTION app.record_qr_scan(p_code text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
BEGIN
  SELECT m.organization_id, m.establishment_id, m.id, e.timezone INTO r
    FROM public.menus m
    JOIN public.establishments e ON e.organization_id = m.organization_id AND e.id = m.establishment_id
   WHERE m.public_code = p_code AND m.published_version_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM app.bump_page_view(r.organization_id, r.establishment_id, r.id, 'qr', r.timezone);
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION app.record_site_view(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_menu_view(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_qr_scan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_site_view(text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.record_menu_view(text, text, text) TO nebora_app;
GRANT EXECUTE ON FUNCTION app.record_qr_scan(text) TO nebora_app;
