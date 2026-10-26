# Estado actual del proyecto

**Estado:** Fases 0 y 1 completadas; Fase 2 completada (horarios, edición del local, panel de inicio, navegación adaptada al móvil y cambio de organización); Fase 3 casi completa (faltan idiomas); Fase 4 casi completa (faltan subrecetas y devoluciones a proveedor); Fase 5 completa (lista de espera interna; alta pública pendiente). Puerta de salida de la Fase 1 superada: las pruebas negativas de aislamiento pasan y el proyecto compila. CI de GitHub en verde.

**Última actualización:** 2026-10-26 — navegación por local (cartas, inventario y compras de cada local) y catálogo común.

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
- [x] Web pública del local (migración 0013): página `/<org>/<local>` editable en `/app/<org>/establishments/<id>/site` (estilo, eslogan, titular, texto, foto principal, teléfono, WhatsApp, Instagram, 3 destacados, carta destacada, publicar/despublicar); temas Futurista, Clásico y Mediterráneo inspirados en los diseños de referencia (y Moderno neutro); carta destacada con pestañas por categoría y carrusel; contacto y horario reales; navegación inferior en móvil. Si la web está publicada, la carta completa `/m/...` y la reserva `/r/...` se muestran dentro de ella con el mismo estilo; si no, con el diseño anterior (la carta con su tema). La carta sin web también muestra fotos y recomendados. Fotos de platos (subida con validación y reprocesado a WebP sin metadatos) y marca «recomendado» en el editor de cartas; las fotos solo son públicas si las usa contenido publicado. Slugs de organización reservados.
- [x] Cabeceras de seguridad básicas y CI en GitHub (`.github/workflows/ci.yml`), que se ejecuta en `main`, en las ramas `claude/**` y en los PR; primera ejecución en verde el 2026-10-23.
- [x] Preparación del despliegue: `Dockerfile` con imagen web (salida autónoma de Next, usuario sin privilegios, `HEALTHCHECK`) e imagen de herramientas (migraciones y retención), `/api/health` (200/503 sin detalles), tiempo máximo de conexión a la BD, manual `docs/DEPLOYMENT.md`. Ensayo local en contenedores: migraciones desde cero, roles sin privilegios, salud y recorrido completo en navegador sin errores.

## No implementado todavía
- [ ] Envío de invitaciones por correo (hoy el enlace lo entrega quien invita; D-010).
- [ ] Permisos por establecimiento (`establishment_memberships`).
- [ ] MFA, verificación de correo y recuperación de contraseña (requieren proveedor de correo).
- [ ] CSP completa con nonces para scripts.
- [ ] Cartas: traducciones. Almacenamiento de imágenes fuera de la BD y limpieza de huérfanas. (El enlace directo `/m/...` sigue cambiando si se renombra la carta; los QR usan el enlace estable.)
- [ ] Inventario: subrecetas, devoluciones a proveedor, envío de pedidos por correo.
- [ ] Alta en lista de espera desde la web pública, avisos al cliente (correo/SMS), cancelación por el cliente.
- [ ] Programar `pnpm privacy:retention` a diario en el despliegue (sin ello la anonimización no es automática).
- [ ] Personal, informes.
- [x] Edición de los datos del local desde la interfaz (nombre, dirección, zona horaria, identificador) con aviso de que cambia las URL públicas (los QR siguen funcionando).
- [x] Horario: el formulario muestra los turnos guardados más uno libre (hasta 6); antes mostraba 2 y al guardar se perdían los demás.
- [x] Aviso de «cambios sin publicar» en el editor de cartas y en la lista de cartas del local (compara el borrador con la versión publicada: precios, alérgenos, fotos, recomendados, tema y orden).
- [x] Panel de inicio (`/app/<org>`): por local, abierto/cerrado y próxima apertura, reservas activas, comensales, pendientes de confirmar y próxima reserva de hoy; avisos de stock bajo mínimo, pedidos pendientes de recibir y borradores, escandallos incompletos y cartas por publicar, cada uno con enlace. Cada bloque solo aparece con su permiso. Las tarjetas de locales sustituyen a la lista anterior.
- [x] Navegación del panel: pestañas con la sección actual marcada y desplazables en móvil, cambio de organización, controles de formulario que no desbordan. Comprobado sin desplazamiento horizontal a 390 px en las 11 páginas del panel.
- [x] Traspasos entre almacenes (migración 0014): salida y entrada en la misma transacción, la BD exige ambas patas al confirmar; idempotentes; sin stock negativo también con peticiones simultáneas; no se anulan pata a pata (se compensan con otro traspaso).
- [x] Recuentos físicos (migración 0014): uno abierto por almacén; recuento «ciego» (no muestra el stock del sistema mientras está abierto); 0 es un valor válido; lo aplica un responsable (`inventory.manage`) y la BD calcula cada diferencia con el saldo bloqueado en ese instante; resultado con contado, en sistema y ajuste; cancelable; la aplicación no puede marcarlo aplicado sin ajustes ni tocar líneas cerradas. Página `/app/<org>/inventory/counts/<id>`.
- [x] Límites por IP: login (50 intentos cada 15 min, además de 5 fallos por correo) y registro (50 por hora), con huella de la IP (nunca en claro) en la misma tabla que la reserva online.
- [x] Lista de espera (migración 0015): entradas por local y día con franja, comensales y contacto (obligatorio); indica la primera hora con mesa libre en la franja; conversión atómica en reserva confirmada (mesa más ajustada) o cancelación; aviso al cliente manual (enlaces de llamada/correo). Incluida en retención, búsqueda, exportación y borrado de datos de clientes.
- [x] Formularios: si el servidor rechaza los datos ya no se pierde lo escrito (antes React vaciaba el formulario); solo se limpia al ir bien.
- [x] Rediseño del panel: barra lateral oscura con grupos e iconos (Inicio; Gestión; cada local con Resumen, Reservas, Sala y Web pública; Organización), usuario y salida abajo, menú desplegable en móvil; contenido en tarjetas, Inter + Fraunces alojadas por la app, acento violeta; inicio de sesión y registro en tarjeta. Sin apartados ficticios.
- [x] Pantalla «Diseño de tu web»: estilos como tarjetas con miniatura (textos y foto reales), descripción, colores, «Actual», «Usar…» (cambia solo el estilo) y «Vista previa» a pantalla completa (`/preview/site/<org>/<local>?theme=`), también sin publicar y solo para miembros.
- [x] Apartados en páginas largas (D-028): local (Resumen con accesos y próximos 7 días · Cartas · Horario · Datos del local), editor de carta (Contenido · Publicación y QR · Ajustes, con aviso de cambios sin publicar en los otros apartados), inventario (Stock · Movimientos · Recuentos · Ingredientes y almacenes) y web pública (Estilo · Contenido · Foto principal). Cada apartado tiene su URL (`?tab=`), funciona sin JavaScript y se puede enlazar.
- [x] Estadísticas por local (migración 0016, D-029): visitas a la web, a las cartas y escaneos de QR por día en los últimos 7, 30 o 90 días, gráfico y tabla por días, visitas por carta y resumen de reservas del periodo (total, online, comensales, canceladas, no presentadas). Contadores diarios anónimos: sin cookies, IP ni datos del visitante; no cuentan robots, precargas ni visitas con sesión de Nébora. Permiso `stats.read` (propietario, administrador y encargado). Página `/app/<org>/establishments/<id>/stats`.
- [x] Carta para imprimir: `/print/menu/<org>/<carta>` desde «Publicación y QR», versión publicada (por defecto) o borrador, con o sin descripciones, alérgenos y QR, a una o dos columnas; A4 con «Imprimir o guardar como PDF» del navegador, sin dependencias nuevas.
- [x] Navegación por local (D-030): en la barra lateral, bloque del local con Resumen, Cartas, Reservas, Sala, Inventario, Compras, Web pública y Estadísticas, con selector si hay varios locales (recuerda el último visitado). Inventario (`/establishments/<id>/inventory`: stock, movimientos, recuentos y almacenes del local) y compras (`/establishments/<id>/purchasing`) filtrados en el servidor; los traspasos pueden ir a cualquier almacén del grupo. «Catálogo» común: Productos, Ingredientes (`/ingredients`) y Proveedores (`/suppliers`). Con varios locales, «Inventario del grupo» y «Compras del grupo»; con uno solo, esas vistas llevan al local.
- [x] Prueba local gratuita con Docker Compose (`docker compose up --build`, instrucciones en README; verificado con recorrido completo y reinicio).
- [x] Demo temporal: `scripts/demo-sprite.sh` (una orden en una máquina Linux limpia; verificado en Ubuntu 24.04). Preparación para Fly.io: `fly.toml` de pruebas, `CLIENT_IP_HEADER` (IP real del cliente desde `Fly-Client-IP`), `pnpm db:provision`.
- [ ] Despliegue en Fly.io desde la CI: bloqueado a la espera de autorización expresa del titular (crea recursos de pago).
- [ ] Despliegue real: hosting, PostgreSQL gestionado, dominio/TLS, almacenamiento de fotos, monitorización y alertas, simulacro de restauración (ver `docs/DEPLOYMENT.md`).

## Pruebas (última ejecución: 2026-10-26, PostgreSQL 16.15 local)
| Comando | Resultado |
|---|---|
| `pnpm lint` | PASÓ (0 avisos) |
| `pnpm typecheck` | PASÓ |
| `pnpm test` | PASÓ — 14 archivos, 60 pruebas |
| `pnpm test:integration` | PASÓ — 20 archivos, 207 pruebas (BD efímera migrada desde cero) |
| `pnpm build` | PASÓ (incluido en `test:e2e`) |
| `pnpm test:e2e` | PASÓ — 25 pruebas en Chromium (con `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) |
| CI en GitHub Actions | Ver la ejecución del último commit en `claude/festive-rubin-bxwmo0`: lint, tipos, unitarias, integración, E2E y construcción de las imágenes Docker |
| `docker build` (runtime y tools) + ensayo en contenedores | PASÓ en local (con espejo `mirror.gcr.io` por límite de Docker Hub y el certificado del proxy del entorno) |

Comprobaciones de mutación (cambio temporal, revertido): al debilitar la política `app.can_access_org` fallaron 6 pruebas RLS; al quitar el bloqueo `FOR UPDATE` de los cambios de membresía, la prueba de concurrencia de propietarios falló en 3 de 3 ejecuciones; al quitar el bloqueo de la carta, la prueba de 6 publicaciones simultáneas falló en 3 de 3 (clave duplicada de versión); al permitir en `app.public_media` la foto de un perfil sin publicar, falló la prueba correspondiente; con el formulario de horario de 2 huecos fijos, falló la prueba E2E de turnos; sin el bloqueo del recuento en `app.apply_stock_count`, falló la prueba de aplicaciones simultáneas (una primera versión de esa prueba no detectaba el fallo y se rehízo con orden forzado). Al quitar la exclusión de visitas con sesión de Nébora, la prueba E2E de estadísticas falló (contó 2 visitas a la web en lugar de 1).

## Bloqueos
Ninguno. Proveedor de correo no configurado: bloquea el envío de invitaciones, la verificación y la recuperación de contraseña.

## Siguiente tarea
Multilenguaje de cartas y web (traducción manual por idioma, selector público), acordado con el usuario como siguiente paso para igualar el plan Pro de la competencia. Después: cartas con horario y «fuera de carta», formatos de precio por plato, galería de imágenes, logotipo y color propios. Otras candidatas: alta pública en lista de espera, cancelación por el cliente, subrecetas, personal y turnos, revisión OWASP ASVS.

## Riesgos pendientes
- Registro revela si un correo ya existe (mitigado al estar desactivado por defecto).
- El bloqueo de login por correo permite bloquear temporalmente a un usuario legítimo (15 min). Los límites por IP dependen de que la IP real llegue bien (`CLIENT_IP_HEADER` o un proxy que sobrescriba `X-Forwarded-For`); si no se conoce, todos esos clientes comparten contador.
- La cookie caduca a los 30 días desde el login aunque la sesión se renueve en BD.
- Tablas de identidad (`users`, `sessions`) sin RLS: solo accesibles desde el módulo de autenticación.
- Copias de seguridad definidas en `docs/DEPLOYMENT.md` pero sin simulacro de restauración real.
- La compilación depende de Google Fonts (las fuentes se descargan al compilar); si no hay acceso, la compilación falla.
- El token de invitación viaja en la URL (historial del navegador, logs de proxies); mitigado con un solo uso, caducidad y vínculo al correo.
- Cambiar el identificador de una carta publicada cambia su URL directa `/m/...` (los QR no se ven afectados).
- La página pública no tiene limitación de peticiones ni caché.
- La política de stock no negativo puede no encajar con cocinas que registran consumos antes que entradas; revisar con usuarios.
- Declarar alérgenos en un producto no cambia la carta pública hasta volver a publicarla (ahora se avisa en el panel, pero no se publica solo).
- La anonimización automática de datos de clientes depende de programar `pnpm privacy:retention`; los textos y plazos de privacidad deben validarlos el responsable del tratamiento y su asesoría.
- Reservas online: el límite por cliente depende de la IP; con `CLIENT_IP_HEADER` (p. ej. Fly) se usa la cabecera de la plataforma, si no `X-Forwarded-For`, que el proxy debe sobrescribir. El texto de consentimiento es genérico y debe revisarlo el responsable del tratamiento.
- Imágenes guardadas en PostgreSQL de forma provisional (cupo de 200 MB por organización); sin limpieza de huérfanas. La caché pública de imágenes es de 5 minutos: tras despublicar, una imagen puede seguir en cachés intermedias durante ese tiempo.
- El panel de inicio recalcula al cargar cada carta para detectar cambios sin publicar; con muchas cartas puede ser lento (medir antes de optimizar).
- El panel ya no sigue el modo oscuro del sistema (diseño solo claro, D-027).
- Las estadísticas de visitas son orientativas: cualquiera puede inflarlas recargando o con un navegador automatizado que imite a uno normal (no hay límite por visitante, a propósito, para no guardar datos de visitantes). Visitar la web y luego la carta cuenta dos páginas.
- La carta para imprimir depende del diálogo de impresión del navegador; el resultado puede variar ligeramente entre navegadores (probado en Chromium).
- No se ha hecho revisión de seguridad independiente; el producto no está listo para producción.
