#!/bin/sh
# Nightly backup of the EduERP database and uploaded files; keeps the last 14 days.
# Install on the server:  crontab -e   →   30 1 * * * /opt/eduerp/deploy/backup.sh >> /opt/eduerp/deploy/backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date +%Y-%m-%d_%H%M)
docker compose --env-file .env exec -T postgres pg_dump -U eduerp_owner -d eduerp --format=custom > "backups/eduerp-$stamp.dump"
docker compose --env-file .env run --rm --no-deps -T --entrypoint tar api czf - -C /data files > "backups/files-$stamp.tar.gz"
find backups -name 'eduerp-*.dump' -mtime +14 -delete
find backups -name 'files-*.tar.gz' -mtime +14 -delete
echo "$(date) backup ok: eduerp-$stamp.dump"
