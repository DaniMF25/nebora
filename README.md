# Nébora — Kit de inicio para Claude

Este paquete contiene la documentación y las instrucciones iniciales para desarrollar Nébora, un SaaS multiempresa de gestión de restaurantes.

## Cómo empezar

1. Crea un repositorio **privado** en GitHub.
2. Descomprime este ZIP en la raíz del repositorio y sube los archivos.
3. Abre el repositorio en Claude Code o conecta el repositorio a la herramienta de Claude que vayas a utilizar.
4. Pide a Claude que lea `CLAUDE.md` y los documentos de `docs/` y `project/`.
5. Sigue `prompts/00-BOOTSTRAP.md`. No le pidas que genere toda la aplicación de golpe.
6. Cuando termine cada tarea, revisa los cambios, las pruebas y el estado antes de aceptar un commit.

## Qué incluye

- `CLAUDE.md`: instrucciones persistentes para Claude Code.
- `PROJECT.md`: alcance y objetivos del producto.
- `docs/`: arquitectura, seguridad, datos, pruebas y operaciones.
- `project/ROADMAP.md`: fases de trabajo.
- `project/STATUS.md`: punto de control inicial.
- `project/DECISIONS.md`: registro de decisiones técnicas.
- `prompts/`: prompts de inicio, trabajo por tarea y recuperación de contexto.
- `.gitignore`: evita subir secretos y archivos generados.

## Desarrollo local

Requisitos: Node.js ≥ 22.12, pnpm 10 y PostgreSQL ≥ 16.

1. Crea en PostgreSQL un rol propietario **no superusuario** para migraciones:
   ```sql
   CREATE ROLE nebora_admin LOGIN CREATEDB CREATEROLE PASSWORD '<contraseña local>';
   ```
2. Copia `.env.example` a `.env.local` (ignorado por Git) y rellena `DATABASE_ADMIN_URL`, `DATABASE_URL` y `NEBORA_APP_DB_PASSWORD`. Para probar el alta de cuentas en local añade `AUTH_ALLOW_SIGNUP=true`.
3. Instala y prepara la base de datos:
   ```bash
   pnpm install
   pnpm db:setup-local   # crea la BD, aplica migraciones y habilita el rol nebora_app
   pnpm dev
   ```

### Comprobaciones

| Comando | Qué hace |
|---|---|
| `pnpm lint` | ESLint (configuración de Next.js), sin avisos permitidos |
| `pnpm typecheck` | TypeScript estricto |
| `pnpm test` | Pruebas unitarias |
| `pnpm test:integration` | Pruebas contra una base de datos efímera creada y migrada desde cero (falla si no hay PostgreSQL) |
| `pnpm test:e2e` | `next build` + Playwright contra una BD `nebora_e2e` recreada. Si ya tienes Chromium, usa `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; si no, `pnpm exec playwright install chromium` |
| `pnpm build` | Build de producción |
| `pnpm db:migrate` | Aplica migraciones pendientes con `DATABASE_ADMIN_URL` |
| `pnpm privacy:retention` | Anonimiza datos de clientes caducados en todas las organizaciones (programar a diario en producción) |

El estado verificado del proyecto está en `project/STATUS.md`.

## Importante

El proyecto está en construcción: consulta `project/STATUS.md` para saber qué está implementado y probado. No es una certificación de seguridad ni está listo para producción. No contiene credenciales ni infraestructura desplegada.

No subas nunca `.env` con secretos reales. Usa `.env.example` como plantilla y un gestor de secretos para entornos desplegados.
