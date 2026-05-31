#!/usr/bin/env bash
# Деплой собранного фронта (dist) в каталог раздачи nginx. С защитой от пустого
# glob (иначе можно случайно скопировать корень ФС). Запуск из файла-скрипта —
# glob здесь раскрывается надёжно (в отличие от inline через PowerShell).
set -euo pipefail
DST=/srv/daniil-deploy/web

shopt -s nullglob
matches=( /mnt/f/*/redesign-v2-fresh/dist )
if [ "${#matches[@]}" -ne 1 ]; then
  echo "GLOB FAIL: found ${#matches[@]} matches: ${matches[*]:-<none>}"; exit 1
fi
SRCDIR="${matches[0]}"
if [ ! -f "$SRCDIR/index.html" ]; then
  echo "NO index.html in $SRCDIR"; exit 1
fi

# безопасно: SRCDIR проверен, DST фиксирован.
# ВАЖНО: чистим СОДЕРЖИМОЕ, а не сам каталог — он является источником docker
# bind-mount; пересоздание каталога меняет inode и рвёт монтирование (nginx 403).
mkdir -p "$DST"
find "$DST" -mindepth 1 -delete
cp -r "$SRCDIR/." "$DST/"
echo "DEPLOYED from $SRCDIR"
ls -1 "$DST"
