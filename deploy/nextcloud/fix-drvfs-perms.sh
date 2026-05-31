#!/usr/bin/env bash
# Отключить проверку прав data-каталога: на drvfs (bind-mount Windows-диска) chmod не
# действует, каталог всегда 0777 — Nextcloud иначе блокируется. Безопасно, т.к. доступ
# к Nextcloud только внутренний (наружу не выставлен).
set -euo pipefail
cd /srv/nextcloud
docker compose exec -T -u www-data app bash -s <<'EOF'
cat > /var/www/html/config/drvfs.config.php <<'PHP'
<?php
$CONFIG = array(
  'check_data_directory_permissions' => false,
);
PHP
echo "CONFIG_WRITTEN"
EOF
docker compose restart app
echo "APP_RESTARTED"
