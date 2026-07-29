#!/usr/bin/env bash
#
# Tier 19 — Companion restore script for backups uploaded to Telegram.
#
# Usage:
#   ./scripts/restore-db-from-telegram.sh <newdb>                              # local files in cwd
#   ./scripts/restore-db-from-telegram.sh <newdb> --from-registry path.json    # auto-pull via Bot API
#   ./scripts/restore-db-from-telegram.sh <newdb> --from-chat 1013             # (manual) from Tg
#
# Auto-detects whether the supplied files are:
#   - a single backup.sql.gz              → gunzip | psql
#   - many part-NNN.sql.gz (or .sql)      → cat | gunzip | psql
#
# Restores safely to a NEW database you specify (does NOT overwrite prod).
#
# Required env (apps/web/.env) for --from-registry:
#   TELEGRAM_BOT_TOKEN=...      (same bot that uploaded the backup)
#   TELEGRAM_BACKUP_CHAT_ID=... (for sanity check; registry is the source of truth)

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/apps/web/.env"

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  exit 1
}

[[ $# -ge 1 ]] || usage
DBNAME="$1"; shift || true

MODE="local"
REG_PATH=""
case "${1:-}" in
  --from-registry) shift; REG_PATH="${1:?path}"; MODE="registry" ;;
  --from-chat)     shift; MODE="manual" ;;
esac

# Load .env for creds + Telegram token
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi
PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
PGPORT="${PGPORT:-${DB_PORT:-5432}}"
PGUSER="${PGUSER:-${DB_USER:-postgres}}"
export PGPASSWORD="${PGPASSWORD:-${DB_PASSWORD:-}}"

WORK="$(mktemp -d -t tier19-restore-XXXXXX)"
trap '[[ "${DEBUG:-0}" == "1" ]] || rm -rf "$WORK"' EXIT

echo "[restore] target: ${DBNAME}  on  ${PGUSER}@${PGHOST}:${PGPORT}  mode=${MODE}"

# ---- Registry-driven download --------------------------------------------
if [[ "$MODE" == "registry" ]]; then
  : "${TELEGRAM_BOT_TOKEN:?need TELEGRAM_BOT_TOKEN in .env}"
  [[ -f "$REG_PATH" ]] || { echo "[restore] FAIL — registry not found: $REG_PATH" >&2; exit 1; }

  PARTS_DIR="$WORK/parts"
  mkdir -p "$PARTS_DIR"

  echo "[restore] pulling parts from registry $REG_PATH"
  python3 "$SCRIPT_DIR/_tg_restore.py" \
    --token "$TELEGRAM_BOT_TOKEN" \
    --registry "$REG_PATH" \
    --out "$PARTS_DIR"

  echo "[restore] downloaded $(ls -1 "$PARTS_DIR" | wc -l) part(s)"
  cd "$PARTS_DIR"
fi

# ---- Manual-mode hint (user must download themselves first) ---------------
if [[ "$MODE" == "manual" ]]; then
  echo "[restore] manual mode:" >&2
  echo "[restore]   1) open the Telegram chat with the bot" >&2
  echo "[restore]   2) long-press each *.sql.gz / *.sql part → 'Save As…'" >&2
  echo "[restore]   3) drop them in $WORK/parts/" >&2
  echo "[restore]   4) re-run:   $0 $DBNAME" >&2
  exit 2
fi

# ---- Auto-detect what we have ---------------------------------------------
shopt -s nullglob
GZ=( *.sql.gz )
PLAIN=( *.sql )
shopt -u nullglob

if (( ${#GZ[@]} > 0 && ${#PLAIN[@]} > 0 )); then
  echo "[restore] mix of .sql.gz and .sql files — refusing to guess." >&2
  exit 1
fi
if (( ${#GZ[@]} == 0 && ${#PLAIN[@]} == 0 )); then
  echo "[restore] no *.sql or *.sql.gz files in $(pwd)" >&2
  exit 1
fi

if (( ${#GZ[@]} > 0 )); then
  IFS=$'\n' SORTED=($(printf '%s\n' "${GZ[@]}" | sort))
  unset IFS
  echo "[restore] mode=cat *.sql.gz | gunzip | psql  files=${#SORTED[@]}"
  if command -v pigz >/dev/null 2>&1; then
    DECOMPRESSOR=(pigz -dc)
  else
    DECOMPRESSOR=(gunzip -c)
  fi
  cat "${SORTED[@]}" | "${DECOMPRESSOR[@]}" \
    | psql --host="$PGHOST" --port="$PGPORT" --user="$PGUSER" \
           --dbname="$DBNAME" --no-password --single-transaction \
           --variable=ON_ERROR_STOP=1 --quiet
else
  IFS=$'\n' SORTED=($(printf '%s\n' "${PLAIN[@]}" | sort))
  unset IFS
  echo "[restore] mode=cat *.sql | psql  files=${#SORTED[@]}"
  cat "${SORTED[@]}" \
    | psql --host="$PGHOST" --port="$PGPORT" --user="$PGUSER" \
           --dbname="$DBNAME" --no-password --single-transaction \
           --variable=ON_ERROR_STOP=1 --quiet
fi

# ---- Verify optional: regex match against registry sha256 -----------------
if [[ -n "$REG_PATH" && -f "$REG_PATH" ]]; then
  expected_sha=$(python3 -c "import json; print(json.load(open('$REG_PATH'))['sha256'])")
  actual_sha=$(sha256sum "${SORTED[0]}" | awk '{print $1}')
  if [[ "$expected_sha" == "$actual_sha" ]]; then
    echo "[restore] OK — sha256 verified ($actual_sha)"
  else
    echo "[restore] WARN — sha256 mismatch (expected $expected_sha, got $actual_sha)" >&2
  fi
fi

echo "[restore] DONE — DB '${DBNAME}' restored"
