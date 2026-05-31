#!/usr/bin/env bash
# Развёртывание Nextcloud (этап 6.3). Запуск: bash <repo>/deploy/nextcloud/setup.sh
# Идемпотентно: .env генерируется один раз, повторный запуск только обновляет стек.
set -euo pipefail

DST=/srv/nextcloud
SRC_GLOB=/mnt/f/*/redesign-v2-fresh/deploy/nextcloud

mkdir -p "$DST"
cp $SRC_GLOB/docker-compose.yml "$DST/docker-compose.yml"

if [ ! -f "$DST/.env" ]; then
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
    echo "NC_ADMIN_USER=admin"
    echo "NC_ADMIN_PASSWORD=$(openssl rand -hex 18)"
  } > "$DST/.env"
  chmod 600 "$DST/.env"
  echo "ENV_CREATED"
else
  echo "ENV_EXISTS"
fi

cd "$DST"
docker compose pull
docker compose up -d
echo "COMPOSE_UP_DONE"
