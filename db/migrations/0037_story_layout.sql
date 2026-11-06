-- 0037 — Ubicación del texto y del botón en las historias (D-060).
--
-- El texto (titular y texto) puede ir arriba, en el centro o abajo, alineado
-- a la izquierda o centrado; el botón, junto al texto o abajo del todo.
-- Opciones fijas en lugar de posiciones libres: se ven igual en cualquier
-- tamaño de pantalla.

ALTER TABLE site_stories
  ADD COLUMN text_position text NOT NULL DEFAULT 'bottom',
  ADD COLUMN text_align text NOT NULL DEFAULT 'left',
  ADD COLUMN cta_position text NOT NULL DEFAULT 'text',
  ADD CONSTRAINT site_stories_text_position CHECK (text_position IN ('top', 'center', 'bottom')),
  ADD CONSTRAINT site_stories_text_align CHECK (text_align IN ('left', 'center')),
  ADD CONSTRAINT site_stories_cta_position CHECK (cta_position IN ('text', 'bottom'));
GRANT UPDATE (text_position, text_align, cta_position) ON site_stories TO nebora_app;

-- La lectura pública devuelve también la ubicación (cambia el tipo de resultado: se recrea).
DROP FUNCTION app.public_site_stories(uuid);
CREATE FUNCTION app.public_site_stories(p_establishment uuid)
RETURNS TABLE (id uuid, title text, body text, media_id uuid, cta_kind text, cta_label text, cta_url text,
               text_position text, text_align text, cta_position text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.id, s.title, s.body, s.media_id, s.cta_kind, s.cta_label, s.cta_url,
         s.text_position, s.text_align, s.cta_position, s.updated_at
    FROM public.site_stories s
   WHERE s.establishment_id = p_establishment AND app.story_is_public(s)
   ORDER BY s.position, s.id
$$;
REVOKE ALL ON FUNCTION app.public_site_stories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_site_stories(uuid) TO nebora_app;
