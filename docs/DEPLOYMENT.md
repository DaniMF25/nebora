# Despliegue y operación

Guía independiente del proveedor. **Aún no hay ningún entorno desplegado**: elegir hosting, dominio y proveedor de base de datos es una decisión pendiente (ver `project/STATUS.md`). Nada de esto debe ejecutarse contra producción sin autorización explícita.

## Piezas

| Pieza | Qué es | Credencial que recibe |
|---|---|---|
| Web | Imagen `runtime` del `Dockerfile` (`node server.js`, usuario sin privilegios, puerto 3000) | `DATABASE_URL` (rol `nebora_app`) |
| Herramientas | Imagen `tools`: migraciones y tareas programadas | `DATABASE_ADMIN_URL` (rol `nebora_admin`) |
| PostgreSQL 16 | Gestionado, con copias automáticas | — |
| Proxy inverso / balanceador | TLS y cabeceras | — |

La web **nunca** recibe `DATABASE_ADMIN_URL`. El rol `nebora_app` no es superusuario, no tiene `BYPASSRLS` y no es propietario de las tablas: el aislamiento entre organizaciones depende de ello.

## Variables

| Variable | Web | Herramientas | Notas |
|---|---|---|---|
| `DATABASE_URL` | Obligatoria | — | `postgres://nebora_app:…@host:5432/nebora` (con `?sslmode=require` si el proveedor lo exige) |
| `DATABASE_ADMIN_URL` | **Prohibida** | Obligatoria | Rol propietario del esquema |
| `APP_BASE_URL` | Recomendada | — | Origen público `https://…`; sin ella no hay QR |
| `AUTH_ALLOW_SIGNUP` | Opcional | — | `false` por defecto. Para crear la primera cuenta, activarlo temporalmente y desactivarlo después |
| `PORT` | Opcional | — | 3000 por defecto |

Los secretos se inyectan al ejecutar (gestor de secretos del proveedor). No se incluyen en la imagen ni en el repositorio.

## Requisitos del proxy inverso

- TLS obligatorio. La cookie de sesión es `__Host-` en producción y solo viaja por HTTPS.
- **Sobrescribir** `X-Forwarded-For` con la IP real del cliente (no añadir a la que envía el cliente): los límites de la reserva online dependen de ella.
- Tamaño máximo de petición de al menos 9 MB (subida de fotos).
- Comprobación de salud: `GET /api/health` → 200 `{"status":"ok"}` o 503 si la base de datos no responde. La imagen trae también un `HEALTHCHECK` de Docker.
- Recomendado: HSTS en el dominio.

## Construir las imágenes

```sh
docker build --target runtime -t nebora-web .
docker build --target tools   -t nebora-tools .
```

La compilación descarga las fuentes de Google Fonts (se sirven después desde la propia aplicación). Detrás de un proxy con inspección TLS: `--secret id=extra_ca,src=/ruta/ca.crt` (y `--network host` si el proxy es local).

## Preparación inicial de la base de datos (una sola vez)

Con el usuario administrador del proveedor:

```sql
CREATE ROLE nebora_admin LOGIN CREATEROLE PASSWORD '<secreto>';  -- sin SUPERUSER
CREATE DATABASE nebora OWNER nebora_admin;
```

Las migraciones necesitan las extensiones `citext` y `btree_gist` (de confianza en PostgreSQL ≥ 13; algunos proveedores exigen habilitarlas en su panel). Después:

```sh
docker run --rm -e DATABASE_ADMIN_URL=… nebora-tools pnpm db:migrate
```

La migración 0001 crea el rol `nebora_app` **sin inicio de sesión**. Habilítalo con una contraseña propia:

```sql
ALTER ROLE nebora_app WITH LOGIN PASSWORD '<secreto>';
```

## Cada versión

1. CI en verde (`.github/workflows/ci.yml`: lint, tipos, unitarias, integración, E2E y construcción de imágenes).
2. Revisar las migraciones nuevas (son solo hacia delante; ninguna es destructiva hasta hoy).
3. Copia de seguridad previa.
4. `pnpm db:migrate` con la imagen `tools` de esa versión (idempotente: «Sin migraciones pendientes» si no hay nada).
5. Desplegar la imagen web y esperar a que `/api/health` responda 200.

**Vuelta atrás:** se puede volver a la imagen web anterior mientras las migraciones aplicadas sean compatibles con ella. Las migraciones no se deshacen: un error de esquema se corrige con una migración nueva o restaurando la copia del paso 3.

## Tareas programadas

| Tarea | Frecuencia | Comando |
|---|---|---|
| Anonimización de datos de clientes y limpieza de límites de peticiones | Diaria | `docker run --rm -e DATABASE_ADMIN_URL=… nebora-tools pnpm privacy:retention` |

Sin esta tarea **no hay anonimización automática** (D-020).

## Copias de seguridad y restauración

- Copias automáticas del proveedor con recuperación a un punto en el tiempo, más un volcado lógico diario fuera del proveedor y cifrado:
  `pg_dump --format=custom --no-owner --file=nebora-AAAAMMDD.dump "$DATABASE_ADMIN_URL"`
- Las fotos están en la base de datos (D-021): el volcado las incluye y crece con ellas.
- Las copias contienen datos personales de clientes: acceso restringido y retención limitada (el plazo de D-020 no se aplica a las copias).
- **Simulacro de restauración** (al menos trimestral): restaurar en una base de datos nueva con `pg_restore --no-owner --dbname=…`, crear los roles como en la preparación inicial, ejecutar `pnpm db:migrate` (debe decir «Sin migraciones pendientes»), arrancar una web contra ella y comprobar `/api/health` y el acceso de una cuenta.

## Verificado y pendiente

Verificado en local (2026-10-23): las dos imágenes se construyen; en contenedores aislados con PostgreSQL 16 las migraciones se aplican desde cero y una segunda ejecución no hace nada; `privacy:retention` funciona; la web arranca como usuario sin privilegios, `/api/health` responde 200 (503 sin base de datos) y el estado Docker pasa a `healthy`; un recorrido completo en navegador contra el contenedor (registro, local, horario, mesas, productos con foto, carta publicada, reservas online y la web pública en los tres temas) terminó sin errores.

Pendiente: elegir hosting y proveedor de PostgreSQL; dominio y TLS; almacenamiento de objetos para fotos; proveedor de correo; monitorización y alertas (errores, salud, espacio); simulacro real de restauración; CSP con nonces; límite de peticiones por IP en el login.
