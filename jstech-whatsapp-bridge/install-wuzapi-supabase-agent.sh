#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: execute como root."
  exit 1
fi

CREDS="/root/wuzapi-credentials.txt"

bootstrap_wuzapi_if_missing() {
  if curl -sS --max-time 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
    return 0
  fi

  echo "WuzAPI não encontrado nesta VPS. Fazendo instalação inicial..."

  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git openssl >/dev/null
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable --now docker >/dev/null 2>&1 || true
  if ! docker compose version >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || true
    fi
  fi
  docker compose version >/dev/null 2>&1 || {
    echo "ERRO: Docker Compose não ficou disponível."
    exit 1
  }

  mkdir -p /opt/wuzapi/data
  chmod 700 /opt/wuzapi/data

  WUZAPI_COMMIT="cba302749d3957316b0bdcaef7693193f50f0edb"
  if [ ! -d /opt/wuzapi/source/.git ]; then
    rm -rf /opt/wuzapi/source
    git clone -q https://github.com/asternic/wuzapi.git /opt/wuzapi/source
  fi
  git -C /opt/wuzapi/source fetch -q --depth 1 origin "$WUZAPI_COMMIT"
  git -C /opt/wuzapi/source checkout -q --detach "$WUZAPI_COMMIT"

  local admin user enc hmac
  admin="$(openssl rand -hex 16)"
  user="$(openssl rand -hex 16)"
  enc="$(openssl rand -hex 16)"
  hmac="$(openssl rand -hex 24)"

  umask 077
  cat >/opt/wuzapi/.env <<EOF
WUZAPI_ADMIN_TOKEN=$admin
WUZAPI_GLOBAL_ENCRYPTION_KEY=$enc
WUZAPI_GLOBAL_HMAC_KEY=$hmac
TZ=America/Sao_Paulo
WEBHOOK_FORMAT=json
SESSION_DEVICE_NAME=JSTech
WUZAPI_PORT=8080
EOF

  cat >/opt/wuzapi/docker-compose.yml <<'YAML'
services:
  wuzapi:
    build:
      context: ./source
      dockerfile: Dockerfile
    container_name: jstech_wuzapi
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    env_file:
      - .env
    volumes:
      - ./data:/app/dbdata
YAML

  cat >/etc/systemd/system/wuzapi.service <<'EOF'
[Unit]
Description=JSTech WuzAPI
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/wuzapi
ExecStart=/usr/bin/docker compose up -d
ExecReload=/usr/bin/docker compose restart wuzapi
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

  echo "Compilando e iniciando WuzAPI. Na primeira instalação isso pode demorar alguns minutos..."
  (
    cd /opt/wuzapi
    docker compose build --pull
    docker compose up -d
  )

  systemctl daemon-reload
  systemctl enable wuzapi >/dev/null 2>&1 || true

  local ready=""
  for _ in $(seq 1 60); do
    if curl -sS --max-time 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
      ready="yes"
      break
    fi
    sleep 2
  done
  if [ "$ready" != "yes" ]; then
    echo "ERRO: WuzAPI foi instalado, mas não respondeu na porta 8080."
    docker logs --tail 40 jstech_wuzapi 2>/dev/null || true
    exit 1
  fi

  local users
  users="$(curl -sS --max-time 10 -H "Authorization: $admin" http://127.0.0.1:8080/admin/users || true)"
  if ! printf '%s' "$users" | grep -Fq "$user"; then
    curl -fsS --max-time 15 -X POST \
      -H "Authorization: $admin" \
      -H "Content-Type: application/json" \
      --data "$(printf '{"name":"JSTech","token":"%s"}' "$user")" \
      http://127.0.0.1:8080/admin/users >/dev/null
  fi

  {
    printf 'USER_TOKEN=%s\n' "$user"
    printf 'WUZAPI_ADMIN_TOKEN=%s\n' "$admin"
  } >"$CREDS"
  chmod 600 "$CREDS"

  echo "WuzAPI instalado e credenciais locais criadas com segurança."
}

bootstrap_wuzapi_if_missing

read_env_value() {
  local key="$1"; shift
  local f v
  for f in "$@"; do
    [ -f "$f" ] || continue
    v="$(grep -E "^\${key}=" "$f" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'\\''"]//' -e 's/["'\\''"]$//' || true)"
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  done
  return 1
}

recover_wuzapi_credentials() {
  local admin="" users_json="" recovered=""

  admin="$(read_env_value WUZAPI_ADMIN_TOKEN /opt/wuzapi/.env /etc/wuzapi/.env /root/wuzapi/.env 2>/dev/null || true)"
  if [ -z "$admin" ]; then
    admin="$(systemctl show wuzapi -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^WUZAPI_ADMIN_TOKEN=//p' | tail -1 | sed -e 's/^["'\\''"]//' -e 's/["'\\''"]$//' || true)"
  fi
  if [ -z "$admin" ]; then
    admin="$(systemctl cat wuzapi 2>/dev/null | sed -n 's/.*-admintoken[= ]\([^ ]*\).*/\1/p' | tail -1 | sed -e 's/^["'\\''"]//' -e 's/["'\\''"]$//' || true)"
  fi
  [ -n "$admin" ] || return 1

  users_json="$(mktemp)"
  chmod 600 "$users_json"
  if ! curl -fsS --max-time 10 -H "Authorization: $admin" http://127.0.0.1:8080/admin/users >"$users_json"; then
    rm -f "$users_json"
    return 1
  fi

  recovered="$(python3 - "$users_json" <<'PY'
import json,sys,urllib.request
p=sys.argv[1]
try:
    d=json.load(open(p,encoding="utf-8"))
except Exception:
    raise SystemExit(1)
rows=d
if isinstance(d,dict):
    rows=d.get("data") or d.get("users") or d.get("Users") or []
if isinstance(rows,dict):
    rows=list(rows.values())
if not isinstance(rows,list):
    rows=[]
candidates=[]
for x in rows:
    if not isinstance(x,dict): continue
    tok=str(x.get("token") or x.get("Token") or "").strip()
    if not tok: continue
    name=str(x.get("name") or x.get("Name") or "").strip().lower()
    score=0
    if name=="jstech": score+=100
    elif "jstech" in name: score+=80
    if name.startswith("rev-") or "revenda" in name: score-=20
    candidates.append((score,name,tok))
candidates.sort(reverse=True)
for _,_,tok in candidates:
    try:
        req=urllib.request.Request("http://127.0.0.1:8080/session/status",headers={"token":tok})
        with urllib.request.urlopen(req,timeout=4) as r:
            obj=json.loads(r.read().decode("utf-8","replace") or "{}")
        data=obj.get("data") or {}
        if data.get("loggedIn") is True or data.get("connected") is True:
            print(tok,end="")
            raise SystemExit(0)
    except Exception:
        pass
if candidates:
    print(candidates[0][2],end="")
    raise SystemExit(0)
raise SystemExit(1)
PY
)" || true
  rm -f "$users_json"

  [ -n "$recovered" ] || return 1
  umask 077
  {
    printf 'USER_TOKEN=%s\n' "$recovered"
    printf 'WUZAPI_ADMIN_TOKEN=%s\n' "$admin"
  } >"$CREDS"
  chmod 600 "$CREDS"
  return 0
}

if [ ! -f "$CREDS" ] || ! grep -q '^USER_TOKEN=' "$CREDS" 2>/dev/null; then
  echo "Credenciais locais não encontradas. Tentando recuperar o acesso já configurado no WuzAPI..."
  if recover_wuzapi_credentials; then
    echo "Credenciais recuperadas com segurança."
  else
    echo "ERRO: não foi possível recuperar automaticamente as credenciais do WuzAPI nesta máquina."
    echo "O WhatsApp existente não foi alterado."
    echo "Verifique se o serviço WuzAPI e o arquivo /opt/wuzapi/.env pertencem a esta VPS."
    exit 1
  fi
fi

TOKEN="$(grep '^USER_TOKEN=' "$CREDS" | tail -1 | cut -d= -f2-)"
if [ -z "$TOKEN" ]; then
  echo "ERRO: USER_TOKEN não encontrado."
  exit 1
fi

STATUS="$(curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/session/status || true)"
if [ -z "$STATUS" ]; then
  echo "ERRO: WuzAPI não respondeu em 127.0.0.1:8080."
  exit 1
fi

AGENT_TMP="/tmp/wuzapi-supabase-agent.py"
rm -f "$AGENT_TMP"
curl -fsSL --retry 3 "https://cdn.jsdelivr.net/gh/juliovianadeoliveira-source/aplicativo-iptv-web@cf9bb290ba1ccaba860fe92a79cad3a510c401fa/jstech-whatsapp-bridge/wuzapi-supabase-agent.py" -o "$AGENT_TMP" \
|| curl -fsSL --retry 3 "https://raw.githubusercontent.com/juliovianadeoliveira-source/aplicativo-iptv-web/cf9bb290ba1ccaba860fe92a79cad3a510c401fa/jstech-whatsapp-bridge/wuzapi-supabase-agent.py" -o "$AGENT_TMP"
install -m 0755 "$AGENT_TMP" /usr/local/bin/jstech-wuzapi-agent.py

# Ambiente isolado para a automacao dos paineis. Se o navegador nao puder
# ser instalado nesta maquina, o WhatsApp continua funcionando normalmente.
PANEL_VENV="/opt/jstech-panel-agent"
AGENT_PYTHON="/usr/bin/python3"
PANEL_BROWSER="NAO"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq python3-venv ca-certificates >/dev/null 2>&1 || true
fi

if /usr/bin/python3 -m venv "$PANEL_VENV" >/dev/null 2>&1; then
  AGENT_PYTHON="$PANEL_VENV/bin/python"
  "$PANEL_VENV/bin/pip" install --disable-pip-version-check --no-cache-dir -q "playwright>=1.45,<2" >/tmp/jstech-playwright-install.log 2>&1 || true

  if "$PANEL_VENV/bin/python" -c 'import playwright' >/dev/null 2>&1; then
    "$PANEL_VENV/bin/python" -m playwright install --with-deps chromium >>/tmp/jstech-playwright-install.log 2>&1 \
      || "$PANEL_VENV/bin/python" -m playwright install chromium >>/tmp/jstech-playwright-install.log 2>&1 \
      || true

    if "$PANEL_VENV/bin/python" - <<'PY' >/dev/null 2>&1
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    page=b.new_page()
    page.goto("about:blank")
    b.close()
PY
    then
      PANEL_BROWSER="OK"
    fi
  fi
fi

cat >/etc/systemd/system/jstech-wuzapi-agent.service <<EOF
[Unit]
Description=JSTech WhatsApp Supabase Agent
After=network-online.target wuzapi.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$AGENT_PYTHON /usr/local/bin/jstech-wuzapi-agent.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

# Garante que imagens, audios e documentos recebidos sejam entregues ao webhook.
# Em versoes novas do WuzAPI, remover a configuracao S3 volta ao modo base64.
curl -sS --max-time 10 -X DELETE -H "token: $TOKEN"   http://127.0.0.1:8080/session/s3/config >/tmp/jstech-media-mode.json 2>/dev/null || true

SIG="$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')"
WEBHOOK="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook?token=$SIG"

WEBHOOK_JSON="$(printf '{"webhookurl":"%s","events":["Message","CallOffer","Connected","Disconnected","KeepAliveRestored","KeepAliveTimeout","LoggedOut"]}' "$WEBHOOK")"
curl -fsS -X POST \
  -H "token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data "$WEBHOOK_JSON" \
  http://127.0.0.1:8080/webhook >/tmp/jstech-webhook-result.json

mkdir -p /etc/systemd/system/wuzapi.service.d
cat >/etc/systemd/system/wuzapi.service.d/restart.conf <<'EOF'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=5
EOF

cat >/usr/local/bin/jstech-wuzapi-keepalive.sh <<'EOF'
#!/bin/bash
TOKEN="$(grep '^USER_TOKEN=' /root/wuzapi-credentials.txt | tail -1 | cut -d= -f2-)"
STATUS="$(curl -s --max-time 10 -H "token: $TOKEN" http://127.0.0.1:8080/session/status)"
[ -z "$STATUS" ] && { systemctl restart wuzapi; exit 0; }
CONNECTED="$(printf '%s' "$STATUS" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(str(d.get("data",{}).get("connected",False)).lower())' 2>/dev/null || echo false)"
LOGGED="$(printf '%s' "$STATUS" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(str(d.get("data",{}).get("loggedIn",False)).lower())' 2>/dev/null || echo false)"
if [ "$CONNECTED" != "true" ] && [ "$LOGGED" = "true" ]; then
  curl -s --max-time 15 -X POST -H "token: $TOKEN" -H "Content-Type: application/json"     --data '{"Subscribe":["All"],"Immediate":true}'     http://127.0.0.1:8080/session/connect >/dev/null || true
fi
EOF
chmod +x /usr/local/bin/jstech-wuzapi-keepalive.sh

cat >/etc/systemd/system/jstech-wuzapi-keepalive.service <<'EOF'
[Unit]
Description=JSTech WuzAPI KeepAlive
After=wuzapi.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jstech-wuzapi-keepalive.sh
EOF

cat >/etc/systemd/system/jstech-wuzapi-keepalive.timer <<'EOF'
[Unit]
Description=Verifica WuzAPI a cada minuto

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable wuzapi >/dev/null 2>&1 || true
systemctl enable --now jstech-wuzapi-agent.service
systemctl restart jstech-wuzapi-agent.service
systemctl enable --now jstech-wuzapi-keepalive.timer

sleep 2

echo "=== AGENTE JSTech ==="
systemctl is-active jstech-wuzapi-agent.service
echo "=== MULTI-REVENDA ==="
python3 - <<'PY'
import importlib.util
p="/usr/local/bin/jstech-wuzapi-agent.py"
spec=importlib.util.spec_from_file_location("a",p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print("admin-token:", "OK" if m.read_admin_token() else "NAO_ENCONTRADO")
PY
echo "=== WEBHOOK PRINCIPAL ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/webhook | python3 -c 'import sys,json; d=json.load(sys.stdin); x=d.get("data",{}); print("eventos:", ",".join(x.get("subscribe",[]) or [])); print("CallOffer:", "OK" if "CallOffer" in (x.get("subscribe",[]) or []) else "NAO")'
echo "=== WHATSAPP PRINCIPAL ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/session/status | python3 -c 'import sys,json; d=json.load(sys.stdin); x=d.get("data",{}); print("connected:", x.get("connected")); print("loggedIn:", x.get("loggedIn")); print("name:", x.get("name","")); print("jid:", x.get("jid",""))'
echo "=== MIDIAS DO WHATSAPP ==="
echo "entrega para o bot: base64"
echo "=== BLOQUEIO DE LIGACOES ==="
grep -q 'reject_call' /usr/local/bin/jstech-wuzapi-agent.py && echo "ativo no agente" || echo "agente antigo"
echo "=== AUTOMACAO DE PAINEIS ==="
echo "modo-memoria: 2GB / 1 painel por vez"
echo "Playwright: $PANEL_BROWSER"
grep -q 'process_panel_job' /usr/local/bin/jstech-wuzapi-agent.py && echo "worker-paineis: OK" || echo "worker-paineis: NAO"
if [ "$PANEL_BROWSER" = "OK" ]; then
  echo "navegador-paineis: OK"
else
  echo "navegador-paineis: NAO"
fi
