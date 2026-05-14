#!/usr/bin/env bash
# Запуск бота: bash run.sh
set -e

cd "$(dirname "$0")"

if [ ! -x .venv/bin/apartment-bot ]; then
    echo "[!] Бот не установлен. Запусти setup.sh"
    exit 1
fi
if [ ! -f .env ]; then
    echo "[!] Нет .env. Заполни сначала."
    exit 1
fi

echo "=== Запускаю apartment-bot (Ctrl+C — стоп) ==="
exec .venv/bin/apartment-bot
