#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/video_knowledge_chatbot?schema=public}"

# postgresql://user:pass@host:port/dbname?...
BASE_URL="${DATABASE_URL%%\?*}"
DB_NAME="${BASE_URL##*/}"
ADMIN_URL="${BASE_URL%/*}/postgres"

if [ -z "$DB_NAME" ] || [ "$DB_NAME" = "$BASE_URL" ]; then
  echo "Could not parse database name from DATABASE_URL" >&2
  exit 1
fi

echo "Ensuring PostgreSQL database exists: $DB_NAME"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required. Install PostgreSQL client tools or use Docker:" >&2
  echo "  docker compose up -d" >&2
  exit 1
fi

if ! psql "$ADMIN_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Could not connect to PostgreSQL at $ADMIN_URL" >&2
  echo "Start Postgres first, for example:" >&2
  echo "  docker compose up -d" >&2
  exit 1
fi

EXISTS="$(psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")"
if [ "$EXISTS" != "1" ]; then
  psql "$ADMIN_URL" -c "CREATE DATABASE \"$DB_NAME\""
  echo "Created database: $DB_NAME"
else
  echo "Database already exists: $DB_NAME"
fi

npx prisma migrate deploy
