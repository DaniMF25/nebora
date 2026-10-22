# Estado actual del proyecto

**Estado:** Fases 0 y 1 completadas; Fase 2 en curso (horarios hechos); Fase 3 casi completa (faltan idiomas); Fase 4 en curso (stock, movimientos, recetas y escandallos). Puerta de salida de la Fase 1 superada: las pruebas negativas de aislamiento pasan y el proyecto compila. CI de GitHub aún sin ejecutar.

**Última actualización:** 2026-10-22 — recetas y escandallos.

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
- [x] Invitaciones (migración 0002): token hasheado de un solo uso, ligado al correo, caducidad de 7 días, alta de cuenta desde el enlace; gestión de miembros (cambio de rol, baja) sin escalada y con al menos un propietario, también bajo concurrencia. Página `/app/<org>/members` e `/invite/<token>`.
- [x] Redirección segura tras login (`?next=`).
- [x] Horarios (migración 0003): horario semanal con turnos nocturnos, excepciones por fecha (cerrado o turnos especiales), cálculo de apertura con zona horaria y cambios de hora, restricciones de exclusión y FKs compuestas. Página `/app/<org>/establishments/<id>` con editor, «abierto ahora» y próximos 7 días.
- [x] Cartas (migración 0004): catálogo de productos con precio en céntimos y alérgenos UE; cartas por establecimiento con categorías, orden y precio específico; publicación atómica de versiones inmutables (historial, reactivar, despublicar); vista previa del borrador; página pública `/m/<org>/<local>/<carta>` que solo lee la versión publicada; 4 temas.
- [x] QR de cada carta (migración 0005): enlace corto permanente `/q/<código>` que sobrevive a cambios de identificador, descarga SVG/PNG protegida; requiere `APP_BASE_URL`.
- [x] Inventario (migración 0006): ingredientes con unidad base y mínimo de reposición, almacenes por establecimiento, movimientos de solo inserción (entrada, consumo, merma, ajuste, corrección compensatoria) con idempotencia; saldo mantenido por trigger, nunca negativo; página `/app/<org>/inventory`.
- [x] Recetas y escandallos (migración 0007): receta por ración de cada producto; coste de referencia y alérgenos por ingrediente; coste por ración, margen y % de coste (incompleto si falta algún coste, visible solo con `costs.read`); aviso de alérgenos no declarados; elaboración de N raciones que descuenta stock de forma atómica e idempotente. Página `/app/<org>/products/<id>`.
- [x] Cabeceras de seguridad básicas y workflow de CI (`.github/workflows/ci.yml`, aún no ejecutado en GitHub).

## No implementado todavía
- [ ] Envío de invitaciones por correo (hoy el enlace lo entrega quien invita; D-010).
- [ ] Permisos por establecimiento (`establishment_memberships`).
- [ ] MFA, verificación de correo y recuperación de contraseña (requieren proveedor de correo).
- [ ] Limitación de peticiones por IP.
- [ ] CSP completa con nonces para scripts.
- [ ] Cartas: traducciones e imágenes. (El enlace directo `/m/...` sigue cambiando si se renombra la carta; los QR usan el enlace estable.)
- [ ] Inventario: traspasos entre almacenes, recuentos, proveedores, órdenes de compra y recepciones; subrecetas.
- [ ] Dashboard, reservas, personal, informes.
- [ ] Edición de datos del establecimiento desde la interfaz (el servicio existe).
- [ ] El formulario de horario ofrece 2 turnos por día (el servidor admite 6); guardar desde la interfaz sustituye todos.
- [ ] Infraestructura y despliegue.

## Pruebas (última ejecución: 2026-10-22, PostgreSQL 16.15 local)
| Comando | Resultado |
|---|---|
| `pnpm lint` | PASÓ (0 avisos) |
| `pnpm typecheck` | PASÓ |
| `pnpm test` | PASÓ — 9 archivos, 39 pruebas |
| `pnpm test:integration` | PASÓ — 9 archivos, 101 pruebas (BD efímera migrada desde cero) |
| `pnpm build` | PASÓ (incluido en `test:e2e`) |
| `pnpm test:e2e` | PASÓ — 11 pruebas en Chromium (con `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) |
| CI en GitHub Actions | NO EJECUTADO todavía |

Comprobaciones de mutación (cambio temporal, revertido): al debilitar la política `app.can_access_org` fallaron 6 pruebas RLS; al quitar el bloqueo `FOR UPDATE` de los cambios de membresía, la prueba de concurrencia de propietarios falló en 3 de 3 ejecuciones; al quitar el bloqueo de la carta, la prueba de 6 publicaciones simultáneas falló en 3 de 3 (clave duplicada de versión).

## Bloqueos
Ninguno. Proveedor de correo no configurado: bloquea el envío de invitaciones, la verificación y la recuperación de contraseña.

## Siguiente tarea
Fase 4 (continuación): proveedores, órdenes de compra (borrador → enviada → recibida parcial/total) y recepciones que generen entradas de stock idempotentes y actualicen el coste de referencia del ingrediente con el último precio de compra.

## Riesgos pendientes
- Registro revela si un correo ya existe (mitigado al estar desactivado por defecto).
- El bloqueo de login por correo permite bloquear temporalmente a un usuario legítimo; falta límite por IP.
- La cookie caduca a los 30 días desde el login aunque la sesión se renueve en BD.
- Tablas de identidad (`users`, `sessions`) sin RLS: solo accesibles desde el módulo de autenticación.
- Copias de seguridad y restauración no definidas.
- El token de invitación viaja en la URL (historial del navegador, logs de proxies); mitigado con un solo uso, caducidad y vínculo al correo.
- Cambiar el identificador de una carta publicada cambia su URL directa `/m/...` (los QR no se ven afectados).
- La página pública no tiene limitación de peticiones ni caché.
- La política de stock no negativo puede no encajar con cocinas que registran consumos antes que entradas; revisar con usuarios.
- Declarar alérgenos en un producto no cambia la carta pública hasta volver a publicarla; conviene avisar de cartas publicadas desactualizadas.
- No se ha hecho revisión de seguridad independiente; el producto no está listo para producción.
