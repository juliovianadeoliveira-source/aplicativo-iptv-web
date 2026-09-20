#!/usr/bin/env bash
set -euo pipefail

DIR="/opt/jstech-whatsapp"
PORT="${EVOLUTION_PORT:-8080}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose não encontrado."
  exit 1
fi

mkdir -p "$DIR"
cd "$DIR"

if [ -z "${1:-}" ]; then
  read -rp "Informe a URL pública do servidor (ex.: http://1.2.3.4:8080): " PUBLIC_URL
else
  PUBLIC_URL="$1"
fi

API_KEY="$(openssl rand -hex 32)"
DB_PASS="$(openssl rand -hex 24)"

cat > docker-compose.yml <<'YAML'
services:
  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: jstech_evolution_api
    restart: unless-stopped
    depends_on:
      - postgres
      - redis
    ports:
      - "${EVOLUTION_PORT:-8080}:8080"
    env_file:
      - .env
    volumes:
      - evolution_instances:/evolution/instances
    networks:
      - jstech-wa

  postgres:
    image: postgres:15-alpine
    container_name: jstech_evolution_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: evolution_db
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - jstech-wa

  redis:
    image: redis:7-alpine
    container_name: jstech_evolution_redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - jstech-wa

volumes:
  evolution_instances:
  postgres_data:
  redis_data:

networks:
  jstech-wa:
    driver: bridge

YAML

cat > .env <<EOF
SERVER_NAME=jstech-whatsapp
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=$PUBLIC_URL
CORS_ORIGIN=*
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true
LOG_LEVEL=ERROR,WARN,INFO
LOG_COLOR=true
LOG_BAILEYS=error
DEL_INSTANCE=false
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$DB_PASS@postgres:5432/evolution_db?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=jstech
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_REDIS_TTL=604800
CACHE_REDIS_PREFIX_KEY=jstech
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
WEBSOCKET_ENABLED=false
CONFIG_SESSION_PHONE_CLIENT=JSTech
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
AUTHENTICATION_API_KEY=$API_KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
LANGUAGE=pt-BR
POSTGRES_PASSWORD=$DB_PASS
EVOLUTION_PORT=$PORT
EOF

docker compose pull
docker compose up -d

echo
echo "============================================================"
echo "JSTech WhatsApp instalado."
echo "Servidor: $PUBLIC_URL"
echo "Chave do servidor: $API_KEY"
echo
echo "No JSTech Atendimento abra:"
echo "Configurações > WhatsApp > Configuração inicial do servidor"
echo "e cole somente estes dois dados."
echo "Depois disso, todos conectam apenas pelo QR Code."
echo "============================================================"
