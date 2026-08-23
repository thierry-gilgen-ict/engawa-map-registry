#!/usr/bin/env bash
# Restore-test: load latest backup into a temporary database, verify schema, then drop it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${SCRIPT_DIR}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/engawa-map-registry}"
COMPOSE_FILE="${COMPOSE_FILE:-${COMPOSE_DIR}/compose.yaml}"
ENV_FILE="${ENV_FILE:-${COMPOSE_DIR}/.env}"
TEMP_DB="${TEMP_DB:-engawa_registry_restore_test}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

latest_backup="$(find "${BACKUP_DIR}" -name 'engawa_registry_*.dump' -type f | sort | tail -n 1)"
if [[ -z "${latest_backup}" ]]; then
  echo "No backup files found in ${BACKUP_DIR}" >&2
  exit 1
fi

echo "Using backup: ${latest_backup}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${TEMP_DB};" \
  -c "CREATE DATABASE ${TEMP_DB};"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T postgres \
  pg_restore -U "${POSTGRES_USER}" -d "${TEMP_DB}" --no-owner --no-privileges < "${latest_backup}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${TEMP_DB}" -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM schema_migrations ORDER BY version;" \
  -c "SELECT COUNT(*) AS site_count FROM sites;"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE ${TEMP_DB};"

echo "Restore test completed successfully."
