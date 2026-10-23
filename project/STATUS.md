# Estado actual del proyecto

**Estado:** Fases 0 y 1 completadas; Fase 2 en curso (horarios hechos); Fase 3 casi completa (faltan idiomas); Fase 4 casi completa (faltan traspasos, recuentos y subrecetas); Fase 5 casi completa (falta lista de espera). Puerta de salida de la Fase 1 superada: las pruebas negativas de aislamiento pasan y el proyecto compila. CI de GitHub aún sin ejecutar.

**Última actualización:** 2026-10-23 — web pública del local con temas y fotos.

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
- [x] Compras (migración 0008): proveedores; pedidos con estados y numeración correlativa; recepciones parciales/totales que generan entradas de stock en la misma transacción, idempotentes, sin superar lo pedido y que actualizan el coste de referencia; el personal recibe sin ver precios. Páginas `/app/<org>/purchasing`.
- [x] Plano de sala (migración 0009): zonas por establecimiento con plano en cuadrícula; mesas con forma, tamaño y capacidad; sin solapes ni mesas fuera del plano garantizado en BD (también con movimientos simultáneos); edición arrastrando o con teclado. Página `/app/<org>/establishments/<id>/floor`.
- [x] Reservas internas (migración 0010): alta en hora local con búsqueda de mesas libres, combinación de mesas, validación de horario de apertura y capacidad, estados (pendiente, confirmada, en mesa, finalizada, cancelada, no presentada), modificación, idempotencia y vista del día con ocupación sobre el plano; sin solapes por mesa garantizado en BD con peticiones simultáneas. Página `/app/<org>/establishments/<id>/reservations`.
- [x] Reservas online (migración 0011): página pública `/r/<org>/<local>` activable por local con reglas (comensales, duración, intervalo, antelación, días vista, confirmación automática); horas disponibles reales; asignación automática de mesa resistente a peticiones simultáneas; límites por cliente, local y contacto; campo trampa; idempotencia; consentimiento registrado; acceso público solo mediante funciones que no exponen datos de clientes.
- [x] Privacidad de clientes (migración 0012): plazo de conservación configurable con anonimización (botón «Aplicar ahora» y script `pnpm privacy:retention` para programar), búsqueda por contacto, exportación JSON y borrado por anonimización (bloqueado con reservas futuras activas), solo owner/admin y auditado sin guardar el contacto. Página `/app/<org>/privacy`.
- [x] Web pública del local (migración 0013): página `/<org>/<local>` editable en `/app/<org>/establishments/<id>/site` (estilo, eslogan, titular, texto, foto principal, teléfono, WhatsApp, Instagram, 3 destacados, carta destacada, publicar/despublicar); temas Futurista, Clásico y Mediterráneo inspirados en los diseños de referencia (y Moderno neutro); carta destacada con pestañas por categoría y carrusel; contacto y horario reales; navegación inferior en móvil. Fotos de platos (subida con validación y reprocesado a WebP sin metadatos) y marca «recomendado» en el editor de cartas; las fotos solo son públicas si las usa contenido publicado. Slugs de organización reservados.
- [x] Cabeceras de seguridad básicas y workflow de CI (`.github/workflows/ci.yml`, aún no ejecutado en GitHub).

## No implementado todavía
- [ ] Envío de invitaciones por correo (hoy el enlace lo entrega quien invita; D-010).
- [ ] Permisos por establecimiento (`establishment_memberships`).
- [ ] MFA, verificación de correo y recuperación de contraseña (requieren proveedor de correo).
- [ ] Limitación de peticiones por IP.
- [ ] CSP completa con nonces para scripts.
- [ ] Cartas: traducciones. Aplicar el diseño de la web pública a la carta completa y a la página de reservas. Almacenamiento de imágenes fuera de la BD y limpieza de huérfanas. (El enlace directo `/m/...` sigue cambiando si se renombra la carta; los QR usan el enlace estable.)
- [ ] Inventario: traspasos entre almacenes, recuentos físicos, subrecetas, devoluciones a proveedor, envío de pedidos por correo.
- [ ] Lista de espera, avisos al cliente (correo/SMS), cancelación por el cliente.
- [ ] Programar `pnpm privacy:retention` a diario en el despliegue (sin ello la anonimización no es automática).
- [ ] Dashboard, personal, informes.
- [ ] Edición de datos del establecimiento desde la interfaz (el servicio existe).
- [ ] El formulario de horario ofrece 2 turnos por día (el servidor admite 6); guardar desde la interfaz sustituye todos.
- [ ] Infraestructura y despliegue.

## Pruebas (última ejecución: 2026-10-23, PostgreSQL 16.15 local)
| Comando | Resultado |
|---|---|
| `pnpm lint` | PASÓ (0 avisos) |
| `pnpm typecheck` | PASÓ |
| `pnpm test` | PASÓ — 12 archivos, 51 pruebas |
| `pnpm test:integration` | PASÓ — 15 archivos, 169 pruebas (BD efímera migrada desde cero) |
| `pnpm build` | PASÓ (incluido en `test:e2e`) |
| `pnpm test:e2e` | PASÓ — 18 pruebas en Chromium (con `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) |
| CI en GitHub Actions | NO EJECUTADO todavía |

Comprobaciones de mutación (cambio temporal, revertido): al debilitar la política `app.can_access_org` fallaron 6 pruebas RLS; al quitar el bloqueo `FOR UPDATE` de los cambios de membresía, la prueba de concurrencia de propietarios falló en 3 de 3 ejecuciones; al quitar el bloqueo de la carta, la prueba de 6 publicaciones simultáneas falló en 3 de 3 (clave duplicada de versión); al permitir en `app.public_media` la foto de un perfil sin publicar, falló la prueba correspondiente.

## Bloqueos
Ninguno. Proveedor de correo no configurado: bloquea el envío de invitaciones, la verificación y la recuperación de contraseña.

## Siguiente tarea
Aplicar el diseño de la web pública a la carta completa (`/m/...`, con fotos y recomendados) y a la página de reservas (`/r/...`), con la misma cabecera, contacto y navegación inferior. Después, a decidir: dashboard con métricas reales, traspasos y recuentos de inventario, o preparación del despliegue.

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
- La anonimización automática de datos de clientes depende de programar `pnpm privacy:retention`; los textos y plazos de privacidad deben validarlos el responsable del tratamiento y su asesoría.
- Reservas online: el límite por cliente depende de `X-Forwarded-For`; en producción el proxy debe sobrescribirla. El texto de consentimiento es genérico y debe revisarlo el responsable del tratamiento.
- Imágenes guardadas en PostgreSQL de forma provisional (cupo de 200 MB por organización); sin limpieza de huérfanas. La caché pública de imágenes es de 5 minutos: tras despublicar, una imagen puede seguir en cachés intermedias durante ese tiempo.
- No se ha hecho revisión de seguridad independiente; el producto no está listo para producción.
