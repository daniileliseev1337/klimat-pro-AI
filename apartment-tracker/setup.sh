#!/usr/bin/env bash
# Установка apartment-tracker. Запусти ОДИН РАЗ:  bash setup.sh
# Требует Python 3.10+.

set -e

cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[!] Python3 не найден. Установи Python 3.10 или новее."
    exit 1
fi

echo "=== Создаю venv ==="
[ -d .venv ] || python3 -m venv .venv

echo "=== Обновляю pip ==="
.venv/bin/pip install --upgrade pip

echo "=== Устанавливаю apartment-tracker ==="
.venv/bin/pip install -e ".[dev]"

echo "=== Готовлю config.yaml ==="
[ -f config.yaml ] || cp config_examples/config.example.yaml config.yaml

echo "=== Готовлю .env ==="
[ -f .env ] || cp config_examples/.env.example .env

echo "=== Инициализирую БД ==="
.venv/bin/apartment-tracker init

echo
echo "Готово. Дальше:"
echo "  1) Открой .env, впиши TELEGRAM_BOT_TOKEN (от @BotFather) и TELEGRAM_CHAT_ID (от @userinfobot)"
echo "  2) Запусти бота:  bash run.sh"
