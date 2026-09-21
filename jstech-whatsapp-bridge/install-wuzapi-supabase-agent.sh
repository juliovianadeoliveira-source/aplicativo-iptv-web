#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: execute como root."
  exit 1
fi

CREDS="/root/wuzapi-credentials.txt"
if [ ! -f "$CREDS" ]; then
  echo "ERRO: $CREDS não encontrado."
  exit 1
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
curl -fsSL --retry 3 "https://cdn.jsdelivr.net/gh/juliovianadeoliveira-source/aplicativo-iptv-web@2c237843fabbb26d186fcf71ef192303360d0d13/jstech-whatsapp-bridge/wuzapi-supabase-agent.py" -o "$AGENT_TMP" \
|| curl -fsSL --retry 3 "https://raw.githubusercontent.com/juliovianadeoliveira-source/aplicativo-iptv-web/2c237843fabbb26d186fcf71ef192303360d0d13/jstech-whatsapp-bridge/wuzapi-supabase-agent.py" -o "$AGENT_TMP"
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
