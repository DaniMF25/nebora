# Estado actual del proyecto

**Estado:** Fase 0 completada. Fase 1 (fundación segura) implementada y probada salvo gestión de miembros/invitaciones. Puerta de salida de la Fase 1 superada: las pruebas negativas de aislamiento pasan y el proyecto compila.

**Última actualización:** 2026-10-22 — bootstrap, base de datos, autenticación y aislamiento multiempresa.

## Completado y verificado
- [x] Aplicación Next.js 16 + TypeScript estricto con scripts reales: `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`.
- [x] Migración `0001_foundation.sql`: usuarios, sesiones, intentos de login, organizaciones, membresías, establecimientos, auditoría; RLS y privilegios mínimos para `nebora_app`.
- [x] Ejecutor de migraciones con checksum, transacción por migración y bloqueo consultivo.
- [x] Autenticación: registro (desactivado por defecto), login, logout, sesiones hasheadas con caducidad, renovación y revocación, bloqueo por fuerza bruta.
- [x] Contexto multiempresa en servidor (`withUser`/`withTenant`) y matriz de permisos por rol (owner, admin, manager, staff).
- [x] Organizaciones (crear, listar propias, ver, renombrar) y establecimientos (crear, listar, ver, editar con zona horaria validada).
- [x] Auditoría mínima de solo inserción (alta de organización, cambios de organización y establecimientos).
- [x] Interfaz mínima: login, registro, listado/alta de organizaciones, listado/alta de establecimientos.
- [x] Pruebas de aislamiento entre dos restaurantes en tres niveles: servicios, RLS directo en PostgreSQL y E2E en navegador.
- [x] Cabeceras de seguridad básicas y workflow de CI (`.github/workflows/ci.yml`, aún no ejecutado en GitHub).

## No implementado todavía
- [ ] Invitaciones y gestión de miembros (alta, cambio de rol, baja; reglas de "último propietario"). Requiere decidir el canal de entrega del enlace (sin proveedor de correo).
- [ ] Permisos por establecimiento (`establishment_memberships`).
- [ ] MFA, verificación de correo y recuperación de contraseña (requieren proveedor de correo).
- [ ] Limitación de peticiones por IP.
- [ ] CSP completa con nonces para scripts.
- [ ] Dashboard, horarios, cartas, inventario, reservas, personal, informes.
- [ ] Infraestructura y despliegue.

## Pruebas (última ejecución: 2026-10-22, PostgreSQL 16.15 local)
| Comando | Resultado |
|---|---|
| `pnpm lint` | PASÓ (0 avisos) |
| `pnpm typecheck` | PASÓ |
| `pnpm test` | PASÓ — 3 archivos, 13 pruebas |
| `pnpm test:integration` | PASÓ — 4 archivos, 38 pruebas (BD efímera migrada desde cero) |
| `pnpm build` | PASÓ |
| `pnpm test:e2e` | PASÓ — 4 pruebas en Chromium (con `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) |
| CI en GitHub Actions | NO EJECUTADO todavía |

Comprobación de mutación: al debilitar temporalmente la política `app.can_access_org`, 6 pruebas RLS fallaron, lo que confirma que detectan la regresión.

## Bloqueos
Ninguno. Proveedor de correo no configurado: bloquea invitaciones, verificación y recuperación de contraseña.

## Siguiente tarea
Fase 1 (cierre): invitaciones y gestión de miembros con token hasheado de un solo uso y caducidad, entregado como enlace copiable por el administrador mientras no haya proveedor de correo; reglas de último propietario y de no escalada (un admin no puede nombrar owners). Después, Fase 2/3: horarios del establecimiento y modelo de cartas (categorías, productos, borrador/publicación).

## Riesgos pendientes
- Registro revela si un correo ya existe (mitigado al estar desactivado por defecto).
- El bloqueo de login por correo permite bloquear temporalmente a un usuario legítimo; falta límite por IP.
- La cookie caduca a los 30 días desde el login aunque la sesión se renueve en BD.
- Tablas de identidad (`users`, `sessions`) sin RLS: solo accesibles desde el módulo de autenticación.
- Copias de seguridad y restauración no definidas.
- No se ha hecho revisión de seguridad independiente; el producto no está listo para producción.
