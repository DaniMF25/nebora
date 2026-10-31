-- 0024 — Formatos de precio por plato (D-038).
--
-- menu_products.formats: NULL = precio único (price_cents); si no, de 2 a 6
-- formatos {label, priceCents} («Media ración», «Ración», «Copa», «Botella»…).
-- Con formatos, price_cents es el más bajo (lo fija el servidor): se usa para
-- ordenar, en desplegables («desde») y en los escandallos. El servidor valida
-- nombres únicos; la BD, la forma.

ALTER TABLE menu_products
  ADD COLUMN formats jsonb,
  ADD CONSTRAINT menu_products_formats_shape CHECK (
    formats IS NULL OR (
      jsonb_typeof(formats) = 'array'
      AND jsonb_array_length(formats) BETWEEN 2 AND 6
      AND jsonb_array_length(formats) = jsonb_array_length(jsonb_path_query_array(formats,
        '$[*] ? (@.label.type() == "string"
                 && @.priceCents >= 0 && @.priceCents <= 100000000 && @.priceCents == @.priceCents.floor())'))
    )
  );
GRANT UPDATE (formats) ON menu_products TO nebora_app;

-- Fuera de carta (D-037) con formatos: el precio especial solo se aplica a
-- platos de precio único (cambia el tipo de resultado).
DROP FUNCTION app.public_specials(text, text);
CREATE FUNCTION app.public_specials(p_org_slug text, p_establishment_slug text)
RETURNS TABLE (product_name text, description text, price_cents integer, allergens text[], image_media_id uuid,
               i18n jsonb, languages text[], formats jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.name, p.description,
         CASE WHEN p.formats IS NULL THEN COALESCE(s.price_override_cents, p.price_cents) ELSE p.price_cents END,
         p.allergens, p.image_media_id, p.i18n, e.languages, p.formats
    FROM public.organizations o
    JOIN public.establishments e ON e.organization_id = o.id
    JOIN public.menu_specials s ON s.organization_id = o.id AND s.establishment_id = e.id
    JOIN public.menu_products p ON p.organization_id = s.organization_id AND p.id = s.product_id
   WHERE o.slug = p_org_slug::citext AND e.slug = p_establishment_slug::citext AND app.special_is_public(s)
   ORDER BY s.created_at, s.id
$$;
REVOKE ALL ON FUNCTION app.public_specials(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_specials(text, text) TO nebora_app;
