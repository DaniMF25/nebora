# Registro de decisiones técnicas

Añadir decisiones con fecha, contexto, opciones consideradas, decisión, consecuencias y forma de revisión.

## D-001 — Monolito modular inicial
**Estado:** aceptada (2026-10-22). Implementado como una única aplicación Next.js con módulos de dominio en `src/server/modules`.

**Contexto:** el producto necesita avanzar con rapidez sin multiplicar la complejidad operativa.

**Decisión propuesta:** comenzar con un monolito modular y PostgreSQL; extraer servicios solo cuando haya necesidad demostrada.

**Consecuencias:** menor carga operativa inicial; es necesario mantener límites claros entre módulos.

## D-002 — Multiempresa con denegación por defecto
**Estado:** requisito obligatorio.

**Decisión:** toda operación privada debe comprobar organización y permisos en servidor; usar restricciones de base de datos y RLS cuando aplique.

**Implementación (2026-10-22):** ver D-006.

**Consecuencias:** se requieren pruebas negativas sistemáticas y especial atención a tareas asíncronas y exportaciones.

## D-003 — Sin TPV en la primera versión
**Estado:** confirmado por alcance.

**Decisión:** no implementar procesamiento de pagos, caja ni ventas operativas en la primera versión.

**Consecuencias:** las métricas de ventas no deben mostrarse como reales sin una fuente integrada y verificada.

## D-004 — Stack: Next.js 16 + PostgreSQL 16, sin servicios gestionados
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Contexto:** el entorno dispone de Node 22, PostgreSQL 16 local y acceso al registro npm; no hay credenciales de Supabase ni de otros proveedores.

**Opciones:** Supabase (Auth + Postgres); PostgreSQL propio con identidad propia; PostgreSQL propio con librería de autenticación (Auth.js, Better Auth).

**Decisión:** Next.js 16 (App Router), React 19, TypeScript estricto y PostgreSQL 16 accesible mediante `DATABASE_URL`. Versiones fijadas exactamente en `package.json`.

**Consecuencias:** portable a cualquier PostgreSQL gestionado ≥16. Las funciones que dependen de proveedores externos (correo, almacenamiento) quedan sin configurar y desactivadas.

**Revisión:** al elegir hosting/proveedores (Fase 7).

## D-005 — Autenticación con sesiones en base de datos y primitivas estándar
**Fecha:** 2026-10-22. **Estado:** aceptada (revisable).

**Contexto:** `docs/SECURITY.md` pide no implementar criptografía propia. No hay proveedor de identidad configurado.

**Decisión:** sesiones opacas almacenadas como SHA-256 en BD, contraseñas con `scrypt` de Node (parámetros OWASP), sin dependencias adicionales. No se inventa ningún algoritmo: solo se combinan primitivas de OpenSSL siguiendo patrones conocidos.

**Alternativas descartadas por ahora:** Better Auth/Auth.js (añaden esquema propio y superficie que no encaja directamente con RLS); argon2id (requiere módulo nativo; scrypt es la alternativa aceptada por OWASP).

**Consecuencias:** MFA, verificación de correo, recuperación de contraseña e invitaciones quedan pendientes (requieren correo). El registro público está desactivado por defecto (`AUTH_ALLOW_SIGNUP`). El bloqueo por correo puede usarse para bloquear temporalmente a un usuario legítimo (15 min); falta limitación por IP.

**Revisión:** antes de producción, o antes si se adopta un proveedor de identidad gestionado.

## D-006 — Aislamiento con RLS + rol de aplicación sin privilegios
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:** la web se conecta como `nebora_app` (no superusuario, no `BYPASSRLS`, no propietario). Las políticas RLS exigen que la fila pertenezca a la organización del contexto (`app.org_id`) y que el usuario del contexto (`app.user_id`) sea miembro activo. Las funciones auxiliares son `SECURITY DEFINER` con `search_path` fijo. Privilegios mínimos por columna. Además, los servicios filtran por `organization_id` y comprueban permisos.

**Consecuencias:** doble barrera probada con pruebas negativas a nivel de servicios, BD y E2E. Cada consulta privada debe ejecutarse dentro de `withTenant`/`withUser`. Las tareas en segundo plano deberán establecer el mismo contexto.

## D-007 — SQL parametrizado con `pg` y migraciones SQL propias
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:** sin ORM. Migraciones SQL inmutables (checksum) con un ejecutor mínimo y bloqueo consultivo.

**Consecuencias:** control total de RLS, transacciones y restricciones; tipado manual de resultados. Reevaluar un generador de tipos (p. ej. Kysely + codegen) si el número de consultas crece.

## D-008 — pnpm como gestor de paquetes
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Contexto:** `npm install` (10.9.4) fallaba con `Cannot read properties of null (reading 'edgesOut')` al resolver dependencias *peer* opcionales de Vitest 4.

**Decisión:** pnpm 10 (`packageManager` en `package.json`), con scripts de instalación permitidos solo para `esbuild`.

## D-009 — Estrategias de concurrencia para reservas e inventario
**Fecha:** 2026-10-22. **Estado:** propuesta (sin implementar).

**Decisión propuesta:** reservas con restricción de exclusión `btree_gist` sobre `(table_id, tstzrange)`; inventario con movimientos de solo inserción, clave de idempotencia única por organización y saldo actualizado en la misma transacción. Detalle en `docs/ARCHITECTURE.md`.

**Revisión:** al iniciar las Fases 4 y 5, con pruebas de concurrencia como criterio de aceptación.

## D-010 — Invitaciones sin proveedor de correo
**Fecha:** 2026-10-22. **Estado:** aceptada (provisional hasta configurar correo).

**Contexto:** no hay proveedor de correo; las invitaciones son necesarias para tener más de un miembro.

**Decisión:** la invitación genera un token de 256 bits que se muestra **una sola vez** a quien invita (owner/admin) para que lo entregue por su cuenta; en BD solo se guarda su SHA-256. Está ligada al correo invitado, caduca a los 7 días, se acepta una vez (fila bloqueada con `FOR UPDATE`) y no puede conceder el rol de propietario. Si el invitado no tiene cuenta, puede crearla desde el enlace aunque el registro público esté desactivado; el correo se toma de la invitación.

**Reglas de membresía:** nadie cambia su propio rol; solo un owner concede o retira la propiedad; siempre queda al menos un owner. Los cambios se serializan bloqueando la fila de la organización y releyendo el rol del actor tras el bloqueo (probado con operaciones concurrentes).

**Consecuencias:** el token viaja en la URL (`/invite/<token>`): puede quedar en el historial del navegador o en logs de proxies. Mitigaciones: un solo uso, caducidad, ligado al correo, `noindex` y `Referrer-Policy`. Cuando haya correo se enviará directamente al invitado.

## D-011 — Representación de horarios
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:** los turnos se guardan como minutos locales de apertura (0..1439) más duración (1..1440), interpretados con la zona horaria IANA del establecimiento. Un turno que pasa de medianoche pertenece al día en que abre. Las excepciones por fecha local sustituyen por completo el horario semanal de ese día (cerrado o turnos especiales). La conversión a instantes UTC se hace en el dominio con `Intl` (sin dependencias); en el cambio de hora de primavera una hora inexistente se desplaza hacia delante y en otoño la hora repetida toma la segunda ocurrencia. El cierre se calcula como hora local (un turno 20:00–02:00 la noche del cambio de otoño dura 7 h reales).

**Integridad:** restricciones de exclusión `btree_gist` impiden turnos solapados en BD (el cruce domingo→lunes lo valida el dominio); FKs compuestas `(organization_id, establishment_id)`; trigger que impide turnos en un día marcado como cerrado.

**Consecuencias:** las reservas (Fase 5) usarán `resolveOpeningIntervals` para calcular disponibilidad.

## D-012 — Modelo de cartas: catálogo, borrador y versiones inmutables
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:**
- Los productos forman un catálogo por organización (`menu_products`) compartido entre establecimientos; cada carta (`menus`) pertenece a un establecimiento y su borrador se compone de categorías (`menu_sections`) y elementos (`menu_items`) que apuntan a productos, con precio específico opcional por carta.
- Precios en céntimos enteros (`integer`), moneda EUR fija por ahora. Alérgenos: los 14 del anexo II del Reglamento (UE) 1169/2011, validados en servidor y con CHECK en BD.
- Publicar genera una instantánea JSON completa (`menu_versions.snapshot`, que incluye el tema) en una tabla de solo inserción y apunta `menus.published_version_id` a ella en la misma transacción, con la carta bloqueada (`FOR UPDATE`) para numerar versiones sin carreras. Se puede reactivar una versión anterior o despublicar.
- La página pública `/m/<org>/<establecimiento>/<carta>` solo lee mediante `app.published_menu()` (SECURITY DEFINER), que únicamente devuelve la instantánea publicada, sin identificadores internos.
- Un producto usado en un borrador no se puede borrar (FK `RESTRICT`); se archiva. Un borrador con productos archivados o categorías vacías no se puede publicar.

**Consecuencias:** cambiar el catálogo, el borrador o el tema no altera lo publicado hasta volver a publicar. Cambiar el identificador (slug) de la carta sí cambia la URL pública inmediatamente (y rompería QR ya impresos): pendiente de valorar redirecciones antes de implementar QR.

**Pendiente:** traducciones, QR, imágenes, permisos por establecimiento.

## D-013 — QR con enlace corto estable y dependencia `qrcode`
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Contexto:** un QR impreso no puede romperse si se renombra la carta (D-012). Codificar QR a mano (Reed-Solomon, máscaras, versiones) es propenso a errores.

**Decisión:**
- Cada carta tiene `public_code` (12 hex, 48 bits aleatorios, único, no modificable por el rol de aplicación). `/q/<código>` redirige (307) a la URL pública vigente solo si la carta está publicada; si no, 404.
- El QR codifica ese enlace corto absoluto, construido con `APP_BASE_URL` (origen validado; https obligatorio en producción salvo loopback). Sin `APP_BASE_URL` la función se muestra como no configurada.
- Dependencia `qrcode@1.5.4` (MIT, ampliamente usada, sin vulnerabilidades conocidas según `pnpm audit --prod`) para generar SVG y PNG en servidor, con corrección de errores nivel M.
- La descarga del QR exige sesión y `menus.read` en la organización (401/404 en otro caso) y se sirve con `Cache-Control: private, no-store` y una CSP restrictiva.

**Consecuencias:** la redirección añade un salto de red al escanear. El código público no es secreto: cualquiera con el QR puede ver la carta publicada, que es su finalidad.
