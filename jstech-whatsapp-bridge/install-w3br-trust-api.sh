#!/usr/bin/env bash
set -euo pipefail

BASE="/var/www/html/painel"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
API_SRC="$SRC_DIR/w3br-trust-api.php"
API_DST="$BASE/jstech-trust-api.php"
CONF="/etc/jstech-trust-api.php"
BACKUP="/var/backups/jstech-trust-$(date +%Y%m%d-%H%M%S)"

if [[ $EUID -ne 0 ]]; then
  echo "ERRO: execute como root."
  exit 1
fi
if [[ ! -f "$BASE/conexao.php" ]]; then
  echo "ERRO: painel W3BR não encontrado em $BASE."
  exit 1
fi
if [[ ! -f "$API_SRC" ]]; then
  echo "ERRO: arquivo w3br-trust-api.php não encontrado em $SRC_DIR."
  exit 1
fi

mkdir -p "$BACKUP"
[[ -f "$API_DST" ]] && cp -a "$API_DST" "$BACKUP/"
[[ -f "$CONF" ]] && cp -a "$CONF" "$BACKUP/"

SECRET="$(openssl rand -hex 32)"
cat > "$CONF" <<PHP
<?php
return array('secret' => '$SECRET');
PHP

# Apache no Ubuntu normalmente usa www-data.
chown root:www-data "$CONF"
chmod 0640 "$CONF"

install -o root -g www-data -m 0644 "$API_SRC" "$API_DST"

php -l "$API_DST"
php -r 'include "/var/www/html/painel/conexao.php"; foreach(array("painel_acessos","painel_geral","painel_user") as $n){ if(isset($$n) && $$n instanceof PDO){ try{$q=$$n->query("SHOW TABLES LIKE '''liberarcomputador'''"); if($q && $q->fetch(PDO::FETCH_NUM)){echo "Tabela liberarcomputador encontrada em $n\n";}}catch(Exception $e){} } }'

echo
echo "INSTALADO."
echo "Backup: $BACKUP"
echo "Segredo salvo em: $CONF"
echo "Endpoint: $API_DST"
echo
echo "Para testar localmente sem liberar ninguém:"
echo "curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1/painel/jstech-trust-api.php"
echo
echo "NÃO envie o conteúdo de $CONF em grupos ou prints públicos."
