#!/usr/bin/env bash
set -uo pipefail
echo "=== nginx local ==="
curl -s -m10 -o /dev/null -w "localhost:8080 -> %{http_code}\n" http://localhost:8080/
echo "=== web perms ==="
ls -la /srv/daniil-deploy/web
echo "=== daniil-web logs (tail) ==="
docker logs daniil-web --tail=8 2>&1
echo "=== manual webdav PUT to nextcloud ==="
cd /srv/nextcloud; set -a; source .env; set +a
U="$NC_APP_USER"; P="$NC_APP_PASSWORD"
DAV="http://localhost:8081/remote.php/dav/files/$U"
curl -s -u "$U:$P" -X MKCOL "$DAV/projects/diagtest/" -o /dev/null -w "MKCOL: %{http_code}\n"
echo "hello-diag" > /tmp/t.txt
curl -s -u "$U:$P" -T /tmp/t.txt "$DAV/projects/diagtest/t.txt" -o /tmp/putresp -w "PUT: %{http_code}\n"
echo "--- put resp body ---"; cat /tmp/putresp; echo
curl -s -u "$U:$P" -X DELETE "$DAV/projects/diagtest/" -o /dev/null -w "cleanup: %{http_code}\n"
rm -f /tmp/t.txt /tmp/putresp
