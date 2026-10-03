#!/usr/bin/env bash
# Backup harian Gezy Learning Materials: database SQLite + file unggahan.
#
# Cara pakai:
#   DATA_DIR=/var/lib/gezy-learning-materials BACKUP_DIR=/var/backups/gezy-learning-materials ./backup.sh
#
# Cron harian (jalankan sebagai root atau user yang bisa baca DATA_DIR):
#   0 2 * * * DATA_DIR=/var/lib/gezy-learning-materials BACKUP_DIR=/var/backups/gezy-learning-materials /opt/gezy-learning-materials/deploy/backup.sh >> /var/log/gezy-backup.log 2>&1
#
# Mengembalikan backup: ekstrak arsip ke DATA_DIR lalu restart service.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/gezy-learning-materials}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gezy-learning-materials}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$DATA_DIR/gezy-materials.sqlite" ]; then
  echo "ERROR: database tidak ditemukan di $DATA_DIR/gezy-materials.sqlite" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Salinan database yang konsisten (VACUUM INTO) — aman walau app sedang jalan.
SRC_DB="$DATA_DIR/gezy-materials.sqlite" DEST_DB="$WORK/gezy-materials.sqlite" bun -e "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.SRC_DB, { readonly: true });
db.query('VACUUM INTO ?').run(process.env.DEST_DB);
db.close();
"

# File-file unggahan:
cp -a "$DATA_DIR/uploads" "$WORK/uploads"

tar -czf "$BACKUP_DIR/gezy-materials-$STAMP.tar.gz" -C "$WORK" .
find "$BACKUP_DIR" -name 'gezy-materials-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "OK: $BACKUP_DIR/gezy-materials-$STAMP.tar.gz ($(du -h "$BACKUP_DIR/gezy-materials-$STAMP.tar.gz" | cut -f1))"
