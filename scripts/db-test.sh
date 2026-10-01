#!/usr/bin/env bash
# Applies the test auth stub, every migration and every test in supabase/tests
# to a throwaway database, then drops it.
#
#   scripts/db-test.sh
#
# Connection: set DATABASE_ADMIN_URL (a superuser URL to the `postgres` database)
# for CI. Without it the script uses the local `postgres` OS user.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="mmc_test_$$"

admin_psql() {
  if [[ -n "${DATABASE_ADMIN_URL:-}" ]]; then
    psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q "$@"
  else
    runuser -u postgres -- psql -d postgres -v ON_ERROR_STOP=1 -q "$@"
  fi
}

db_psql() {
  if [[ -n "${DATABASE_ADMIN_URL:-}" ]]; then
    local base="${DATABASE_ADMIN_URL%/*}"
    psql "$base/$DB" -v ON_ERROR_STOP=1 -q "$@"
  else
    runuser -u postgres -- psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"
  fi
}

cleanup() { admin_psql -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

admin_psql -c "create database $DB" >/dev/null

echo "== stub"
db_psql < "$ROOT/supabase/tests/stub/auth_stub.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "== migration $(basename "$f")"
  db_psql < "$f"
done

status=0
for f in "$ROOT"/supabase/tests/[0-9]*.sql; do
  echo "== test $(basename "$f")"
  if ! db_psql < "$f" > /dev/null; then status=1; fi
done

if [[ $status -eq 0 ]]; then echo "ALL DATABASE TESTS PASSED"; else echo "DATABASE TESTS FAILED"; fi
exit $status
