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
**Fecha:** 2026-10-22. **Estado:** implementada (inventario D-014; reservas D-018).

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

## D-014 — Inventario: saldo mantenido por la base de datos
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:**
- Cantidades en la unidad base del ingrediente (g, ml, unidades) como `numeric(14,3)`; en la aplicación se operan como milésimas enteras (`BigInt`), nunca en coma flotante. Entradas en kg, l o cl se convierten en servidor.
- `stock_movements` es de solo inserción para `nebora_app` (sin UPDATE/DELETE). Tipos: entrada, consumo, merma, ajuste y corrección; el signo se valida con CHECK según el tipo. Las correcciones referencian el movimiento original y solo puede haber una por movimiento.
- `stock_levels` no es escribible por la aplicación: lo actualiza un trigger `AFTER INSERT` (SECURITY DEFINER) que asegura la fila con saldo 0 y luego suma el delta con un UPDATE, que bloquea la fila y serializa movimientos del mismo artículo. Un único `INSERT … ON CONFLICT DO UPDATE` no sirve porque PostgreSQL valida el CHECK sobre la fila propuesta antes de resolver el conflicto (detectado por las pruebas).
- Política: el stock no puede ser negativo (CHECK); una salida sin existencias aborta la transacción.
- Idempotencia: clave obligatoria única por organización; `INSERT … ON CONFLICT DO NOTHING` y comparación con lo registrado (mismo contenido → se devuelve el existente sin reaplicar; distinto → conflicto). El formulario genera una clave nueva en cada renderizado.
- Borrar ingredientes, almacenes o establecimientos con historial está bloqueado (FK RESTRICT); se archivan.

**Pendiente:** traspasos entre almacenes, recuentos de inventario (ajuste a cantidad contada con bloqueo), recetas/escandallos, proveedores y compras.

## D-015 — Recetas, escandallos y alérgenos derivados
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:**
- Recetas por ración (`recipe_lines`) ligadas a productos de la carta, en la unidad base del ingrediente. Un producto tiene como máximo una línea por ingrediente.
- Coste de referencia manual por ingrediente en céntimos por kg, litro o unidad (`numeric(14,4)`); cuando existan compras se actualizará desde las recepciones. Si falta el coste de algún ingrediente, el escandallo se muestra como **incompleto** (no se estiman costes).
- Indicadores: coste por ración, margen bruto y % de coste **sobre el precio de carta tal como se introduce** (no se asume IVA).
- Nuevo permiso `costs.read` (owner, admin, manager): sin él no se devuelven costes ni márgenes, tampoco el coste de los ingredientes.
- Los ingredientes declaran alérgenos; si la receta contiene alérgenos no declarados en el producto se avisa y se ofrece declararlos (no se hace automáticamente). Recordatorio: el cambio solo llega a la carta pública al volver a publicar.
- «Registrar elaboración» descuenta los ingredientes de N raciones en una única transacción (todo o nada) con claves de idempotencia derivadas (`clave:ingrediente`).

**Pendiente:** subrecetas/elaboraciones intermedias, mermas de limpieza (rendimiento) por ingrediente, coste medio ponderado.

## D-016 — Compras: pedidos, recepciones y coste de última compra
**Fecha:** 2026-10-22. **Estado:** aceptada.

**Decisión:**
- Pedido de compra con estados `draft → sent → partially_received → received` (o `cancelled` desde borrador/enviado). Solo los borradores se editan. Numeración correlativa por organización con bloqueo consultivo de transacción y `UNIQUE (organization_id, number)`.
- «Marcar como enviado» solo cambia el estado: no hay integración de correo y la interfaz lo indica.
- Precios de línea en céntimos por kg, litro o unidad (`numeric(14,4)`); la cantidad, en unidad base.
- Recepción: con el pedido bloqueado (`FOR UPDATE`) se crean una entrada de stock por línea (mediante el mismo mecanismo idempotente de D-014), las líneas de recepción enlazadas a esos movimientos y el nuevo estado. Lo recibido se calcula sumando recepciones (no se duplica). No se puede recibir más de lo pendiente. Recepciones de solo inserción y clave de idempotencia única por organización.
- Por defecto, cada recepción actualiza el coste de referencia del ingrediente con el precio de la línea (último precio de compra), que alimenta los escandallos (D-015).
- Permisos: `purchasing.read`, `purchasing.manage`, `purchasing.receive`. El personal puede consultar pedidos y registrar recepciones sin ver precios (requieren `costs.read`).

**Pendiente:** recepción de cantidades por encima de lo pedido, devoluciones a proveedor, coste medio ponderado, precios por proveedor, envío del pedido por correo cuando haya proveedor configurado.

## D-017 — Plano de sala en cuadrícula
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- Zonas por establecimiento con un plano en cuadrícula (4–40 × 4–40 celdas). Las mesas ocupan rectángulos de celdas enteras (1–8 × 1–8) con forma (redonda, cuadrada, rectangular) y capacidad mínima/máxima (1–50).
- Integridad en BD: restricción de exclusión GiST sobre `box(...)` por zona (solo mesas activas) para que dos mesas no se solapen aunque se muevan a la vez; trigger que impide que una mesa quede fuera del plano y que el plano se encoja dejando mesas fuera; FK compuesta `(organization_id, establishment_id, zone_id)` que impide asignar una mesa a una zona de otro local.
- Los cambios de mesas bloquean la zona (`FOR UPDATE`, en orden estable si intervienen dos zonas).
- Nuevas mesas se colocan en el primer hueco libre. En la interfaz se mueven arrastrando (eventos de puntero) o con las flechas del teclado; cada movimiento se valida en el servidor y, si se rechaza, se revierte en pantalla.
- Permisos `tables.read` (todos) y `tables.manage` (owner, admin, manager).

**Pendiente:** combinaciones de mesas para grupos, elementos decorativos del plano (barra, paredes), estado de ocupación (llegará con las reservas).

## D-018 — Reservas con exclusión por mesa en la base de datos
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- `reservations` (hora de inicio/fin en `timestamptz`, comensales, estado, datos mínimos del cliente) y `reservation_tables` (mesas asignadas). Restricción `EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)` con intervalos semiabiertos: dos reservas activas no pueden solaparse en una mesa, aunque lleguen a la vez; las consecutivas sí se permiten.
- `during` y `active` de cada asignación los escriben triggers (SECURITY DEFINER) a partir de la reserva, al insertar y cuando cambian sus horas o estado; la aplicación no tiene UPDATE sobre ellos, así que no pueden desincronizarse.
- FKs compuestas `(organization_id, establishment_id, …)`: una reserva solo puede usar mesas de su establecimiento.
- Estados: pendiente → confirmada → en mesa → finalizada; cancelada y no presentada como finales. Solo pendiente, confirmada y en mesa ocupan mesa. Finalizar antes de hora acorta la reserva y libera la mesa.
- La fecha y hora se introducen en hora local del establecimiento y se convierten con su zona horaria (D-011). Toda la reserva debe caber en un periodo de apertura (incluidos turnos que pasan de medianoche y excepciones por fecha).
- Comensales ≤ suma de capacidades máximas de las mesas asignadas (permite combinar mesas). Se puede crear sin mesa (queda para asignar).
- Las reservas no se borran (sin DELETE para la aplicación): se cancelan. La auditoría no incluye datos personales.
- El personal gestiona reservas (`reservations.manage`).

**Pendiente:** reservas públicas desde la web (con límite de peticiones e idempotencia), lista de espera, avisos al cliente (requiere correo/SMS), política de retención de datos de clientes, sugerencia automática de combinaciones de mesas.

## D-019 — Reservas públicas mediante funciones estrechas
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Contexto:** primera escritura anónima del sistema. La ruta pública no tiene usuario ni organización en el contexto, así que RLS no le da acceso a ninguna tabla privada.

**Decisión:**
- La web pública solo usa funciones `SECURITY DEFINER` que funcionan únicamente si el local activó la reserva online y devuelven lo mínimo: horario, capacidades de mesa e intervalos ocupados por mesa (sin ningún dato de clientes).
- `app.public_book` aplica en BD las reglas del local (activado, rango de comensales, duración exacta, antelación mínima y días vista), crea la reserva con `source = 'public'`, código de 10 caracteres y fecha de consentimiento, y asigna mesa probando candidatas en orden dentro de subtransacciones: si otra petición simultánea ocupó una mesa (violación de exclusión) pasa a la siguiente; sin mesa, aborta todo. El servidor comprueba antes que la hora está entre las disponibles (horario de apertura con zona horaria y cambios de hora, D-011).
- Asignación automática: la mesa activa más ajustada al grupo (primero las que cumplen el mínimo de la mesa). Sin combinaciones de mesas online.
- Abuso: límites por cliente (10/hora, por hash de la IP de `X-Forwarded-For`), por local (200/hora) y por contacto (5/día, hash de correo o teléfono), en una tabla sin acceso directo para la aplicación; campo trampa; idempotencia por clave del formulario (los reenvíos devuelven la reserva creada).
- Datos mínimos del cliente: nombre y teléfono o correo (al menos uno) y comentario. Casilla de consentimiento obligatoria; se guarda la fecha. Sin avisos al cliente (no hay proveedor de correo/SMS).
- Configuración por local en `reservation_settings`, editable con `establishments.update`.

**Riesgos:** `X-Forwarded-For` es falsificable si el proxy de producción no la sobrescribe; el texto de consentimiento es genérico y debe revisarlo el responsable del tratamiento; falta política de retención de datos de clientes.

## D-020 — Retención y derechos sobre datos personales de clientes
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- Plazo de conservación por organización (`privacy_settings.customer_retention_days`, 30–3650 días, por defecto 365) contado desde el fin de la reserva. Al vencer, la reserva se **anonimiza**: nombre sustituido, teléfono, correo y comentarios a NULL y `anonymized_at` fijado (CHECK impide marcarla sin vaciar el contacto). Se conservan fecha, comensales, mesas y estado para estadísticas.
- `app.anonymize_expired_reservations(org)` (SECURITY DEFINER) la usan tanto la interfaz («Aplicar ahora») como el script `pnpm privacy:retention`, pensado para programarse a diario con el rol de operaciones; si la llama el rol de aplicación, solo actúa sobre la organización del contexto y con rol owner/admin. El script también elimina huellas de límite de peticiones de más de 48 h.
- **No hay planificador en el entorno:** la anonimización automática depende de programar el script en el despliegue.
- Solicitudes de clientes (acceso/portabilidad y supresión): búsqueda por correo (sin distinguir mayúsculas) o teléfono (ignorando espacios y guiones; coincidencia exacta tras normalizar, por lo que «+34600…» y «600…» son contactos distintos). Exportación JSON y borrado por anonimización. No se borra si hay reservas futuras activas (deben cancelarse antes).
- Solo owner/admin (`privacy.manage`). La búsqueda y la exportación van por POST para que el contacto no quede en URLs ni historiales; la exportación (Route Handler) comprueba el origen. La auditoría registra una huella del contacto, nunca el contacto.
- La página pública informa del plazo de conservación en el texto de consentimiento.

**Límites:** no es una certificación de cumplimiento RGPD; el texto informativo, el plazo y el procedimiento deben validarlos el responsable del tratamiento y su asesoría. Las copias de seguridad (no definidas aún) también contendrán datos durante su propio periodo de retención.

## D-021 — Web pública del local e imágenes
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Contexto:** el usuario quiere una experiencia pública atractiva inspirada en tres diseños de referencia (futurista, taberna clásica y mediterráneo) con fotos de platos y de la sala.

**Decisión:**
- Web pública en `/<organización>/<local>`, servida solo mediante funciones `SECURITY DEFINER` (`app.public_site`, `app.public_site_hours`) que devuelven el perfil únicamente si está publicado. Para evitar choques con rutas de la aplicación, los identificadores de organización reservados (`app`, `login`, `m`, `q`, `r`, `media`, …) se rechazan en zod y con una restricción en BD.
- Imágenes: se aceptan JPEG/PNG/WebP de hasta 8 MB reconocidos por su firma; se reprocesan con **sharp** (nueva dependencia: necesaria para reducir tamaño y, sobre todo, eliminar metadatos EXIF/GPS; es la librería que usa el propio Next.js) a WebP de 1600 px como máximo, con límite de píxeles de entrada. Nunca se guarda el original. Cupo de 200 MB por organización.
- **Provisional:** las imágenes se guardan en PostgreSQL (`media_assets.data`, máx. 1,5 MB por imagen) mientras no haya almacenamiento de objetos configurado. Las imágenes no se modifican (solo inserción); al cambiar una foto se crea otra y la antigua se conserva porque puede figurar en versiones publicadas. Falta limpieza de imágenes huérfanas.
- Visibilidad: `/media/<id>` sirve una imagen solo si es la foto principal de un perfil publicado o figura en una versión de carta publicada (`app.public_media`); caché pública de 5 minutos. El panel usa `/app/<org>/media/<id>` con sesión y pertenencia.
- Las fotos y la marca «recomendado» forman parte de la instantánea publicada (campos opcionales `imageId` y `recommended`, compatibles con versiones anteriores): cambiarlas exige volver a publicar, igual que precios y alérgenos.
- Fuentes de los temas con `next/font/google`: se descargan al compilar y se sirven desde la propia aplicación (el visitante no contacta con Google); sin precarga, el navegador solo descarga las del tema visible.
- Sin elementos ficticios: no hay selector de idioma, «eventos» ni «mi cuenta»; el horario y la dirección salen de la ficha del local; los enlaces a carta y reservas solo aparecen si existen.

**Riesgos:** tamaño de la BD y de las copias de seguridad con imágenes; el cupo es una mitigación. Migrar a almacenamiento de objetos requerirá copiar los datos y cambiar la ruta de servicio, no el modelo de visibilidad.

## D-022 — Carta completa y reservas dentro de la web del local
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:** si el local tiene su página pública publicada, `/m/<org>/<local>/<carta>` y `/r/<org>/<local>` se muestran dentro de ella (misma cabecera, contacto, horario y navegación inferior) y con el **estilo de la web**, no con el tema de la versión de la carta, para que la experiencia sea coherente al navegar. Sin web publicada, ambas páginas se muestran como antes y la carta usa el tema guardado en su versión. Los enlaces impresos y los QR no cambian. Los formularios comunes toman los colores del tema redefiniendo las variables globales (`--accent`, `--border`…) dentro de la web.

**Consecuencia:** el tema elegido para una carta solo se aplica cuando el local no tiene web publicada.

## D-023 — Empaquetado y operación independientes del proveedor
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- Contenedores Docker en lugar de una plataforma concreta, para no atar el producto a un proveedor antes de elegirlo. Dos destinos: `runtime` (salida autónoma de Next, `node server.js`, usuario `node`, `HEALTHCHECK`) y `tools` (código fuente y dependencias completas para `db:migrate` y `privacy:retention`; pnpm incluido y sin red al ejecutar). La salida autónoma se activa solo al construir la imagen (`NEBORA_STANDALONE=1`) porque `next start`, usado en E2E, no la admite.
- Separación de credenciales: la web solo recibe `DATABASE_URL` (rol `nebora_app`); `DATABASE_ADMIN_URL` solo la imagen de herramientas. La migración 0001 crea `nebora_app` sin inicio de sesión; habilitarlo es un paso manual del operador.
- `/api/health` comprueba la BD con un límite de 3 s y responde solo `ok`/`unavailable`. El pool corta los intentos de conexión a los 5 s.
- La CI se ejecuta también en las ramas `claude/**` (cada entrega queda verificada sin abrir PR) y construye ambas imágenes.
- Un certificado raíz opcional para proxies con inspección TLS se pasa como *build secret*; no queda en la imagen.

**Pendiente:** elección de hosting y servicios gestionados, que decide el usuario.

## D-024 — Panel de inicio compuesto con los servicios de cada módulo
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:** el resumen de la portada no tiene consultas propias: llama a los servicios de cada módulo (reservas, inventario, compras, escandallos, cartas), que ya filtran por organización y comprueban permisos. Si falta el permiso de un bloque, el bloque vale `null` y no se muestra, en lugar de fallar. Así la portada no puede enseñar más que las páginas de cada módulo. Las fechas «de hoy» se calculan en la zona horaria de cada local.

**Coste:** más consultas que una vista agregada (en especial, detectar cartas desactualizadas reconstruye la instantánea de cada carta). Se optimizará si se mide lentitud real.

## D-025 — Traspasos y recuentos de inventario
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- **Traspaso** = fila en `stock_transfers` + dos movimientos (`transfer_out` en origen, `transfer_in` en destino) en la misma transacción. Un trigger de restricción diferido comprueba al confirmar que existen ambas patas con la cantidad exacta. Se permite entre cualquier par de almacenes de la organización (p. ej. cocina central → locales). Requiere `inventory.move`. Idempotente por clave (las patas usan la clave con sufijo).
- **Recuento** = `stock_counts` (uno abierto por almacén) + `stock_count_lines` con lo contado. Es **ciego**: mientras está abierto no se muestra el stock del sistema. Contar lo hace quien tenga `inventory.move`; aplicar o cancelar, `inventory.manage`.
- Aplicar lo hace `app.apply_stock_count` (SECURITY DEFINER, comprueba organización y rol): bloquea el recuento y cada saldo, guarda el saldo esperado y crea un movimiento `count` por diferencia. Así la diferencia es exacta aunque haya movimientos mientras se contaba, y dos aplicaciones simultáneas no ajustan dos veces.
- Triggers (SECURITY INVOKER) impiden al rol de la aplicación marcar un recuento como aplicado, reabrirlo o tocar líneas de un recuento cerrado; la columna del saldo esperado no es escribible por la aplicación.
- Las patas de traspaso y los ajustes de recuento no se anulan sueltos (servicio y BD): se compensan con otro traspaso o recuento.

**Límite:** el recuento ajusta solo lo contado; los artículos no contados no se tocan (no se asume 0).

## D-026 — Lista de espera sin avisos automáticos
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Decisión:**
- `waitlist_entries` por local y día, con franja horaria (hora local), comensales y contacto obligatorio (teléfono o correo, también por CHECK). Estados: en espera, convertida (enlazada a la reserva, FK compuesta que incluye el local) y cancelada.
- El panel calcula, para cada entrada en espera, la primera hora de su franja (cada 15 min) con una mesa libre para el grupo durante la duración configurada del local. Es orientativo: al convertir se vuelve a comprobar y la exclusión de la BD garantiza que no haya dos reservas en la misma mesa.
- Convertir crea una reserva confirmada en la mesa más ajustada y enlaza la entrada en la misma transacción; si ya no hay mesa, no cambia nada.
- **Sin avisos automáticos**: no hay proveedor de SMS ni correo. El personal contacta al cliente (enlaces de llamada y correo) y convierte la entrada. Cuando haya proveedor, se añadirá el aviso.
- Privacidad: las entradas entran en la retención (contada desde el día solicitado; si seguían en espera se cancelan al anonimizar), la búsqueda, la exportación y el borrado. `app.anonymize_expired_reservations` devuelve ahora el total de registros anonimizados (reservas y lista de espera).
- Permisos: ver con `reservations.read`; apuntar, convertir y cancelar con `reservations.manage` (incluye al personal).

**Pendiente:** alta desde la web pública (necesitará consentimiento y límites de peticiones como la reserva online).

## D-027 — Sistema visual del panel
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Contexto:** el usuario pidió un panel «más moderno y funcional» con una referencia de barra lateral oscura y contenido en tarjetas.

**Decisión:**
- Estructura: barra lateral fija (menú desplegable en móvil, se cierra al navegar) con grupos: Inicio; Gestión (Productos, Inventario, Compras); un grupo por local (Resumen, Reservas, Sala, Web pública); Organización (Miembros, Privacidad). Abajo, cambio de organización si hay varias, y usuario con su rol y salida. El nombre de la organización sigue siendo el `h1` de cada página.
- Estilo: tokens en `globals.css` (contenido claro, tarjetas blancas, acento violeta, barra oscura); tipografías Inter y Fraunces con next/font, sin precarga para no afectarlas a la web pública. Solo tema claro.
- **Sin elementos ficticios**: no se incluyen apartados de la referencia que no existen (pedidos, idiomas, dominio, suscripción, notificaciones, integraciones, «PRO»).
- «Diseño de tu web»: tarjetas por estilo con miniatura construida con los datos reales; elegir estilo es una acción propia (`setSiteTheme`) que no toca el contenido. La vista previa vive fuera de `/app` (`/preview/site/...`) para verse a pantalla completa, pero exige sesión y pertenencia, y sirve la foto principal por la ruta privada.
- `ActionForm` envía con JavaScript sin el restablecimiento automático de React: con error se conserva lo escrito; con éxito se limpia.

## D-028 — Apartados con URL propia en páginas largas
**Fecha:** 2026-10-23. **Estado:** aceptada.

**Contexto:** con el rediseño, las páginas del local, del editor de carta, del inventario y de la web pública acumulaban muchas tarjetas seguidas y obligaban a desplazarse mucho.

**Decisión:**
- Pestañas como enlaces (`PageTabs`) con el apartado en `?tab=`; el primero es el predeterminado y no lleva parámetro. El servidor valida el valor (`pickTab`, cualquier valor desconocido cae en el primero) y solo pinta ese apartado (las consultas de la página se mantienen como estaban; optimizarlas por apartado queda pendiente si hiciera falta). Sin estado en el cliente: funcionan sin JavaScript, conservan el apartado al recargar y tras una acción de servidor, y se pueden enlazar (p. ej. el recuento vuelve a `?tab=recuentos`).
- Lo que afecta a toda la página queda fuera de las pestañas: estado de la carta y sus enlaces, estado de apertura del local, estado de la web.
- «Datos del local» solo aparece para quien puede editar; la autorización sigue en las acciones del servidor.

**Alternativas descartadas:** pestañas en el cliente (perderían el apartado al recargar tras guardar y no serían enlazables); dividir en rutas separadas (más archivos y navegación duplicada sin ventaja).

## D-029 — Estadísticas de visitas sin datos personales
**Fecha:** 2026-10-26. **Estado:** aceptada.

**Contexto:** el plan Pro de la competencia ofrece estadísticas de visitas. Queremos medir visitas a la web, a las cartas y escaneos de QR sin cookies ni datos personales (sin banner de consentimiento ni plazos de conservación).

**Decisión:**
- Tabla `page_view_daily` con un contador por local, carta, tipo (`site`, `menu`, `qr`) y día local. No se guarda nada del visitante. La aplicación solo tiene SELECT (con RLS); se escribe únicamente mediante funciones `SECURITY DEFINER` (`app.record_site_view`, `app.record_menu_view`, `app.record_qr_scan`) que resuelven el destino por identificadores públicos y solo cuentan contenido publicado.
- El registro se hace con `after()` tras enviar la respuesta y no puede romper la página pública. No cuentan: precargas (`next-router-prefetch`, `purpose`/`sec-purpose`), agentes de robots y herramientas, peticiones sin User-Agent ni las que llevan la cookie de sesión de Nébora (el propio restaurante).
- Un escaneo de QR cuenta como escaneo y como visita a la carta (el QR redirige a ella): el gráfico muestra web + cartas y el QR aparte, sin sumarlo dos veces.
- Permiso nuevo `stats.read` para propietario, administrador y encargado; el resumen de reservas solo aparece con `reservations.read`.
- «Ventas» del plan de la competencia queda fuera: no hay TPV ni cobros en esta versión.

**Alternativas descartadas:** analítica de terceros (envía datos de los visitantes fuera y exige consentimiento); visitantes únicos con huella de IP (dato personal seudonimizado, con conservación y consentimiento); limitar por IP (mismo problema). Consecuencia: recuentos orientativos que se pueden inflar.

## D-030 — Operativa por local y catálogo común
**Fecha:** 2026-10-26. **Estado:** aceptada.

**Contexto:** con varios locales, inventario y compras mezclaban todos los almacenes en una página, aunque los datos ya iban por local (almacén → local, pedido → almacén, carta → local).

**Decisión:**
- Lo diario va dentro de cada local: cartas, inventario (stock, movimientos, recuentos, almacenes) y compras. Los listados se filtran en el servidor por establecimiento (`listStock`, `listMovements`, `listTransfers`, `listCounts`, `listWarehouses`, `listOrders`); un traspaso aparece en los dos locales que toca.
- Productos (con recetas y escandallos), ingredientes y proveedores siguen siendo comunes a la organización: evitan duplicar datos, mantienen el coste coherente y permiten traspasos entre locales. Qué platos ofrece cada local lo deciden sus cartas.
- Vistas del grupo («Inventario del grupo», «Compras del grupo») solo con más de un local; con uno, redirigen al local.
- La barra lateral muestra un local a la vez con selector; el último visitado se recuerda en una cookie de navegación (no da acceso a nada: cada página comprueba permisos en el servidor).
- Las acciones de inventario y compras revalidan toda la organización (`revalidatePath(..., "layout")`) para refrescar a la vez la vista del local y la del grupo.

**Continúa en D-031:** miembros limitados a locales concretos.

## D-031 — Miembros limitados a locales concretos
**Fecha:** 2026-10-26. **Estado:** aceptada.

**Contexto:** un cliente con varios locales puede tener equipos separados. Ocultar locales en el menú no es control de acceso: hay que aplicarlo en el servidor y en la base de datos.

**Decisión:**
- `memberships.all_establishments` (por defecto true) y `membership_establishments` (lista de locales). Propietarios y administradores siempre tienen todos (CHECK); al ascender a uno de esos roles se amplía el acceso.
- RLS: las tablas con `establishment_id` añaden `app.all_establishments_access() OR establishment_id = ANY(app.establishment_scope())`; las hijas (secciones, líneas, stock, movimientos, pedidos, recepciones, recuentos…) comprueban su padre, que también tiene RLS. Las funciones de ámbito son SECURITY DEFINER sobre el usuario y la organización del contexto y se usan como subconsultas escalares para evaluarse una vez por consulta. Un traspaso se ve desde los dos locales; registrarlo exige acceso a ambos.
- Servidor: `withTenant` carga el ámbito en el contexto (`ctx.establishments`); los servicios ya buscan el local, el almacén o la carta antes de actuar, así que fuera del ámbito responden NotFound (sin revelar si existe).
- El catálogo común (productos, recetas, ingredientes, proveedores) lo ve cualquier miembro, pero solo lo modifica quien accede a todos los locales: nuevo permiso `catalog.manage` (propietario, administrador y encargado), que se retira a las membresías limitadas. La recepción de pedidos sigue actualizando el coste de referencia del ingrediente, como regla de negocio.
- Invitaciones con `establishment_ids` (NULL = todos); `app.accept_invitation` crea la membresía y su lista en la misma transacción, solo con locales que sigan existiendo en la organización.

**Alternativas descartadas:** filtrar solo en la interfaz (no es seguridad); roles distintos por local (más complejo de lo que se necesita ahora; puede añadirse más adelante sobre esta tabla).

## D-032 — Productos disponibles por local
**Fecha:** 2026-10-26. **Estado:** aceptada.

**Contexto:** con el catálogo común (D-030), un local puede tener platos que otro no sirve; el editor de cartas ofrecía todos.

**Decisión:**
- `menu_products.all_establishments` (por defecto true: también en locales futuros) y `product_establishments`. Se edita en la ficha del producto con el permiso de catálogo (`catalog.manage`).
- El editor de cartas solo lista los productos disponibles en el local de la carta; `addItem` lo valida y un trigger `BEFORE INSERT` en `menu_items` lo garantiza en la base de datos (`product_not_available`). Un producto de otra organización lo sigue rechazando la FK compuesta.
- No se retira un producto de un local mientras esté en una de sus cartas (borrador): se indica en qué cartas está. Las versiones publicadas no cambian.

**Alternativa descartada:** catálogos separados por local (duplicaría recetas, escandallos y fotos de los platos comunes).

## D-033 — Traducciones de cartas y web
**Fecha:** 2026-10-26. **Estado:** aceptada.

**Contexto:** la competencia ofrece multilenguaje incluso en su plan gratuito. El usuario prefiere, por ahora, traducción manual sin servicios externos.

**Decisión:**
- Español como idioma de origen; cada local activa idiomas de una lista cerrada (`en`, `fr`, `de`, `it`, `pt`, `ca`), validada también en la base de datos.
- Traducciones en una columna `i18n` (jsonb) de la propia fila (productos, cartas, categorías, perfil de la web): heredan RLS de organización y de local sin tablas nuevas. Estructura y tamaño validados con CHECK; longitudes por campo en el servidor.
- Cada traducción guarda `src`, la huella del texto español del que se hizo: si el original cambia, el panel la marca «por revisar». Se sigue mostrando hasta que se revise.
- Cartas: las traducciones entran en la instantánea al publicar (los campos solo aparecen si hay traducción, así las cartas sin traducir no cambian). Web: se aplican al guardar, como el resto del perfil.
- Público: idioma por `?lang=`, o el primero del navegador (`Accept-Language`) que ofrezca el local, o español; los enlaces internos conservan el idioma elegido; lo que falta se muestra en español. Textos fijos y alérgenos en un diccionario de la aplicación.
- Un traductor automático (p. ej. Claude o DeepL) podría añadirse como adaptador que rellene estas columnas como borrador marcado para revisión; no se ha conectado (requiere cuenta y clave del cliente, y enviar los textos a ese proveedor).

**Alternativas descartadas:** tabla genérica de traducciones (complica RLS por local); rutas por idioma (`/en/...`), que darían mejor SEO pero obligan a duplicar rutas; se puede revisar más adelante.

## D-034 — Marca de la web: logotipo, color y tipografías
**Fecha:** 2026-10-28. **Estado:** aceptada.

**Contexto:** el plan Pro de la competencia permite personalizar la web; el usuario pidió logotipo, colores y 3-4 tipografías por estilo.

**Decisión:**
- En `establishment_profiles`: `logo_media_id` (imagen por el mismo sistema de fotos; pública solo con la web publicada, vía `app.public_media`), `accent_color` (#rrggbb, CHECK en BD) y `font_pairing` (id de una combinación; la lista la valida el servidor).
- El color sustituye a las variables de acento del tema (`--s-accent`, `--s-contact-accent`) y se calcula el color de texto legible encima (`--s-on-accent`, contraste WCAG). Se avisa en el panel si contrasta menos de 3:1 con el fondo del estilo. No se cambian fondos ni textos: el estilo sigue siendo reconocible y legible.
- Tipografías: 4 combinaciones por estilo (la original primero) definidas en `src/lib/site-fonts.ts`, que cambian las variables `--s-font-*` del tema. Una combinación de otro estilo se ignora (se usa la original del estilo actual), así cambiar de estilo nunca deja una mezcla rara. Todas las fuentes se alojan con next/font sin precarga: el visitante solo descarga las que usa.
- Se aplica en la web, la carta integrada y la reserva (comparten `SiteShell`) y en la vista previa del panel, que acepta `?font=` para probar sin guardar. La carta sin web, la vista previa del borrador y la carta impresa no cambian.

**Alternativas descartadas:** paleta libre completa (fondo, texto…), que rompe fácilmente la legibilidad; fuentes subidas por el cliente (licencias y seguridad); fuentes cargadas desde Google en el navegador del visitante (privacidad).

**Ampliación (2026-10-28):** tamaño del logotipo (`logo_size`: small, medium, large; migración 0021). Las variables del panel que usan los estilos comunes de `globals.css` (`--accent`, `--accent-strong`, `--accent-soft`, `--on-accent`, `--surface`) se redefinen dentro de la web con los colores del tema y de marca, para que ningún hover, foco ni botón use el violeta del panel; pestañas y puntos del carrusel tienen su propio hover.

## D-035 — Publicar la web con un interruptor propio
**Fecha:** 2026-10-28. **Estado:** aceptada.

**Contexto:** publicar la web era una casilla al final del formulario de contenido; el usuario pidió un interruptor junto al estado, en la parte superior.

**Decisión:**
- Acción de servidor separada `setSitePublished` (permiso `establishments.update`, bloqueo del perfil, auditoría `site.published` / `site.unpublished`). Publicar exige un titular ya guardado.
- `updateSiteProfile` deja de cambiar el estado si no se le indica (`published` opcional): guardar el contenido conserva la web publicada o no. Con la web publicada no se puede vaciar el titular.
- El interruptor es un botón `role="switch"` dentro de un formulario: funciona sin JavaScript y muestra el error del servidor si no se puede publicar.

**Alternativas descartadas:** mantener la casilla y moverla arriba (seguiría ligada a guardar todo el contenido, y un descuido al guardar podía despublicar).

## D-036 — Cartas con horario
**Fecha:** 2026-10-31. **Estado:** aceptada.

**Contexto:** la competencia permite programar cartas para que se muestren en ciertos horarios (desayunos, menú del día…).

**Decisión:**
- `menus.availability` (jsonb): NULL = siempre; si no, turnos semanales con el mismo formato y la misma lógica que el horario de apertura (hora local del local, turnos de madrugada y cambios de hora). La BD valida la forma de cada turno con un CHECK; el servidor, los solapes. En el panel se edita como franjas (días + de/a).
- Es configuración viva, no parte de la versión publicada: cambiar el horario no obliga a republicar.
- Una carta fuera de horario **no se oculta**: los QR impresos de cada carta deben seguir funcionando. La página indica cuándo se sirve y avisa de que ahora no se sirve.
- Carta del momento: entre las publicadas, primero una con horario que se sirva ahora (la destacada si lo es), luego la destacada si se sirve, luego la primera que se sirva, y si ninguna, la destacada o la primera. La web solo la aplica si tiene carta destacada (sin destacada sigue sin mostrar carta). `/m/<org>/<local>` redirige (307) a la carta del momento: sirve como QR único.
- Lectura pública mediante `app.public_menus` (SECURITY DEFINER): solo cartas publicadas, con el nombre y las traducciones de la instantánea publicada, su horario y si es la destacada.

**Alternativas descartadas:** ocultar cartas fuera de horario (rompe QR y enlaces); guardar el horario en la versión publicada (obligaría a republicar para cambiar una hora).

## D-037 — Fuera de carta
**Fecha:** 2026-10-31. **Estado:** aceptada.

**Contexto:** los restaurantes cambian a diario sus sugerencias; republicar una carta para eso es lento y crea versiones que no aportan.

**Decisión:**
- Tabla `menu_specials` por local: producto del catálogo, precio especial opcional y vigencia opcional (`starts_on`/`ends_on`, fechas locales inclusivas). RLS por organización y por local como las cartas (D-031); un trigger exige que el producto esté disponible en el local (D-032). Un plato una sola vez por local; máximo 30.
- Se reutiliza el producto del catálogo (no texto libre) para no perder alérgenos (obligatorios en la información al consumidor), foto ni traducciones.
- No forman parte de las versiones publicadas: `app.public_specials` (SECURITY DEFINER) devuelve al momento los que se ven hoy (`app.special_is_public`: producto activo y disponible, fecha local dentro de la vigencia y local con carta o web publicada). `app.public_media` sirve la foto del producto solo mientras se ve.
- Se muestran como primera sección «Fuera de carta» de todas las cartas públicas del local y de la carta de la web, reutilizando su diseño, pestañas y traducciones.

**Alternativas descartadas:** una categoría más en cada carta (exige republicar y repetir en cada carta); platos de texto libre (sin alérgenos fiables).

## D-038 — Formatos de precio por plato
**Fecha:** 2026-10-31. **Estado:** aceptada.

**Contexto:** muchos platos se venden en varios formatos (media ración y ración, copa y botella…); la competencia lo permite.

**Decisión:**
- `menu_products.formats` (jsonb): NULL = precio único; si no, de 2 a 6 `{label, priceCents}`. La BD valida la forma; el servidor, nombres (1–40 caracteres, sin repetir) y precios. Con formatos, `price_cents` es el más bajo («desde»): ordenación, desplegables y escandallos siguen funcionando.
- Los formatos están en el catálogo (no en cada carta) y se congelan en la instantánea publicada; los platos sin formatos conservan exactamente la instantánea anterior.
- Un plato con formatos no admite precio propio por carta ni precio especial fuera de carta: el servidor lo rechaza y, si había uno anterior, no se aplica.
- Nombres sugeridos con traducción incorporada en los 7 idiomas; un nombre propio se muestra tal cual (no hay campo de traducción para él).

**Alternativas descartadas:** formatos por carta (multiplica la edición y los errores de precio); traducción manual de cada formato (añade mucha carga para textos casi siempre estándar).

## D-039 — Galería de imágenes de la web
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** la competencia ofrece galería de fotos en la web del restaurante.

**Decisión:**
- Tabla `site_gallery_images` por local (foto, pie opcional de hasta 120 caracteres, posición), con RLS por organización y local como la web. Máximo 24 fotos.
- Cada foto es un `media_asset` propio, procesado como el resto (WebP, sin metadatos, cupo de la organización). Al quitarla se borra el archivo (la fila se borra en cascada) y se libera cupo; es seguro porque `storeImage` siempre crea un archivo nuevo, nunca reutiliza uno existente.
- Lectura pública mediante `app.public_site_gallery` (solo con la web publicada) y `app.public_media`, que sirve una foto de galería solo si la web de su local está publicada.
- Se sube una foto por envío (el límite de las acciones del servidor es de 9 MB); los pies no se traducen por ahora.

**Alternativas descartadas:** subir varias fotos a la vez (superaría el límite por envío o exigiría subir fuera de las acciones del servidor); visor a pantalla completa propio (cada foto se abre en su URL, sin JavaScript adicional).

## D-040 — Reserva online traducida
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** la web y las cartas ya se ofrecían en varios idiomas (D-033), pero la página de reserva seguía en español.

**Decisión:**
- `app.public_booking_info` devuelve los idiomas del local, así la reserva se traduce aunque la web no esté publicada. El idioma se elige como en el resto de páginas públicas (`?lang=`, navegador, español) y la acción solo acepta un idioma que el local ofrezca.
- Textos de la página en `src/lib/booking-i18n.ts`. Los mensajes del servicio se siguen escribiendo en español y se traducen en la acción con un diccionario (con un patrón para el mensaje con números); lo desconocido se muestra en español. Una prueba unitaria extrae los mensajes del código y exige su traducción en todos los idiomas.
- El formulario de reserva se envía a mano con JavaScript (como el del panel) para que un error del servidor no borre lo escrito; sin JavaScript sigue funcionando.

**Alternativas descartadas:** códigos de error en lugar de mensajes (cambio grande en el servicio y en el panel, que usa los mismos mensajes); traducir solo la página y dejar los errores en español.

## D-041 — Cancelación de reservas por el cliente
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** los clientes solo podían cancelar llamando al restaurante; no hay cuentas de cliente ni proveedor de correo.

**Decisión:**
- Cada reserva online recibe un token aleatorio de 256 bits (base64url) que solo ve el cliente, en el enlace de la confirmación. En la BD se guarda únicamente su huella sha256 (índice único). El código de reserva (10 caracteres) no basta para cancelar.
- Funciones SECURITY DEFINER: `app.public_set_cancel_token` (por clave de idempotencia, que solo conoce quien envió el formulario; un reenvío renueva el token), `app.public_cancellation` (datos mínimos: código, fecha, comensales, estado) y `app.public_cancel` (bloquea la fila, solo pendientes o confirmadas y antes de su hora; el trigger existente libera la mesa; auditoría sin actor).
- La cancelación funciona aunque el local desactive después la reserva online. La página no se indexa y usa `referrer: no-referrer`.

**Alternativas descartadas:** firmar el enlace con un secreto del servidor (exigiría una variable de entorno nueva en el despliegue); cancelar con código + teléfono o correo (adivinable o filtrable con menos esfuerzo).

## D-042 — Lista de espera desde la web
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** cuando no quedaban horas online, el cliente solo podía llamar; la lista de espera solo la gestionaba el personal.

**Decisión:**
- `waitlist_entries` gana `source` (staff/public), `consent_at` (obligatorio si es pública) e `idempotency_key` (única por organización). Alta mediante `app.public_join_waitlist` (SECURITY DEFINER): solo con la reserva online activa, comensales dentro de los límites del local y fecha entre hoy y los días vista (fecha local); auditada sin actor.
- El servidor exige además que la franja coincida con alguna apertura de ese día y aplica los mismos límites de peticiones, campo trampa y consentimiento que la reserva online. El formulario solo se ofrece si ese día abre y no quedan horas para ese número de personas.
- Mensajes en español en el servicio y traducidos en la acción (D-040); la prueba de cobertura de traducciones los incluye.

**Alternativas descartadas:** apuntarse aunque haya horas libres (llenaría la lista de solicitudes que ya se pueden reservar); avisar automáticamente al liberarse mesa (requiere proveedor de correo o SMS).

## D-043 — Fuentes alojadas en el repositorio
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** `next/font/google` descargaba de Google Fonts las 34 familias en cada compilación; una ejecución de la CI falló porque una descarga no respondió, y desplegar dependía de la disponibilidad de Google.

**Decisión:**
- Las fuentes se guardan en `src/fonts` (woff2, subconjunto latino, mismos pesos o ejes variables que antes) y se cargan con `next/font/local` desde `src/fonts/index.ts`. Ni la compilación ni el visitante hacen peticiones a Google; el navegador sigue bajando solo las que usa la página (sin precarga).
- `scripts/fetch-fonts.mjs` las descarga una vez (mediante curl, que respeta el proxy) junto con el texto de su licencia de `google/fonts` y genera `index.ts`. Se ejecuta a mano; su resultado se guarda en el repositorio.
- Licencias: SIL Open Font License 1.1 (32 familias) y Apache 2.0 (Satisfy y Syncopate), que permiten redistribuirlas con la aplicación; los textos van en `src/fonts/licenses` y el índice en `src/fonts/LICENSES.md`.

**Alternativas descartadas:** paquetes `@fontsource` (34 dependencias nuevas); caché de compilación en la CI (no evita el fallo en la primera compilación ni en el despliegue).


## D-044 — Revisión de seguridad interna: CSP con nonce y endurecimiento
**Fecha:** 2026-11-01. **Estado:** aceptada.

**Contexto:** primera revisión de seguridad orientada a OWASP ASVS (informe en `docs/SECURITY_REVIEW.md`). La CSP no limitaba los scripts, `zod` tenía un aviso alto y quedaban detalles de sesiones, cabeceras y permisos.

**Decisión:**
- CSP por petición en `src/proxy.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'` (`'unsafe-eval'` solo en desarrollo), `object-src 'none'`, `base-uri`, `form-action` y `frame-ancestors 'none'`. Next aplica el nonce a sus scripts; para ello todas las páginas se renderizan por petición (`await connection()` en el layout raíz).
- `style-src` mantiene `'unsafe-inline'` (estilos en línea de React y del color de marca); riesgo aceptado.
- HSTS y `upgrade-insecure-requests` solo cuando la petición llega por HTTPS (directa o con `X-Forwarded-Proto`), para no romper el acceso local por http. COOP `same-origin` en `next.config.ts`.
- Los Route Handlers que cambian estado o exportan datos comprueban el origen con `isSameOrigin` (Origin frente a Host/X-Forwarded-Host), válido tras un proxy que termina TLS.
- Al fijar una cookie de sesión nueva se revoca la que tuviera el navegador.
- Ninguna función `SECURITY DEFINER` es ejecutable por PUBLIC (migración 0029); una prueba de integración lo exige junto con `search_path` fijo.
- Dependencias: `zod` 4.6.7 y `vitest` 4.1.12. Se aceptan 2 avisos moderados de `minimatch` (solo desarrollo, vía ESLint 9).

**Alternativas descartadas:** CSP estática con hashes (Next genera scripts en línea distintos en cada página); `'unsafe-inline'` en scripts (anula la protección); HSTS siempre (impide entrar en local por http).

## D-045 — Personal y cuadrante de turnos
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** la Fase 6 tenía pendientes los turnos del personal. Muchos empleados de un restaurante no tienen ni necesitan cuenta en Nébora.

**Decisión:**
- `staff_members`: fichas de la organización (nombre, puesto, activo y, opcionalmente, la cuenta de un miembro activo; una ficha por cuenta). Datos mínimos: sin teléfono, documento ni salario. Una ficha con turnos no se elimina: se desactiva.
- `staff_shifts`: turnos de una persona en un local, guardados como instantes UTC (`starts_at`, `ends_at`, `during` generado). Restricción de exclusión `staff_shifts_no_overlap` por persona: no puede haber dos turnos solapados, tampoco en locales distintos ni con altas simultáneas. Máximo 16 horas. Se introducen con día y horas locales del local; si la hora de fin es anterior a la de inicio, acaba al día siguiente (cambios de hora incluidos).
- Permisos `staff.read` (todos los roles: el personal consulta el cuadrante) y `staff.manage` (owner, admin, manager). RLS: fichas por organización; turnos además por local (D-031).
- Panel: «Personal» en la organización y «Turnos» en cada local: cuadrante semanal (lunes a domingo) con horas por persona, alta, modificación y borrado de turnos y «Copiar la semana anterior» (salta los turnos de personas desactivadas y los que se solaparían; un bloqueo por local evita copias duplicadas con dos clics).
- Auditoría de altas, cambios y bajas de fichas y turnos, y de cada copia de semana.

**Alternativas descartadas:**
- Turnos solo para miembros con cuenta: obligaría a invitar a todo el equipo.
- Fichas por local: duplicaría a quien trabaja en varios locales y no permitiría impedir solapes entre ellos.
- Comprobar solapes solo en el servidor: no resiste altas simultáneas.

**Límites conocidos:**
- Un encargado limitado a un local ve las fichas de toda la organización (nombre y puesto). Si una persona ya tiene un turno en otro local al que el encargado no accede, este solo sabe que «se solapa».
- Las horas son las planificadas, no las trabajadas: no hay fichaje.

## D-046 — Planes Básico, Avanzado y PRO
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** el producto se centra en montar rápido web, carta, contacto y reservas. La gestión de cocina (recetas, escandallos, inventario, proveedores) exige mucho trabajo de alta y generaba avisos («plato sin receta») que no interesan a un bar pequeño. El titular definió tres planes y la estructura del menú de cada uno.

**Decisión:**
- `organizations.plan` (`basic`, `advanced`, `pro`; migración 0031). Las organizaciones nuevas empiezan en Básico; las existentes pasaron a PRO para no ocultarles nada.
- Cada permiso tiene un plan mínimo (`PERMISSION_PLAN` en `permissions.ts`). Los permisos efectivos son los del rol que incluye el plan, calculados en el servidor en cada petición (`TenantContext.plan`).
  - **Básico:** web, cartas con sus platos, estadísticas y privacidad.
  - **Avanzado:** añade reservas, sala, miembros, personal y turnos.
  - **PRO:** añade costes y recetas, inventario, proveedores y compras.
- Las páginas y servicios de cada sección comprueban su permiso: en un plan sin la sección responden 404 o rechazan la operación. Los servicios de ingredientes, proveedores y recetas, que solo pedían el permiso del catálogo de platos, exigen ahora además el de gestión.
- **Platos:**
  - En todos los planes se crean desde el editor de cada carta («Nuevo plato en …»), que crea el producto y lo añade a la categoría en una transacción.
  - La ficha del plato (`/products/<id>`) está en todos los planes, con datos, foto y locales. Receta y escandallo solo en PRO.
  - La página «Productos» (catálogo con costes) es PRO.
- **Reservas online:** al bajar a Básico se desactivan en todos los locales, y un trigger impide activarlas con plan Básico (`app.check_booking_plan`). Así la web, la reserva y la lista de espera dejan de ofrecerlas también en la base de datos.
- **Bajar a Básico** exige no tener más miembros ni invitaciones abiertas: el Básico es para una persona y sin plan Avanzado no habría forma de gestionarlos.
- **Bajar de plan no borra datos**; vuelven al subir.
- **Cambio de plan:** lo hace solo el propietario en «Plan», con aviso de que aún no se cobra (no hay proveedor de pagos). Queda auditado.
- **Menú:**
  - Inicio.
  - Restaurante: Resumen, Cartas, (Reservas, Sala), Web pública, Estadísticas.
  - Gestión (PRO): Productos, Inventario, Proveedores.
  - Organización: (Miembros, Turnos y horarios), Privacidad, Plan.
  - Inventario reúne ingredientes, todos los locales y cada local; Proveedores, los proveedores y los pedidos de cada local; Turnos y horarios, el personal y el cuadrante de cada local. Cada uno tiene un selector de apartado y queda marcado en el menú en todas sus páginas.

**Alternativas descartadas:**
- Módulos sueltos activables por separado: el titular prefirió planes cerrados.
- Que cualquiera eligiera plan sin control: el cambio queda limitado al propietario y se sustituirá por el pago.
- Borrar los datos al bajar de plan.

## D-047 — Web en el plan Básico: estilo Clásico, solo logotipo y sin galería
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** el titular quiere que el plan Básico tenga una web sencilla y que la personalización sea un motivo para pasar a Avanzado.

**Decisión:**
- Permiso `site.customize` (plan mínimo Avanzado; propietario, administrador y encargado). Lo exigen elegir estilo, el color de marca y la tipografía, y añadir, editar, ordenar y quitar fotos de la galería. El logotipo, su tamaño, el contenido y la foto principal siguen en todos los planes.
- El formulario de contenido también guardaba el estilo: sin `site.customize` se conserva el guardado, para que no se pueda cambiar por esa vía ni se sustituya por el Clásico.
- **Aspecto efectivo** (`effectiveLook`): en Básico, estilo Clásico sin color ni tipografía propios y sin galería.
  - Se aplica en la web pública, en las cartas que usan la marca de la web y en la vista previa.
  - Las páginas públicas obtienen el plan con `app.public_establishment_plan` (migración 0032).
  - No se borra nada: al subir de plan vuelve lo elegido.
- **Panel:** los demás estilos, el color, las tipografías y la galería se muestran deshabilitados con el aviso «… está disponible desde el plan Avanzado» y un enlace a «Plan» (o «pídeselo al propietario»).

**Alternativas descartadas:**
- Borrar o reescribir la personalización al bajar de plan: se perdería al volver a subir.
- Ocultar las opciones: el titular prefiere verlas deshabilitadas, como reclamo.

**Límite conocido:** una foto de la galería cuyo enlace directo ya se conocía sigue sirviéndose (`app.public_media` no mira el plan), aunque la web ya no la muestra.

## D-048 — Publicación automática de las cartas
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** las cartas tenían un borrador y había que pulsar «Publicar borrador» tras cada cambio. Si se olvidaba, la carta pública quedaba desactualizada (precios, alérgenos, fotos). El titular prefiere que los cambios se publiquen solos.

**Decisión:**
- La primera publicación sigue siendo manual («Publicar carta»), para no mostrar una carta a medio montar.
- **Después**, cada cambio que altere lo que ve el cliente vuelve a publicar la carta en la misma transacción (`republishMenus`), siempre que el usuario tenga permiso de publicar:
  - categorías y platos de la carta;
  - nombre y tema;
  - la ficha de un plato, en todas las cartas publicadas que lo incluyan;
  - foto y alérgenos traídos de la receta;
  - traducciones;
  - nombre del local, idiomas y nombre de la organización.
- Solo se crea versión si la instantánea cambia, y las versiones siguen siendo inmutables.
- Si el borrador no se puede publicar (categoría vacía, plato archivado), la web mantiene la última versión válida y el editor avisa de qué falta. Al corregirlo, se publica solo.
- Una carta despublicada no se vuelve a publicar por los cambios.
- El esquema de precios pasa a `menus/price-schema.ts` para evitar una dependencia circular entre cartas y productos.

**Alternativas descartadas:**
- Quitar las versiones: se pierde la posibilidad de volver a una anterior.
- Publicar automáticamente también la primera vez.
- Un botón «Publicar» tras cada cambio, que era el problema de partida.

**Consecuencia:** se generan más versiones (una por cambio visible); la lista de versiones crece con el uso.

## D-049 — Página de contacto, formulario y bandeja de mensajes
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** el contacto solo estaba en el pie de la web. El titular quiere una página de contacto con formulario y una llamada a la acción en la portada. No hay proveedor de correo.

**Decisión:**
- **En todos los planes:**
  - la portada tiene un bloque «¿Hablamos?» con «Contactar» (y el teléfono si lo hay);
  - la cabecera, el menú y la barra inferior del móvil enlazan a `/<org>/<local>/contacto`;
  - esa página muestra los datos del local (dirección, teléfono, horario, Instagram, WhatsApp) en un panel con los colores del pie, que no se repite debajo.
- **Desde el plan Avanzado:**
  - formulario (nombre, teléfono o correo, mensaje, consentimiento, campo trampa, clave de idempotencia);
  - los mensajes llegan a «Mensajes» de cada local en el panel, con aviso de no leídos en Inicio;
  - todos los roles los leen y marcan como leídos; los encargados o superiores los archivan y borran (`messages.read` y `messages.manage`).
- **Integridad (migración 0033):**
  - `contact_messages` con RLS por local;
  - la aplicación no puede insertar directamente: el alta solo pasa por `app.public_contact`, que exige web publicada y plan Avanzado o superior;
  - límites por cliente, local y contacto.
- **Privacidad:** los mensajes entran en la retención (anonimización tras el plazo), la exportación y el borrado de datos de clientes. El consentimiento muestra el plazo real (`app.public_retention_days`).
- Textos públicos y errores traducidos a los 7 idiomas (`contact-i18n.ts`), con una prueba que exige traducción de cada mensaje del servicio.

**Alternativas descartadas:**
- Enviar por correo: no hay proveedor.
- Formulario en Básico: el titular lo prefiere desde Avanzado.

**Pendiente:** aviso por correo al restaurante cuando haya proveedor.

## D-050 — Fondos decorativos según el tipo de cocina
**Fecha:** 2026-11-02. **Estado:** aceptada.

**Contexto:** el titular quiere que cada restaurante pueda elegir un fondo sutil acorde a su cocina (mariscos, carnes, hamburguesas, saludable…), solo decorativo, que no sature ni cambie los fondos.

**Decisión:**
- **Seis motivos** (`src/lib/site-decor.ts`): mariscos y pescado, carnes y parrilla, hamburguesería, saludable, italiano y cafetería. Son dibujos propios de trazo fino, sin imágenes de terceros, en una losa SVG de 240 px que se repite con los motivos girados.
- **Cómo se pinta:**
  - capa `::before` fija detrás de todo el contenido (`z-index: -1` en `.site` aislado);
  - se usa como máscara (`mask-image` con URL `data:`, permitida por la CSP) sobre el color del texto del estilo, con un 7 % de opacidad;
  - se adapta a cada estilo, no recibe clics y solo se ve donde no hay fondo propio: la foto principal, la galería y el pie quedan limpios.
- **Datos:** `establishment_profiles.decor` (migración 0034) y `app.public_site` lo devuelve.
- **Plan:** elegirlo es del plan Avanzado (permiso `site.customize`). En Básico se ve deshabilitado con aviso y la web no lo muestra aunque esté guardado.
- **Panel:** en «Web pública → Estilo», con una muestra de cada motivo y vista previa sin guardar (`?decor=`).

**Alternativas descartadas:**
- Imágenes de bancos de imágenes: licencias y peso.
- Teñir el fondo del estilo: el titular no quiere cambiar los fondos.

**Pruebas:** las E2E dan a cada persona registrada su propia IP (`X-Forwarded-For`, que la aplicación usa sin `CLIENT_IP_HEADER`). Con 52 registros por ejecución se superaba el límite de 50 por IP, que no se relaja para las pruebas.

## D-051 — Color de marca en toda la web y con contraste garantizado
**Fecha:** 2026-11-03. **Estado:** aceptada.

**Contexto:**
- Con un color de marca, los separadores seguían en el color secundario del estilo.
- Un color oscuro se perdía en la cabecera, la portada y el pie, que en la mayoría de estilos son oscuros.
- Un color muy claro se perdía en la página.

**Decisión:**
- `brandPalette` (`src/lib/color.ts`) calcula una variante del color de marca para cada fondo del estilo: página, portada y cabecera, y pie. Cada una es el color más parecido al elegido que alcanza un contraste de 4,5:1 (WCAG AA); si hace falta, se aclara sobre fondos oscuros o se oscurece sobre claros.
- La variante de página y la de portada se eligen además para que el texto de los botones (blanco o casi negro) también llegue a 4,5:1.
- Con color de marca, `--s-accent-2` (separadores y detalles) toma el mismo color.
- La portada, la cabecera de cada página y la cabecera fija usan su variante (`.branded`), y el pie la suya.
- Los fondos de cada estilo están en `THEME_INFO` (`pageBg`, `heroBg`, `contactBg`).
- **Panel:** si el color se ajusta, se muestran los tonos que usará la web en cada zona, en lugar del aviso de «prueba otro color».
- **Fondo decorativo (D-050):** también en los bloques de la portada con fondo propio (carta destacada y galería). Primero tenían su propia capa, pero el dibujo no casaba en la unión con la capa común y se repetía. Ahora, con fondo decorativo, esos bloques son transparentes; su color es el mismo que el de la página en todos los estilos, así que se ve la capa común, continua y sin cortes.

**Alternativas descartadas:**
- Rechazar colores de poco contraste: el titular quiere poder usar su color.
- Cambiar los fondos del estilo según el color de marca.

## D-052 — Página de contacto rediseñada y motivo del mensaje
**Fecha:** 2026-11-03. **Estado:** aceptada.

**Contexto:**
- La página de contacto (D-049) era básica.
- Los datos iban en una caja con los colores del pie, que con un color de marca oscuro no se leía.

**Decisión:**
- **Dos columnas en escritorio, una en móvil**, con los colores claros del estilo:
  - fichas de contacto directo pulsables (llamar, WhatsApp, cómo llegar, Instagram), con su icono sobre el color de marca;
  - el horario día a día con el de hoy (en la hora del local) resaltado;
  - el formulario en una tarjeta.
- **Motivo opcional** del mensaje en forma de pastillas: reserva de grupo, evento o celebración, alergias e intolerancias, u otra consulta.
  - Migración 0035: `contact_messages.topic`, con su CHECK, y `app.public_contact` lo recibe.
  - La bandeja del panel lo muestra como etiqueta.
  - Textos en los 7 idiomas.

**Límite conocido:** el horario muestra el semanal; no refleja los días con excepción (festivos), igual que el pie.

## D-053 — Pruebas automáticas de accesibilidad y rendimiento
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Contexto:**
- Faltaban pruebas de accesibilidad y rendimiento (ROADMAP, «Hardening»).
- La web pública y el panel se generan en cada visita (CSP con nonce, D-044), así que conviene medir su coste.

**Decisión:**
- **Dependencia nueva, solo de desarrollo:** `@axe-core/playwright` 4.14.0, versión fija. axe-core es el motor de referencia para comprobar WCAG de forma automática. Escribir esas reglas a mano sería menos fiable, y no llega al código que se sirve.
- **`tests/e2e/accessibility.spec.ts`:**
  - Pasa axe con las reglas WCAG 2.2 A y AA por las 36 páginas del recorrido con datos, en escritorio y en móvil, más el acceso y el registro.
  - Antes de analizar, abre los desplegables para revisar también su contenido.
  - Repasa también las páginas públicas en los estilos Clásico, Futurista y Moderno, en móvil.
  - Comprueba también el teclado: el primer Tab llega a «Saltar al contenido» y Enter lleva el foco al contenido.
- **`tests/e2e/showcase.ts`:** una organización PRO de muestra con datos en todas las secciones. La comparten la prueba de maquetación, la de accesibilidad y la de rendimiento. Ahora incluye la reserva online activada y las páginas `/m/` y `/r/`.
- **`tests/e2e/performance.spec.ts`:**
  - Mide sin caché del navegador los bytes transferidos de JavaScript y CSS y el CLS en las páginas públicas y en las principales del panel.
  - Exige límites deterministas: JavaScript 180 KB en la web y 200 KB en el panel, CSS 30 KB, CLS 0,1.
  - Anota sin exigirlos la respuesta del servidor (TTFB) y el LCP, que dependen de la máquina.
- **Correcciones encontradas** (23 avisos de axe en 13 páginas antes de corregir):
  - **Mediterráneo:** el dorado (#b48c56) se usaba como texto sobre el crema con un contraste de 2,6:1. Afectaba a precios de la carta, títulos de la página de contacto, la página actual del menú y el idioma actual.
    - Sobre fondos claros pasa a #7e623c (4,8:1), con el texto de los botones en blanco.
    - La portada, la cabecera de cada página y la cabecera fija siguen con el dorado original.
    - Los desplegables de la cabecera, que tienen fondo claro, recuperan el acento de la página (`--s-accent-page`), también con color de marca.
    - Los separadores decorativos siguen en dorado.
  - **Clásico:** el texto legal del pie tenía transparencia y bajaba a 3,6:1; ahora se muestra sin transparencia.
  - **Panel:**
    - Verde de «correcto» #1d8358 → #187550 (4,2 → 5,1:1 sobre su fondo).
    - Plazas de las mesas del plano más oscuras sobre el fondo de color de la mesa.
  - **Nombre accesible con el texto visible (WCAG 2.5.3):**
    - Los accesos rápidos del resumen del local ya no tienen `aria-label`; su nombre es el texto que se ve.
    - Las mesas del plano se llaman «Mesa M1 2–4 personas, …», que contiene lo que se ve: «M1 2–4».
  - **Tamaño de los controles:** casillas y botones de opción de 18 px (antes 16), con foco visible propio.
  - **Foco visible:** el contorno de foco del panel era violeta muy claro (#efeafe), casi invisible sobre blanco. Pasa a ser el violeta del acento (más de 5:1), y blanco en la barra lateral oscura.
  - **«Saltar al contenido» (WCAG 2.4.1):**
    - Panel y web pública tienen un enlace oculto hasta recibir el foco, en los 7 idiomas en la web.
    - La web pública tiene ahora un `<main>`, que anula el ancho máximo que el panel da a los `<main>`. Una prueba existente, la del carrusel, detectó ese estrechamiento.
- **Rendimiento medido** (2026-11-04, local, build de producción, móvil sin caché):
  - JavaScript: unos 140 KB transferidos, casi todo React y Next.js.
  - CSS: unos 15 KB.
  - CLS: 0.
  - TTFB: 15–80 ms; LCP: 100–250 ms.
  - En la portada pública, el horario, el plan, la carta destacada y la galería se leían una tras otra; ahora las consultas independientes se lanzan a la vez.

**Alternativas descartadas:**
- Lighthouse en la CI: más pesado y con resultados variables entre ejecuciones. Los límites en bytes y CLS son reproducibles.
- Exigir tiempos (TTFB, LCP) en la CI: dependen de la máquina y darían fallos aleatorios.

**Límites conocidos:**
- axe detecta solo una parte de los problemas de WCAG.
- Falta una revisión manual con lector de pantalla (NVDA, VoiceOver) y con zoom al 200–400 %.
- La prueba de accesibilidad repasa los estilos con los colores por defecto; los colores de marca se ajustan para el contraste aparte (D-051).
- Las medidas de rendimiento son locales y con pocos datos; en producción dependerán de la latencia de la BD y del volumen de datos.

## D-054 — «Mis próximos turnos» en Inicio
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Contexto:**
- El cuadrante (D-045) solo se veía por local y semana.
- Quien trabaja en el restaurante quería ver sus turnos sin buscarse en el cuadrante.

**Decisión:**
- **Inicio** muestra «Mis próximos turnos» a quien tenga su cuenta vinculada a una ficha activa del personal.
  - Incluye el turno en curso, marcado «Ahora», y los turnos de los próximos 14 días.
  - Cada turno muestra el día («Hoy», «Mañana» o la fecha), el horario en la hora del local, el local, el puesto (el del turno o, si no tiene, el de la ficha) y las notas.
  - Cada turno enlaza al cuadrante de esa semana.
  - Sin ficha vinculada (por ejemplo, el propietario) la sección no aparece; con ficha y sin turnos, se indica.
- **Servicio `listMyShifts`:**
  - Exige `staff.read`, que tienen todos los roles desde el plan Avanzado.
  - La ficha se busca por la cuenta de la sesión (`ctx.userId`), nunca por un dato del cliente.
  - RLS limita los turnos a los locales a los que accede la cuenta.
  - Sin migración: usa `staff_members.user_id`, que ya existía.

**Límites conocidos:**
- Un turno en un local al que la cuenta no tiene acceso no aparece. Lo coherente es asignarle ese local o no ponerle turnos allí.
- No hay avisos por correo ni calendario (.ics): no hay proveedor de correo.

## D-055 — Entrada al panel: bienvenida, entrada directa y selector
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Contexto:**
- La pantalla previa al panel (`/app`) listaba las organizaciones y un formulario con nombre e identificador.
- Era un paso de más para quien solo tiene una organización, que es lo habitual.
- Quien se acababa de registrar no recibía ninguna explicación.

**Decisión:**
- **Con una sola organización**, `/app` lleva directamente a su panel.
- **Sin ninguna**, una bienvenida:
  - los tres primeros pasos: tu negocio, tu primer local, y tu carta y tu web;
  - el alta del negocio, que solo pide el nombre;
  - un aviso para quien llega invitado de que no tiene que crear nada.
- **Con varias**, o desde el panel con `/app?elegir`, un selector:
  - una tarjeta por organización con el rol, el plan y los locales a los que accede la cuenta;
  - «Crear otra organización» plegado.
- **El panel** enlaza siempre al selector: «Cambiar de organización» si hay varias, «Crear otra organización» si solo hay una.
- **Identificador opcional:** si se deja vacío, se genera a partir del nombre (`slugify`: sin tildes, en minúsculas y con guiones). Si está ocupado o reservado, se le añade un sufijo aleatorio, con hasta 5 intentos, cada uno en un savepoint. Si el identificador lo elige la persona y está ocupado, se le avisa en lugar de cambiarlo.

**Límites conocidos:**
- El número de locales se calcula con una transacción por organización; está pensado para pocas organizaciones por cuenta.

## D-056 — Menú lateral con Gestión y Organización plegables
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Contexto:** con el plan PRO, el menú (Inicio, local, Gestión y Organización) ya no cabía en una pantalla de portátil. Además, el enlace «Crear otra organización» (D-055) añadía una línea más, así que había que desplazarse y la cuenta quedaba cortada.

**Decisión:**
- **El bloque del local** (Resumen, Cartas, Reservas…) siempre desplegado.
- **Gestión y Organización** plegables en acordeón (`<details>`):
  - al abrir una se cierra la otra;
  - se abre sola la que contiene la página actual, y al navegar se vuelve a ajustar;
  - se manejan con el teclado como cualquier `<details>`.
- **Cuenta y salir**, siempre abajo:
  - solo se desplaza la lista del menú si no cabe;
  - «Cambiar de organización» o «Crear otra organización» pasa a ser un icono junto a «Cerrar sesión», con su nombre accesible y su título.
- **Pruebas:**
  - en las E2E, `navLink()` abre el grupo antes de pulsar un enlace, como haría una persona;
  - `tests/e2e/sidebar.spec.ts` comprueba el acordeón, el grupo de la página actual, el teclado y que la cuenta queda a la vista en una pantalla baja.

## D-057 — Fuentes del panel con `font-display: optional`
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Contexto:**
- La prueba de rendimiento falló en la CI con un CLS de 0,225 en una carta y 0,101 en reservas.
- El diagnóstico añadido mostró que el contenido subía 48 px: las pestañas pasaban de dos líneas a una.
- Next genera la fuente de reserva de Inter a partir de Arial con sus medidas ajustadas. En los servidores de la CI no hay Arial ni Liberation Sans (en local Arial se resuelve con Liberation Sans, que tiene sus mismas medidas). Allí se usaba una fuente más ancha y, al llegar Inter (`swap`), el texto se recolocaba.
- Reproducido en local cambiando la fuente de reserva por DejaVu Sans y retrasando las fuentes: CLS de 0,274 (carta) y 0,105 (reservas) con `swap`; 0 con `optional`.

**Decisión:**
- **Fuentes del panel (Inter y Fraunces) con `display: "optional"`:**
  - si no llegan a tiempo para la primera pintura, esa carga se queda con la de reserva y no se recoloca nada;
  - la página siguiente las toma de la caché;
  - el cambio está en el generador (`scripts/fetch-fonts.mjs`) y en su salida.
  - La web pública sigue con `swap`: sus fuentes son parte del estilo elegido y, en el peor caso, no superan el límite (CLS ≤ 0,003).
- **La prueba de rendimiento mide ahora el CLS también en el peor caso:**
  - fuentes que tardan 600 ms en llegar;
  - fuente de reserva sin las medidas de Arial;
  - en una segunda pasada que no cuenta el peso del CSS.
- **Mutación:** con `swap` en el panel, la prueba falla en 3 páginas (CLS de 0,105 a 0,274).

**Alternativas descartadas:**
- Precargar las fuentes del panel: la precarga de next/font se aplicaría a todas las páginas, incluida la web pública, que no las usa.
- Subir el límite de CLS.

## D-058 — Exportaciones a CSV
**Fecha:** 2026-11-04. **Estado:** aceptada.

**Decisión:**
- **Página «Exportar datos»** en Organización. Tiene un formulario por tipo, con el local o todos y el periodo:
  - reservas;
  - mensajes de la web;
  - turnos;
  - stock actual, sin periodo;
  - movimientos de inventario.
  - Solo aparecen las exportaciones que permiten el rol y el plan.
- **Permisos:**
  - permiso nuevo `data.export` para propietario, administrador y encargado, desde el plan Avanzado;
  - además, cada exportación exige la lectura de su módulo: reservas, mensajes, turnos o inventario (PRO);
  - RLS limita las filas a la organización y a los locales de la cuenta.
- **Descarga:**
  - `POST /app/<org>/exports/<tipo>` con comprobación de origen, como la exportación de privacidad;
  - respuesta `private, no-store` y en la auditoría queda `data.exported` con el tipo, el local, el periodo y el número de filas (sin datos personales).
- **Límites:**
  - periodo con las dos fechas incluidas, en la hora de cada local, de como máximo 366 días;
  - como máximo 50.000 filas por archivo; si hay más, se pide acotar.
- **Formato** pensado para Excel en español (`src/lib/csv.ts`):
  - separador «;», decimales con coma, CRLF y marca UTF-8;
  - fechas «AAAA-MM-DD» y horas «HH:MM» locales;
  - cantidades de inventario en la unidad base (g, ml, ud.).
- **Fórmulas inyectadas (CSV injection):** los textos que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno de carro se preceden de un apóstrofo; los números no.

**Límites conocidos:**
- Si la descarga se rechaza por un error de validación, el navegador muestra un texto plano: los campos obligatorios y las fechas se validan antes en el formulario, pero el límite de días no.
- No hay exportación de la carta ni de los clientes como lista aparte; los datos de un cliente concreto se exportan desde Privacidad.
- Los CSV contienen datos personales: la página lo advierte y su custodia es responsabilidad de quien los descarga.

## D-059 — Historias en la portada de la web
**Fecha:** 2026-11-05. **Estado:** aceptada.

**Contexto:** los restaurantes quieren destacar algo nada más entrar en su web (un evento, una apertura, un cambio de horario), al estilo de las historias de Instagram.

**Decisión:**
- **Migración 0036, `site_stories` por local:**
  - titular (hasta 60 caracteres), texto opcional (hasta 280) y foto opcional, que es un archivo propio y se borra con la historia o al sustituirla;
  - botón opcional: reservar, ver la carta, contactar o un enlace propio, este solo `https://` y con su texto;
  - fechas de inicio y fin opcionales (días del local, ambas incluidas) y orden;
  - como máximo 10 historias por local;
  - RLS por local; las comprobaciones (CHECK) de la BD repiten las del servicio, incluida la del enlace `https://`.
- **Plan:** desde Avanzado, como la galería (`site.customize`).
  - En Básico no se muestran ni se sirven sus fotos.
  - Lo guardado se conserva y vuelve al subir de plan.
- **Lectura pública:**
  - `app.public_site_stories` y `app.story_is_public`: solo las vigentes hoy, en la hora del local, de una web publicada y con plan Avanzado o superior;
  - `app.public_media` sirve la foto solo mientras la historia lo está.
- **Corrección incluida:** `app.public_media` deja de servir las fotos de la galería en el plan Básico. Antes seguían accesibles por su enlace directo.
- **Panel:** pestaña «Historias» en «Web pública», con el estado de cada historia (se ve ahora, programada o terminada), edición, cambio de orden y borrado.
- **Web:** círculos arriba de la portada y visor a pantalla completa en un `<dialog>` modal.
  - **Apertura automática:** la primera vez que un navegador entra, la primera historia se abre sola. Lo visto se recuerda en `localStorage`, por versión, así que una historia editada vuelve a contar como nueva. No hay cookies ni datos en el servidor.
  - **Avance:** pasa sola cada 7 s. Se puede pausar, ir adelante o atrás con botones y con las flechas del teclado, y cerrar con Esc.
  - **Movimiento reducido:** la barra avanza a saltos de un segundo en lugar de deslizarse, pero el temporizador sigue, con pausa.
    - Primero se hizo que no avanzara sola. En un ordenador con las animaciones desactivadas, habitual en Windows, la barra se quedaba quieta y el visor no se cerraba.
    - La preferencia pide menos animación, no que nada avance; la pausa cubre WCAG 2.2.2.
  - **Legibilidad:** sobre una foto, un velo oscuro asegura que el texto se lea; sin foto, la tarjeta usa el color del acento del estilo.
  - **Idiomas:** los textos del visor están en los 7 idiomas.

**Límites conocidos:**
- El titular y el texto de las historias no se traducen; se muestran igual en todos los idiomas.
- Sin vídeo: haría falta almacenamiento de archivos fuera de la BD.
- Que se recuerde lo visto depende del almacenamiento del navegador; en modo privado puede volver a abrirse sola.

## D-060 — Historias: pausa al mantener pulsado, ubicación del texto y vista previa
**Fecha:** 2026-11-06. **Estado:** aceptada.

**Decisión:**
- **Visor, como en Instagram:**
  - mantener pulsado (dedo o ratón) pausa y oculta los controles; al soltar, sigue;
  - un toque en el 35 % izquierdo de la historia retrocede y en el resto avanza;
  - se mantienen un botón de pausa pequeño, la barra espaciadora, las flechas del teclado y flechas a los lados (visibles con ratón; con pantalla táctil, solo al recibir el foco). Así se cumple WCAG 2.2.2 sin depender del gesto.
- **Ubicación, con opciones fijas** (migración 0037):
  - texto arriba, en el centro o abajo, alineado a la izquierda o centrado;
  - botón junto al texto o abajo del todo;
  - se descartó colocarlos libremente, porque en pantallas de otro tamaño quedarían descolocados.
- **Legibilidad sobre fotos:** el velo oscuro se intensifica donde va el texto, y el texto lleva una sombra suave.
- **Vista previa en el panel:**
  - al crear o editar una historia se ve en directo la misma tarjeta que el visor (`StoryCard`, compartida), con el estilo, la tipografía y el color de la web (`siteLook`, compartida con la web);
  - incluye la foto elegida antes de subirla, que se carga como `blob:` (la CSP ya lo permite);
  - avisa de que «Reservar» solo sale con las reservas online activadas y «Ver la carta», con una carta publicada.

## D-061 — Inicio de sesión con Google, Apple y Facebook
**Fecha:** 2026-11-06. **Estado:** aceptada.

**Decisión:**
- **Flujo:** OAuth 2.0 con código de autorización, canjeado en el servidor.
  - **Google:** OpenID Connect con PKCE y nonce.
  - **Apple:** OpenID Connect con nonce y vuelta por POST (`form_post`). El secreto de cliente es un JWT ES256 firmado con la clave `.p8`.
  - **Facebook:** Graph API con `appsecret_proof`.
- **Tokens:** los de identidad de Google y Apple se comprueban con sus claves públicas: firma RS256, emisor, destinatario, caducidad y nonce. Para eso se añade la dependencia `jose` 6.2.13, sin dependencias propias y de referencia para JWT/JWKS; escribir esa verificación a mano sería más arriesgado.
- **Protección del intento:**
  - el intento (`state`, verificador PKCE, nonce y la página de destino) viaja en una cookie HttpOnly de 10 minutos y un solo uso, con prefijo `__Host-` en producción;
  - la vuelta solo se acepta con el mismo `state`, comparado en tiempo constante. Eso evita que alguien inicie sesión en el navegador de otra persona con su propia cuenta (login CSRF);
  - para Apple la cookie es `SameSite=None; Secure`, porque vuelve con un POST desde su dominio.
- **Cuentas** (tabla `user_identities`, migración 0038; `users.password_hash` pasa a ser opcional):
  - la identidad se reconoce por el identificador del proveedor, no por el correo;
  - **vinculación:** si el proveedor garantiza el correo (Google y Apple), se vincula a la cuenta existente con ese correo. Facebook no lo garantiza, así que no se vincula: se pide entrar con contraseña, para evitar apropiarse de cuentas ajenas;
  - **alta:** sin cuenta, se crea sin contraseña, solo si `AUTH_ALLOW_SIGNUP` está activo;
  - **concurrencia:** dos vueltas simultáneas no duplican la cuenta, gracias a las restricciones únicas y a un reintento;
  - el rol de la aplicación no puede cambiar ni borrar identidades.
- **Activación:** cada proveedor se activa solo con todas sus credenciales y `APP_BASE_URL`. Sin ellas no hay botón y sus rutas responden 404; no se simula nada.
- **Errores:** se muestran en la página de acceso por código conocido (`?error=`); nunca el texto que llega en el enlace.
- **Límites:** 30 vueltas por IP cada 15 minutos.

**Límites conocidos:**
- No probado contra los proveedores reales: requiere sus credenciales y, para Apple, un dominio con https. Las pruebas cubren la verificación de tokens con claves locales, la resolución de cuentas, el inicio del flujo y el rechazo de vueltas con otro `state`.
- Sin pantalla para vincular o desvincular proveedores desde una cuenta ya abierta.
- Las cuentas sin contraseña no pueden crearla mientras no haya proveedor de correo.
- Con el registro desactivado, una persona invitada no puede darse de alta con un proveedor: debe usar el enlace de la invitación.

## D-062 — Prueba gratuita de 7 días del plan PRO
**Fecha:** 2026-11-06. **Estado:** aceptada.

**Decisión:**
- **Alcance:** al crear su primera organización, el propietario prueba el plan PRO completo durante 7 días (`TRIAL_DAYS` en `src/lib/plans.ts`). Sin tarjeta: no hay proveedor de cobros.
- **Una prueba por persona:** `users.trial_used_at` (migración 0039). `app.start_trial` (SECURITY DEFINER) bloquea la fila del usuario, así que dos altas a la vez no dan dos pruebas. Solo empieza si quien llama es propietario activo de la organización. El rol de la aplicación no puede borrar la marca.
- **Caducidad materializada:** durante la prueba se guarda `plan = 'pro'` y `organizations.trial_ends_at`. Todas las comprobaciones de plan existentes (permisos, triggers y funciones públicas en la BD) siguen leyendo `plan` sin cambios. `app.expire_trials()` pasa al Básico las pruebas vencidas con las mismas reglas que bajar de plan a mano: desactiva la reserva online y anula las invitaciones abiertas. Lo demás se conserva.
- **Cuándo se aplica:**
  - **Panel:** `withTenant` comprueba la fecha de la organización antes de leer el plan y aplica la caducidad en el acto: el panel nunca da el PRO pasada la fecha.
  - **Páginas públicas:** web, cartas, reserva, lista de espera, contacto e imágenes llaman a `expireTrialsIfDue()`, una consulta por índice limitada a una cada 30 s por proceso.
  - **Selector de organizaciones:** muestra como Básico una prueba vencida aunque aún no se haya aplicado.
- **Elegir plan termina la prueba:** `changePlan` pone `trial_ends_at = NULL`, aunque se elija el mismo PRO.
- **Interfaz:**
  - aviso en el panel con los días que quedan y «Elegir plan»;
  - días restantes en «Plan»;
  - aviso en el alta de cuenta y en la bienvenida (solo si la persona aún no ha usado su prueba);
  - etiqueta «Prueba PRO» en el selector.

**Límites conocidos:**
- Pasada la fecha, las páginas públicas pueden seguir mostrando funciones del PRO durante unos 30 segundos, hasta la siguiente comprobación periódica.
- Los miembros que se unieron durante la prueba siguen dentro al pasar al Básico, con los permisos del Básico (sin gestión de miembros). Bajar a Básico a mano sigue exigiendo quitarlos antes.
- Sin aviso por correo antes del fin de la prueba: requiere proveedor de correo.
- No hay trabajo programado: si nadie entra al panel ni a la web, la caducidad se aplica en la siguiente visita. El resultado es el mismo, porque nada lee el plan sin pasar por esas comprobaciones.

## D-063 — Web pública de Nébora (escaparate)
**Fecha:** 2026-11-06. **Estado:** aceptada.

**Decisión:**
- **Rutas:** `/` deja de redirigir al acceso y pasa a ser la web de Nébora. `/precios` añade la comparativa por función. El panel sigue en `/app`, al que se llega con «Iniciar sesión».
- **Contenido:** portada con la prueba de 7 días como gancho principal; funciones con el plan que las incluye; «cómo funciona»; banda de la prueba; planes con precio; preguntas frecuentes; cierre.
- **Una sola fuente:** planes, precios y lo que incluye cada uno salen de `src/lib/plans.ts`, compartido con la página «Plan» del panel. Los precios (Básico gratis, Avanzado 29 €/mes y PRO 59 €/mes, sin IVA) son de ejemplo hasta fijar los definitivos.
- **Llamada principal según el estado:**
  - con sesión: «Ir al panel»;
  - con registro abierto: «Prueba gratis 7 días» (lleva a `/register`);
  - con el registro cerrado: no se ofrece una prueba imposible; se indica que el alta no está abierta.
- **Sin elementos ficticios:** no hay testimonios, cifras de clientes ni enlaces legales sin contenido. La ilustración de la portada es decorativa (`aria-hidden`).
- **Implementación:** componentes de servidor sin JavaScript propio, en `src/components/marketing/`. Usan las tipografías y los tokens del panel.
- **Identificadores reservados:** la migración 0039 reserva rutas futuras de la web (`precios`, `planes`, `funciones`, `prueba`, `demo`, `ayuda`, `blog`, `contacto`, `legal`, `privacidad`, `terminos`, `cookies`), además de `auth`, `preview` y `print`, para que ninguna organización las ocupe.

**Pendiente:**
- textos legales (aviso legal, privacidad y cookies), que debe aportar el titular;
- dominio propio;
- precios definitivos y proveedor de cobros.
