#!/usr/bin/env bash
# SIK storage backup script.
# Creates a timestamped tar.gz of storage/autogiro_documents and submissions.log
# in backups/. Optionally pushes the archive off-server via rclone or scp.
#
# Suggested cron entry (daily at 02:30):
#   30 2 * * *  /var/www/sikforening.se/storage_backup.sh >> /var/log/sik-backup.log 2>&1
#
# Off-site copy (uncomment + configure):
#   - rclone: install rclone, run `rclone config`, name remote "sikbackup"
#     then set RCLONE_REMOTE below.
#   - scp:    set SCP_TARGET to user@host:/path
#
# Always test the restore from a backup at least once a year.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M)"
ARCHIVE_NAME="sik-storage-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

# Off-site destinations - leave empty to skip.
RCLONE_REMOTE="${RCLONE_REMOTE:-}"           # e.g. "sikbackup:storage-backups"
SCP_TARGET="${SCP_TARGET:-}"                 # e.g. "backup@example.com:/srv/backups/"

# How many local archives to keep (rotation).
KEEP_LOCAL_BACKUPS="${KEEP_LOCAL_BACKUPS:-30}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Is)] Creating backup ${ARCHIVE_NAME}"

# Build tar archive - include autogiro documents and submissions.log only.
tar -czf "${ARCHIVE_PATH}" \
    -C "${ROOT_DIR}" \
    --exclude='storage/rate_limit/*' \
    storage/autogiro_documents \
    storage/submissions.log 2>/dev/null || true

ARCHIVE_SIZE=$(stat -c %s "${ARCHIVE_PATH}" 2>/dev/null || stat -f %z "${ARCHIVE_PATH}" 2>/dev/null || echo "0")
echo "[$(date -Is)] Archive ready: ${ARCHIVE_PATH} (${ARCHIVE_SIZE} bytes)"

# Off-site copy.
if [[ -n "${RCLONE_REMOTE}" ]] && command -v rclone >/dev/null 2>&1; then
    echo "[$(date -Is)] Uploading via rclone to ${RCLONE_REMOTE}"
    rclone copy "${ARCHIVE_PATH}" "${RCLONE_REMOTE}" --quiet
fi

if [[ -n "${SCP_TARGET}" ]] && command -v scp >/dev/null 2>&1; then
    echo "[$(date -Is)] Uploading via scp to ${SCP_TARGET}"
    scp -q "${ARCHIVE_PATH}" "${SCP_TARGET}"
fi

# Local rotation - keep newest N archives, delete the rest.
echo "[$(date -Is)] Rotating local backups, keeping ${KEEP_LOCAL_BACKUPS}"
ls -1t "${BACKUP_DIR}"/sik-storage-*.tar.gz 2>/dev/null \
    | tail -n +"$((KEEP_LOCAL_BACKUPS + 1))" \
    | xargs -r rm -f

echo "[$(date -Is)] Backup completed."
