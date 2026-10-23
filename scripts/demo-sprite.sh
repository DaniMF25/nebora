#!/usr/bin/env bash
# Demo TEMPORAL de Nébora en una máquina Linux limpia (pensado para un Sprite de
# Fly.io o cualquier Ubuntu/Debian con sudo). Instala PostgreSQL y Node si
# faltan, descarga la rama indicada, prepara la base de datos con roles sin
# privilegios, compila y arranca la web en el puerto 8080.
#
#   curl -fsSL https://raw.githubusercontent.com/DaniMF25/nebora/<rama>/scripts/demo-sprite.sh | bash
#
# NO es un despliegue de producción: registro abierto, sin copias de seguridad
# y datos de prueba. No introduzcas datos reales de clientes.
set -euo pipefail

REPO_URL="${NEBORA_REPO_URL:-https://github.com/DaniMF25/nebora.git}"
BRANCH="${NEBORA_BRANCH:-claude/festive-rubin-bxwmo0}"
APP_DIR="${NEBORA_DIR:-$HOME/nebora}"
PORT="${PORT:-8080}"
STATE_DIR="$HOME/.nebora-demo"

log() { printf '\n==> %s\n' "$*"; }
SUDO=""
AS_POSTGRES=(runuser -u postgres --)
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; AS_POSTGRES=(sudo -u postgres); fi

log "Paquetes del sistema"
need=()
command -v git > /dev/null || need+=(git)
command -v curl > /dev/null || need+=(curl ca-certificates)
command -v psql > /dev/null || need+=(postgresql postgresql-contrib)
command -v openssl > /dev/null || need+=(openssl)
if [ "${#need[@]}" -gt 0 ]; then
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "${need[@]}" > /dev/null
fi

node_ok() {
  command -v node > /dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}
if ! node_ok; then
  log "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - > /dev/null
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq nodejs > /dev/null
fi
node_ok || { echo "Se necesita Node.js >= 22.12"; exit 1; }

log "PostgreSQL"
if ! pg_lsclusters -h 2> /dev/null | grep -q online; then
  cluster=$(pg_lsclusters -h | awk 'NR==1 {print $1" "$2}')
  # shellcheck disable=SC2086
  $SUDO pg_ctlcluster $cluster start
fi
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 && break; sleep 1; done

# Contraseñas aleatorias de esta demo, guardadas solo en esta máquina.
mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
if [ ! -f "$STATE_DIR/secrets" ]; then
  umask 077
  {
    echo "PG_SUPER_PASSWORD=$(openssl rand -hex 24)"
    echo "NEBORA_ADMIN_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "NEBORA_APP_DB_PASSWORD=$(openssl rand -hex 24)"
  } > "$STATE_DIR/secrets"
fi
# shellcheck disable=SC1091
. "$STATE_DIR/secrets"
"${AS_POSTGRES[@]}" psql -qX -v ON_ERROR_STOP=1 -v pw="$PG_SUPER_PASSWORD" <<'SQL' > /dev/null
ALTER USER postgres PASSWORD :'pw';
SQL

log "Código ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

log "Dependencias"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm > /dev/null; then
  $SUDO corepack enable 2> /dev/null || corepack enable
fi
pnpm install --frozen-lockfile --reporter=silent

log "Base de datos (roles sin privilegios y migraciones)"
DATABASE_SUPERUSER_URL="postgres://postgres:$PG_SUPER_PASSWORD@127.0.0.1:5432/postgres" \
  NEBORA_ADMIN_DB_PASSWORD="$NEBORA_ADMIN_DB_PASSWORD" NEBORA_APP_DB_PASSWORD="$NEBORA_APP_DB_PASSWORD" \
  pnpm -s exec tsx scripts/db-provision.ts

umask 077
{
  echo "DATABASE_URL=postgres://nebora_app:$NEBORA_APP_DB_PASSWORD@127.0.0.1:5432/nebora"
  echo "AUTH_ALLOW_SIGNUP=true"
  if [ -n "${NEBORA_PUBLIC_URL:-}" ]; then echo "APP_BASE_URL=$NEBORA_PUBLIC_URL"; fi
} > .env.local
umask 022

log "Compilación"
pnpm -s build > "$STATE_DIR/build.log" 2>&1 || { tail -40 "$STATE_DIR/build.log"; exit 1; }

log "Arranque en el puerto $PORT"
if [ -f "$STATE_DIR/server.pid" ] && kill -0 "$(cat "$STATE_DIR/server.pid")" 2> /dev/null; then
  kill "$(cat "$STATE_DIR/server.pid")" && sleep 2
fi
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
NODE_ENV=production nohup pnpm exec next start -p "$PORT" -H 0.0.0.0 > "$STATE_DIR/server.log" 2>&1 &
echo $! > "$STATE_DIR/server.pid"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    log "Nébora funcionando en http://127.0.0.1:$PORT (registro abierto: crea tu cuenta en /register)"
    echo "Registro del servidor: $STATE_DIR/server.log"
    exit 0
  fi
  sleep 1
done
echo "La web no responde; últimas líneas del registro:"
tail -30 "$STATE_DIR/server.log"
exit 1
