-- 0029 — Revisión de seguridad (D-044).
--
-- Dos funciones de disparador SECURITY DEFINER conservaban el EXECUTE por
-- defecto de PUBLIC. Una función de disparador no se puede invocar
-- directamente, así que el riesgo real era nulo, pero ninguna función
-- SECURITY DEFINER debe ser ejecutable por PUBLIC: se revoca para que la
-- regla se cumpla sin excepciones (la comprueba tests/integration/migrations).
-- Los disparadores siguen funcionando: no necesitan EXECUTE del que escribe.

REVOKE ALL ON FUNCTION app.menu_items_product_available() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.menu_specials_product_available() FROM PUBLIC;
