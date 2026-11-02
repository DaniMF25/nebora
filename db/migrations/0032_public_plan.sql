-- 0032 — Plan de la organización para las páginas públicas (D-047).
--
-- Con plan Básico la web pública usa el estilo Clásico sin color ni
-- tipografía propios y sin galería, aunque estén guardados (vuelven al
-- subir de plan). Las páginas públicas no tienen sesión: esta función da
-- solo el plan de la organización de un local. El plan no es un dato
-- sensible y no revela nada más.

CREATE FUNCTION app.public_establishment_plan(p_establishment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.plan FROM public.establishments e JOIN public.organizations o ON o.id = e.organization_id
   WHERE e.id = p_establishment_id
$$;
REVOKE ALL ON FUNCTION app.public_establishment_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_establishment_plan(uuid) TO nebora_app;
