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

