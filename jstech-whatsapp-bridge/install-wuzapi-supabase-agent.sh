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

WEBHOOK="https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-wa-wuzapi-webhook"

curl -fsS -X POST   -H "token: $TOKEN"   -H "Content-Type: application/json"   --data "{\"webhookurl\":\"$WEBHOOK\",\"events\":[\"Message\",\"Connected\",\"Disconnected\",\"KeepAliveRestored\",\"KeepAliveTimeout\",\"LoggedOut\"]}"   http://127.0.0.1:8080/webhook >/tmp/jstech-webhook-result.json

systemctl daemon-reload
systemctl enable --now jstech-wuzapi-agent.service

sleep 2

echo "=== AGENTE JSTech ==="
systemctl is-active jstech-wuzapi-agent.service
echo "=== WEBHOOK ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/webhook
echo
echo "=== WHATSAPP ==="
curl -fsS -H "token: $TOKEN" http://127.0.0.1:8080/session/status
echo
