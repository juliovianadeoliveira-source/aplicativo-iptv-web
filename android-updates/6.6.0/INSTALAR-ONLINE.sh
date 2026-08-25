#!/usr/bin/env bash
set -euo pipefail

APP="/opt/js-player-android"
UI="$APP/app/src/main/java/com/jsplayer/app/ui/StableJsPlayerApp.kt"
GRADLE="$APP/app/build.gradle.kts"
APK="$APP/app/build/outputs/apk/debug/app-debug.apk"
PUB="/var/www/iptv-player/app-update"
AAPT="/opt/android-sdk/build-tools/35.0.0/aapt"
APKSIGNER="/opt/android-sdk/build-tools/35.0.0/apksigner"
RAW="https://raw.githubusercontent.com/juliovianadeoliveira-source/aplicativo-iptv-web/main/android-updates/6.6.0"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP/backup-660-receptor-profissional-$STAMP"
TMP_DIR="$(mktemp -d /tmp/js-player-660.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "JS PLAYER 6.6.0 - baixando atualização..."
[ -d "$APP" ] || { echo "ERRO: $APP não encontrado"; exit 1; }

curl -fL "$RAW/StableJsPlayerApp.kt" -o "$TMP_DIR/StableJsPlayerApp.kt"
curl -fL "$RAW/build.gradle.kts" -o "$TMP_DIR/build.gradle.kts"

grep -q 'TODOS OS CANAIS • A–Z' "$TMP_DIR/StableJsPlayerApp.kt" || {
  echo "ERRO: arquivo da interface inválido"; exit 1;
}
grep -q 'versionName = "6.6.0"' "$TMP_DIR/build.gradle.kts" || {
  echo "ERRO: arquivo de versão inválido"; exit 1;
}

mkdir -p "$BACKUP" "$PUB"
cp "$UI" "$BACKUP/StableJsPlayerApp.kt"
cp "$GRADLE" "$BACKUP/build.gradle.kts"
install -m 644 "$TMP_DIR/StableJsPlayerApp.kt" "$UI"
install -m 644 "$TMP_DIR/build.gradle.kts" "$GRADLE"

cd "$APP"
./gradlew assembleDebug --no-daemon --max-workers=1

BADGING="$($AAPT dump badging "$APK")"
CODE="$(echo "$BADGING" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
NAME="$(echo "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
[ "$NAME" = "6.6.0" ] || { echo "ERRO: APK ficou na versão $NAME"; exit 1; }
"$APKSIGNER" verify --verbose "$APK" >/dev/null

cp "$APK" "$PUB/JS-PLAYER.apk.tmp"
mv -f "$PUB/JS-PLAYER.apk.tmp" "$PUB/JS-PLAYER.apk"

cat > "$PUB/version.json.tmp" <<EOF
{
  "versionCode": $CODE,
  "versionName": "6.6.0",
  "apk": "/app-update/JS-PLAYER.apk?v=$CODE&t=$(date +%s)",
  "mandatory": false,
  "message": "JS PLAYER 6.6.0 - receptor profissional: abre direto na TV, lista única A-Z, OK abre a lista e MENU/VOLTAR abre a tela principal."
}
EOF
mv -f "$PUB/version.json.tmp" "$PUB/version.json"
chmod 644 "$PUB/JS-PLAYER.apk" "$PUB/version.json"

echo "=============================================================="
echo "PRONTO: JS PLAYER 6.6.0 compilado e publicado"
echo "APK: $PUB/JS-PLAYER.apk"
echo "Backup: $BACKUP"
echo "=============================================================="
