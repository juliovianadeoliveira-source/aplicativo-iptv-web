# Snapshot JSTech Atendimento — 24/09/2026

Este diretório reúne o código que estava pronto/implantado no projeto no momento do snapshot.

## Frontend
- frontend/index.html
- frontend/app.js
- frontend/styles.css
- frontend/resellers.js
- frontend/crm.js
- frontend/crm.css
- frontend/external-clients.js
- frontend/service-worker.js
- frontend/manifest.webmanifest
- frontend/app-icon.svg
- frontend/README.md
- frontend/coletor-revenda/README.md
- frontend/coletor-revenda/config.example.php
- frontend/coletor-revenda/sync.php

## VPS
- vps/jstech-wuzapi-agent.py — agente Python/Playwright em execução
- vps/docker-compose.yml — stack sem credenciais embutidas
- vps/.env.example — apenas nomes das variáveis, sem valores

## n8n
- n8n/workflows.json — export dos workflows, com chaves/tokens mascarados

## Supabase Edge Functions
- bootstrap-csp-admin
- csp-central-panel
- csp-collector-ingest
- csp-direct-sync
- csp-users-api
- jstech-ai-diagnostic
- jstech-n8n-campaign-queue
- jstech-orion-player
- jstech-panel-admin
- jstech-panel-catalog-sync
- jstech-pix-payment-webhook
- jstech-prime-catalog-sync
- jstech-prime-public-api
- jstech-prime-site
- jstech-prime-web
- jstech-privado-update-apk
- jstech-privado-upload-temp
- jstech-reseller-admin
- jstech-sync-admin
- jstech-sync-ingest
- jstech-username-login
- jstech-voice-admin
- jstech-voice-diag
- jstech-wa-bridge
- jstech-wa-broadcast
- jstech-wa-evolution-n8n-webhook
- jstech-wa-evolution-webhook
- jstech-wa-send
- jstech-wa-webhook
- jstech-wa-wuzapi-agent
- jstech-wa-wuzapi-webhook

Cada função está em:
supabase/functions/<nome>/index.ts

## Segurança
O snapshot não inclui senhas de painéis, tokens, API keys, service-role keys, credenciais do WhatsApp nem valores reais do .env.
