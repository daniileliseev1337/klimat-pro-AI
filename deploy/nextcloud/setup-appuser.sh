#!/usr/bin/env bash
# Техюзер приложения + корневая папка /projects/ + selftest WebDAV. Идемпотентно.
set -euo pipefail
cd /srv/nextcloud

set -a; source .env; set +a

APP_USER="dashboard"
# дописать creds в .env при первом запуске
if ! grep -q '^NC_APP_USER=' .env; then echo "NC_APP_USER=$APP_USER" >> .env; fi
if ! grep -q '^NC_APP_PASSWORD=' .env; then
  echo "NC_APP_PASSWORD=$(openssl rand -hex 20)" >> .env
fi
APP_PASSWORD="$(grep '^NC_APP_PASSWORD=' .env | cut -d= -f2-)"

# создать юзера (идемпотентно)
if docker compose exec -T -u www-data app php occ user:list | grep -qi "  - $APP_USER:"; then
  echo "USER_EXISTS"
else
  docker compose exec -T -u www-data -e OC_PASS="$APP_PASSWORD" app \
    php occ user:add --password-from-env --display-name="Dashboard Service" "$APP_USER"
  echo "USER_CREATED"
fi

DAV="http://localhost:8081/remote.php/dav/files/$APP_USER"

echo "----MKCOL /projects----"
curl -s -u "$APP_USER:$APP_PASSWORD" -X MKCOL "$DAV/projects/" -o /dev/null -w 'MKCOL projects: %{http_code}\n'
curl -s -u "$APP_USER:$APP_PASSWORD" -X MKCOL "$DAV/projects/_selftest/" -o /dev/null -w 'MKCOL selftest: %{http_code}\n'

echo "----PUT----"
echo "nextcloud webdav selftest $(date -u +%FT%TZ)" > /tmp/nc_selftest.txt
curl -s -u "$APP_USER:$APP_PASSWORD" -T /tmp/nc_selftest.txt "$DAV/projects/_selftest/hello.txt" -o /dev/null -w 'PUT: %{http_code}\n'

echo "----GET----"
curl -s -u "$APP_USER:$APP_PASSWORD" "$DAV/projects/_selftest/hello.txt" -w '\nGET: %{http_code}\n'

echo "----PROPFIND----"
curl -s -u "$APP_USER:$APP_PASSWORD" -X PROPFIND -H 'Depth: 1' "$DAV/projects/_selftest/" -o /dev/null -w 'PROPFIND: %{http_code}\n'

echo "----DELETE----"
curl -s -u "$APP_USER:$APP_PASSWORD" -X DELETE "$DAV/projects/_selftest/hello.txt" -o /dev/null -w 'DELETE file: %{http_code}\n'
curl -s -u "$APP_USER:$APP_PASSWORD" -X DELETE "$DAV/projects/_selftest/" -o /dev/null -w 'DELETE dir: %{http_code}\n'
rm -f /tmp/nc_selftest.txt
echo "SELFTEST_DONE"
