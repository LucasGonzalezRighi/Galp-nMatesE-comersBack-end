#!/bin/sh
# Copia diaria de la base de Galpón Mates (servicio `backup` de docker-compose.yml).
#
# Al arrancar y después cada 24 horas guarda `galpon-AAAA-MM-DD_HHMM.dump` en /backups (la carpeta
# `backend/deploy/backups` del servidor) y borra las copias de más de BACKUP_KEEP_DAYS días.
# La conexión sale de PGHOST, PGUSER, PGDATABASE y PGPASSWORD.
#
# Para restaurar una copia, ver "Copias de la base" en backend/docs/DESPLIEGUE.md.
set -eu

keep_days="${BACKUP_KEEP_DAYS:-14}"

while true; do
  file="/backups/galpon-$(date +%Y-%m-%d_%H%M).dump"
  if pg_dump --format=custom --no-owner --file="$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "Copia lista: $file"
  else
    rm -f "$file.tmp"
    echo "ERROR: no se pudo hacer la copia de la base" >&2
  fi
  find /backups -name 'galpon-*.dump' -mtime +"$keep_days" -delete
  sleep 86400
done
