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
