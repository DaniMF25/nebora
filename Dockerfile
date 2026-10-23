# syntax=docker/dockerfile:1
#
# Imagen de Nébora. Dos destinos:
#   docker build --target runtime -t nebora-web .    → servidor web (por defecto)
#   docker build --target tools   -t nebora-tools .  → migraciones y tareas programadas
# Ninguna variable secreta se incluye en la imagen: se inyectan al ejecutar.
#
# Detrás de un proxy con inspección TLS, pasa su certificado raíz solo durante la
# compilación (no queda en la imagen): --secret id=extra_ca,src=/ruta/ca.crt

ARG NODE_IMAGE=node:22.22.0-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# pnpm queda en la imagen (legible por el usuario node): nada se descarga al ejecutar.
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca pnpm install --frozen-lockfile \
    && chmod -R a+rX /opt/corepack

FROM deps AS build
COPY . .
# Salida autónoma de Next (ver next.config.ts). Las fuentes de Google se descargan aquí, al compilar.
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NEBORA_STANDALONE=1 pnpm build

# Herramientas de operación: migraciones (DATABASE_ADMIN_URL) y retención de datos.
# Uso: docker run --rm -e DATABASE_ADMIN_URL=... nebora-tools pnpm db:migrate
FROM deps AS tools
COPY . .
# Sin red al ejecutar: si faltara pnpm, falla en lugar de descargarlo.
ENV COREPACK_ENABLE_NETWORK=0
USER node
CMD ["pnpm", "db:migrate"]

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Usuario sin privilegios; el proceso web solo necesita DATABASE_URL (rol nebora_app).
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
