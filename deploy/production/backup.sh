#!/usr/bin/env bash
# Daily PostgreSQL backup for Engawa Map registry production.
# Run on the production host (not inside the app container).
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${SCRIPT_DIR}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/engawa-map-registry}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-${COMPOSE_DIR}/compose.yaml}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_DIR}/engawa_registry_${timestamp}.dump"
temp_file="$(mktemp "${BACKUP_DIR}/.engawa_registry_${timestamp}.XXXXXX.dump")"

cleanup_temp() {
  rm -f "${temp_file}"
}
trap cleanup_temp EXIT

if ! docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${temp_file}"; then
  echo "pg_dump failed" >&2
  exit 1
fi

if [[ ! -s "${temp_file}" ]]; then
  echo "Backup file is empty" >&2
  exit 1
fi

chmod 600 "${temp_file}"
mv -f "${temp_file}" "${backup_file}"
trap - EXIT

find "${BACKUP_DIR}" -name 'engawa_registry_*.dump' -type f -mtime +"${RETENTION_DAYS}" -delete

echo "Backup written: ${backup_file}"
