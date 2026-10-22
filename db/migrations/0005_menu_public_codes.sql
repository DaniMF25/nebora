-- 0005 — Código público estable por carta para enlaces cortos y QR.
--
-- /q/<public_code> redirige a la URL pública vigente de la carta, así un QR
-- impreso sigue funcionando aunque cambien los identificadores (slugs). El
-- código no es secreto (la carta publicada es pública) pero es aleatorio
-- (48 bits) para no permitir enumerar cartas. La aplicación no puede
-- modificarlo (sin privilegio UPDATE sobre la columna).

ALTER TABLE menus
  ADD COLUMN public_code text NOT NULL
    DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  ADD CONSTRAINT menus_public_code_format CHECK (public_code ~ '^[0-9a-f]{12}$'),
  ADD CONSTRAINT menus_public_code_unique UNIQUE (public_code);

-- Resuelve un código público a la ruta de la carta SOLO si está publicada.
CREATE FUNCTION app.resolve_menu_code(p_code text)
RETURNS TABLE (organization_slug text, establishment_slug text, menu_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.slug::text, e.slug::text, m.slug::text
    FROM public.menus m
    JOIN public.establishments e ON e.organization_id = m.organization_id AND e.id = m.establishment_id
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.public_code = p_code
     AND m.published_version_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION app.resolve_menu_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_menu_code(text) TO nebora_app;
