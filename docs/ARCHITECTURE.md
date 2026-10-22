# Arquitectura

Estado: Fase 0 completada y Fase 1 (fundación segura) implementada en lo indicado en `project/STATUS.md`. Las secciones marcadas como **propuesta** aún no tienen código.

## Stack confirmado (verificado en el entorno el 2026-10-22)

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 22 | Disponible en el entorno y LTS. |
| Web | Next.js 16 (App Router) + React 19, TypeScript estricto | Stack preferente de la documentación; Server Components y Server Actions permiten mantener la autorización en servidor. |
| Base de datos | PostgreSQL 16 | Disponible localmente; RLS, restricciones de exclusión (`btree_gist`) y transacciones serializables. |
| Acceso a datos | `pg` (node-postgres) con SQL parametrizado, sin ORM | Control explícito de transacciones, `set_config` por transacción y RLS. Ver D-007. |
| Migraciones | SQL versionado en `db/migrations` + ejecutor propio (`src/server/db/migrate.ts`) | Inmutables (checksum), cada una en una transacción y con *advisory lock*. |
| Validación | Zod 4 con esquemas `.strict()` | Rechaza campos no previstos (asignación masiva). |
| Autenticación | Sesiones propias en BD con primitivas de Node (`scrypt`, `randomBytes`, SHA-256) | No hay proveedor de identidad configurado. Ver D-005. |
| Pruebas | Vitest (unit + integración contra PostgreSQL real), Playwright (E2E) | |
| Gestor de paquetes | pnpm | npm 10.9 fallaba al resolver peers opcionales de Vitest 4. Ver D-008. |

No se usa Supabase ni otro servicio gestionado: no hay credenciales en el entorno. Correo y almacenamiento siguen sin configurar.

## Estructura de carpetas

```
db/migrations/            SQL versionado (fuente de verdad del esquema)
scripts/                  migración, preparación local y servidor E2E
src/app/                  rutas Next.js (solo interfaz y Server Actions finas)
src/components/           componentes de interfaz
src/lib/                  tipos compartidos cliente/servidor (sin secretos)
src/server/               código exclusivo de servidor (importa "server-only")
  auth/                   contraseñas, tokens, sesiones, cookie
  tenancy/                contexto de organización (withUser/withTenant) y matriz de permisos
  modules/<dominio>/      casos de uso por dominio (organizations, establishments, …)
  audit/                  registro de auditoría
  db/                     pool, transacciones, migraciones
  config/                 validación de variables de entorno
tests/unit                pruebas sin base de datos
tests/integration         pruebas contra una base de datos efímera migrada desde cero
tests/e2e                 Playwright contra `next start` y una BD recreada
```

## Capas

1. **Interfaz** (`src/app`): páginas y Server Actions. Una acción solo extrae campos de una lista blanca, obtiene el usuario de la sesión y llama a un servicio. Ocultar botones es cosmético.
2. **Servicios** (`src/server/modules`): validan la entrada (Zod), comprueban permisos (`requirePermission`) y ejecutan consultas filtrando por `organization_id` del contexto.
3. **Contexto de inquilino** (`src/server/tenancy/context.ts`): abre una transacción, fija `app.user_id`, comprueba la membresía activa en BD, fija `app.org_id` y deriva los permisos del rol almacenado.
4. **Persistencia**: RLS, claves foráneas, CHECK/UNIQUE y privilegios mínimos por columna.

## Aislamiento multiempresa y autorización

- La **organización** es la frontera de aislamiento. Toda tabla privada tiene `organization_id` y RLS activado (una prueba de integración lo verifica para cada tabla con esa columna).
- Dos roles de BD:
  - Propietario del esquema (`DATABASE_ADMIN_URL`): ejecuta migraciones. No es superusuario.
  - `nebora_app` (`DATABASE_URL`): el que usa la web. Sin `SUPERUSER`, sin `BYPASSRLS`, no propietario; solo tiene los privilegios concedidos tabla a tabla y columna a columna (p. ej. no puede cambiar `organization_id`, ni actualizar o borrar `audit_events`, ni insertar en `organizations`).
- Cada transacción fija `app.user_id` y `app.org_id` con `set_config(..., true)` (ámbito de transacción, no se filtra a otras peticiones del pool).
- Las políticas exigen `organization_id = app.org_id` **y** membresía activa del usuario (`app.is_member`, `SECURITY DEFINER` con `search_path` fijo). Fijar por error una organización ajena en el contexto no da acceso.
- Escrituras en `memberships` y `organizations` exigen además rol owner/admin en la propia política.
- El alta de organizaciones solo es posible mediante `app.create_organization`, que crea la organización y la membresía de propietario de forma atómica.
- Un `organizationId` inexistente o ajeno responde **404** (no 403) para no revelar su existencia.
- La matriz de permisos (`src/server/tenancy/permissions.ts`) solo contiene permisos de funciones implementadas.
- **Límite del modelo:** la BD confía en el `app.user_id` que fija el servidor. RLS protege frente a errores de consulta, no frente a un servidor comprometido.
- **Patrón para tablas hijas:** `establishments` tiene `UNIQUE (organization_id, id)` para que las tablas hijas usen FKs compuestas `(organization_id, establishment_id)` e impidan relaciones entre organizaciones a nivel de esquema.

## Autenticación y sesiones

- Contraseñas: scrypt (N=2^17, r=8, p=1, sal de 16 bytes), formato versionado con los parámetros. Mínimo 12 caracteres y máximo 256, sin reglas de composición.
- Sesiones: token opaco de 256 bits en cookie `HttpOnly`, `SameSite=Lax` y, en producción, `Secure` con prefijo `__Host-`. En BD solo se guarda el SHA-256 del token. Caducidad de 30 días con renovación por uso en BD; revocación individual y global; un usuario deshabilitado pierde sus sesiones.
- Login: mismo error para usuario inexistente y contraseña incorrecta, hash ficticio para igualar tiempos, bloqueo temporal tras 5 fallos en 15 minutos por correo.
- Registro: desactivado salvo `AUTH_ALLOW_SIGNUP=true`.
- CSRF: las Server Actions de Next.js comparan `Origin` con `Host`; además `SameSite=Lax`.
- Cabeceras: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y una CSP parcial (`frame-ancestors`, `base-uri`, `form-action`, `object-src`).

## Transacciones e idempotencia

Las operaciones de escritura y su evento de auditoría se ejecutan en la misma transacción. Las correcciones de inventario serán movimientos compensatorios auditados.

## Reservas concurrentes (propuesta, Fase 5)

- `reservations` con `starts_at`/`ends_at` en `timestamptz` y la zona horaria del establecimiento para interpretar horarios locales.
- `reservation_table_assignments(organization_id, establishment_id, table_id, reservation_id, during tstzrange, active boolean)` con FKs compuestas por organización.
- Restricción `EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)` (extensión `btree_gist`, disponible y de confianza en PG16): la base de datos garantiza que dos asignaciones activas de la misma mesa no se solapan, aunque lleguen dos peticiones simultáneas. La segunda falla con `23P01` y se traduce a un conflicto.
- Combinaciones de mesas: una asignación por mesa física, en la misma transacción.
- Reservas públicas con clave de idempotencia y límite de peticiones.
- Prueba requerida: N peticiones concurrentes para la misma mesa y franja; exactamente una debe confirmarse.

## Movimientos de inventario (propuesta, Fase 4)

- `stock_movements` de solo inserción (sin `UPDATE`/`DELETE` para `nebora_app`), con cantidad con signo, unidad base, motivo, referencia de documento y `idempotency_key` con `UNIQUE (organization_id, idempotency_key)`.
- Saldo en `stock_levels` actualizado en la misma transacción que el movimiento, bloqueando la fila (`SELECT … FOR UPDATE`) o con `UPDATE … SET qty = qty + $delta`; una restricción CHECK impide saldos negativos si la política del almacén lo exige.
- Las correcciones se hacen con movimientos compensatorios, nunca editando movimientos.
- Cantidades en `numeric` (no `float`); conversión de unidades en el dominio con pruebas unitarias.
- Pruebas requeridas: reintento con la misma clave no duplica stock; movimientos concurrentes producen el saldo exacto.

## Pendiente de decidir

Proveedor de correo (necesario para invitaciones, verificación y recuperación de contraseña), almacenamiento de archivos, hosting, trabajos en segundo plano, MFA y política de copias de seguridad.
