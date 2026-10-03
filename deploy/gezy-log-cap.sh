#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=/var/log
LIMIT_BYTES=$((700 * 1024 * 1024))
JOURNAL_LIMIT=350M

/usr/bin/journalctl --vacuum-size="$JOURNAL_LIMIT" >/dev/null 2>&1 || true

log_bytes() {
  /usr/bin/du -sx -B1 "$LOG_DIR" 2>/dev/null | /usr/bin/awk '{print $1}'
}

if [ "$(log_bytes)" -gt "$LIMIT_BYTES" ]; then
  /usr/sbin/logrotate -f /etc/logrotate.d/rsyslog >/dev/null 2>&1 || true
  /usr/sbin/logrotate -f /etc/logrotate.d/nginx >/dev/null 2>&1 || true
  /usr/bin/journalctl --vacuum-size="$JOURNAL_LIMIT" >/dev/null 2>&1 || true
fi

# Hanya hapus arsip/rotasi lama; file log aktif tidak disentuh langsung.
while [ "$(log_bytes)" -gt "$LIMIT_BYTES" ]; do
  candidate="$(
    /usr/bin/find "$LOG_DIR" -xdev -type f \
      \( -name '*.gz' -o -name '*.old' -o -regextype posix-extended -regex '.*/[^/]+\.[0-9]+(\.gz)?' \) \
      -printf '%T@ %s %p\0' 2>/dev/null |
      /usr/bin/sort -z -n |
      /usr/bin/head -z -n 1 || true
  )"
  candidate="${candidate%$'\0'}"
  [ -n "$candidate" ] || break
  file_path="${candidate#* }"
  file_path="${file_path#* }"
  case "$file_path" in
    "$LOG_DIR"/*) /usr/bin/rm -f -- "$file_path" ;;
    *) break ;;
  esac
done
