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

install -m 0755 /tmp/wuzapi-supabase-agent.py /usr/local/bin/jstech-wuzapi-agent.py

cat >/etc/systemd/system/jstech-wuzapi-agent.service <<'EOF'
[Unit]
Description=JSTech WhatsApp Supabase Agent
After=network-online.target wuzapi.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/jstech-wuzapi-agent.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

SIG="$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')"
WEBHOOK="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook?token=$SIG"

curl -fsS -X POST \
  -H "token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"webhookurl\":\"$WEBHOOK\",\"events\":[\"Message\",\"Connected\",\"Disconnected\",\"KeepAliveRestored\",\"KeepAliveTimeout\",\"LoggedOut\"]}" \
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
  curl -s --max-time 15 -X POST -H "token: $TOKEN" -H "Content-Type: application/json" \
    --data '{"Subscribe":["All"],"Immediate":true}' \
    http://127.0.0.1:8080/session/connect >/dev/null || true
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
systemctl enable --now jstech-wuzapi-keepalive.timer

sleep 2

echo "=== AGENTE JSTech ==="
systemctl is-active jstech-wuzapi-agent.service
echo "=== WEBHOOK ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/webhook
echo
echo "=== WHATSAPP ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/session/status
echo
