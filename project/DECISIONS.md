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
