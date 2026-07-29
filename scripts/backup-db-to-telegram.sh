#!/usr/bin/env bash
#
# Tier 19 — Off-site backup mirror: pg_dump → gzip → Telegram chat.
#
# Behavior:
#   - Dumps the configured DB as plain SQL (streamable, split-friendly).
#   - Compresses with gzip; if the result fits one Telegram upload
#     (≤ CHUNK_MAX_BYTES, default 19 MiB to stay safely below the 50 MB
#     Bot API ceiling) it sends a single .sql.gz document.
#   - If the dump is larger than the cap, it streams plain SQL uncompressed
#     and `split`s into 18 MiB parts so restore is `cat part-* | psql`.
#   - Posts a Markdown manifest FIRST (timestamp, size, chunks, sha256)
#     and a completion confirmation LAST.
#
# Restore (companion script: scripts/restore-db-from-telegram.sh):
#   ./scripts/restore-db-from-telegram.sh <newdb>                              # local files
#   ./scripts/restore-db-from-telegram.sh <newdb> --from-registry backups/... # auto-pull via Bot API
#   ./scripts/restore-db-from-telegram.sh <newdb> --from-chat 1013              # (manual) from Tg
#
# A local registry is also written to backups/telegram-registry/<timestamp>.json
# containing the bot-side file_ids for each uploaded part. If the bot is the
# same one running this script, those file_ids can be fed to /getFile to pull
# the chunks automatically (--from-registry). Manual Telegram download also
# works: open the chat, long-press the file → Save As into a folder, then
# re-run with no --from flags.
#
# Cron (every day at 03:00 local):
#   0 3 * * * /home/telchar/gps-street-sellers/scripts/backup-db-to-telegram.sh \
#             >> /home/telchar/gps-street-sellers/logs/backup-telegram.log 2>&1
#
# Required env (in apps/web/.env):
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_BACKUP_CHAT_ID=...   (numeric chat id, or @channelusername for public channels)
#
# Optional env (overrides):
#   BACKUP_CHUNK_MAX_MB=19         (per-file cap; safe up to 50)
#   BACKUP_TELEGRAM_SILENT=1       (1 = send notifications silently)

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/apps/web/.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN not set in $ENV_FILE}"
: "${TELEGRAM_BACKUP_CHAT_ID:?TELEGRAM_BACKUP_CHAT_ID not set in $ENV_FILE}"

# Optional silent-mode (no user-visible notifications on phones).
SILENT_FLAG=""
if [[ "${BACKUP_TELEGRAM_SILENT:-0}" == "1" ]]; then
  SILENT_FLAG="-d disable_notification=true"
fi

# DB connection (reuse the existing variable names the rest of the project uses).
PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
PGPORT="${PGPORT:-${DB_PORT:-5432}}"
PGUSER="${PGUSER:-${DB_USER:-postgres}}"
PGDATABASE="${PGDATABASE:-${DB_NAME:-gps_street_sellers}}"
export PGPASSWORD="${PGPASSWORD:-${DB_PASSWORD:-}}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "[tg-backup] FAIL — DB password not set (DB_PASSWORD/PGPASSWORD)" >&2
  exit 1
fi

CHUNK_MAX_MB="${BACKUP_CHUNK_MAX_MB:-19}"
CHUNK_MAX=$(( CHUNK_MAX_MB * 1024 * 1024 ))

WORK="$(mktemp -d -t tier19-backup-XXXXXX)"
mkdir -p "$PROJECT_DIR/logs"
LOG_FILE="$PROJECT_DIR/logs/backup-telegram.log"
# Cleanup on exit, but keep dumps in $WORK only if DEBUG=1.
trap '[[ "${DEBUG:-0}" == "1" ]] || rm -rf "$WORK"' EXIT

ts() { date -u +"%Y-%m-%dT%H-%M-%SZ"; }
say() { echo "[$(ts)] $*"; }

say "start chat=${TELEGRAM_BACKUP_CHAT_ID} db=${PGDATABASE} chunk_max=${CHUNK_MAX_MB}MiB"

# -------- helpers ----------------------------------------------------------

# tg_send_manifest <text> → echoes message_id on stdout (empty if failed)
tg_send_manifest() {
  local text="$1"
  local resp="$WORK/manifest.json"
  curl -sS --max-time 60 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_BACKUP_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    -d "parse_mode=Markdown" \
    -d "disable_web_page_preview=true" \
    $SILENT_FLAG \
    -o "$resp"
  if [[ ! -s "$resp" ]]; then
    echo ""; return 0
  fi
  python3 -c "
import json,sys
try:
  d=json.load(open('$resp'))
  print(d.get('result',{}).get('message_id','') if d.get('ok') else '')
except Exception:
  print('')
"
}

# tg_send_doc <file> <caption> [reply_to_message_id]
tg_send_doc() {
  local file="$1" caption="$2" reply_to="${3:-}"
  local resp="$WORK/$(basename "$file").resp"
  local args=(
    -sS --max-time 600 -X POST
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument"
    -F "chat_id=${TELEGRAM_BACKUP_CHAT_ID}"
    -F "document=@${file}"
  )
  args+=( -F "caption=${caption}" )
  [[ -n "$reply_to" ]] && args+=( -F "reply_to_message_id=${reply_to}" )
  if [[ "${BACKUP_TELEGRAM_SILENT:-0}" == "1" ]]; then
    args+=( -F "disable_notification=true" )
  fi
  curl "${args[@]}" -o "$resp"
  python3 -c "
import json
try:
  d=json.load(open('$resp'))
  print('OK' if d.get('ok') else 'FAIL: '+d.get('description','?'))
except Exception as e:
  print('FAIL: '+str(e))
"
}

# -------- 1. pg_dump → plain SQL (streamable) ------------------------------

PLAIN="$WORK/backup.sql"
say "pg_dump → plain SQL"
START_TS=$(date +%s)
if ! pg_dump \
    --host="$PGHOST" --port="$PGPORT" --user="$PGUSER" --dbname="$PGDATABASE" \
    --no-owner --no-privileges --format=plain --clean --if-exists \
    > "$PLAIN"; then
  say "FAIL — pg_dump exit non-zero"
  exit 1
fi
PLAIN_SIZE=$(stat -c%s "$PLAIN")
PLAIN_MB=$(awk "BEGIN { printf \"%.2f\", $PLAIN_SIZE / 1024 / 1024 }")
say "plain dump=${PLAIN_MB} MiB"

# -------- 2. Compress; if small send as one .gz, else split uncompressed ----

GZ="$WORK/backup.sql.gz"
gzip -9 -c "$PLAIN" > "$GZ"
GZ_SIZE=$(stat -c%s "$GZ")
GZ_MB=$(awk "BEGIN { printf \"%.2f\", $GZ_SIZE / 1024 / 1024 }")
SHA256=$(sha256sum "$GZ" | awk '{print $1}')
say "gzip=${GZ_MB} MiB  sha256=${SHA256:0:16}…"

PARTS=()
MODE=""
if (( GZ_SIZE <= CHUNK_MAX )); then
  MODE="single-gz"
  PARTS=("$GZ")
else
  # gz is a stream format that CANNOT be safely cut at byte offsets; instead
  # split the uncompressed plain SQL stream which is just text statements.
  say "dump > chunk cap — switching to split-plain mode"
  MODE="split-plain"
  rm -f "$GZ"
  # split into fixed-size parts (sort -n does natural ordering of part-NN names)
  split -b "$CHUNK_MAX" -d -a 3 --numeric-suffixes=1 \
        "$PLAIN" "$WORK/part-"
  # also build a one-gz per part so each is independently downloadable + sized
  for f in "$WORK"/part-*; do
    gzip -9 -c "$f" > "${f}.gz"
  done
  PARTS=( "$WORK"/part-*.gz )
fi

PART_COUNT=${#PARTS[@]}
say "mode=${MODE} parts=${PART_COUNT}"

# -------- 3. Send manifest first (Markdown) --------------------------------

TIMESTAMP="$(ts)"
MANIFEST=$(cat <<EOF
🗄️ *DB backup*

• When: \`${TIMESTAMP}\`
• DB: \`${PGDATABASE}\`
• Compressed: \`${GZ_MB} MiB\` (raw \`${PLAIN_MB} MiB\`)
• Mode: \`${MODE}\` · parts: \`${PART_COUNT}\`
• SHA-256 (gz): \`${SHA256}\`

_Restore: download all parts, then run_\`scripts/restore-db-from-telegram.sh\`_or_\`cat part-*.sql.gz | gunzip | psql <newdb>\`_._
EOF
)

MANIFEST_ID="$(tg_send_manifest "$MANIFEST")"
if [[ -n "$MANIFEST_ID" ]]; then
  say "manifest message_id=${MANIFEST_ID}"
else
  say "WARN — manifest send failed, continuing with uploads anyway"
fi

# -------- 4. Send each part -----------------------------------------------

UPLOADED=0
FAILED=0
PART_RESULTS=()   # local registry entries (parallel to PARTS order)
for ((i=0; i<PART_COUNT; i++)); do
  part="${PARTS[$i]}"
  total=$PART_COUNT
  num=$((i+1))
  base="$(basename "$part")"
  caption="🧩 part ${num}/${total}  •  ${base}  •  sha=${SHA256:0:8}…"
  resp_file="$WORK/send-resp-${num}.json"
  args=(
    -sS --max-time 600 -X POST
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument"
    -F "chat_id=${TELEGRAM_BACKUP_CHAT_ID}"
    -F "document=@${part}"
    -F "caption=${caption}"
    -F "parse_mode=Markdown"
  )
  [[ -n "$MANIFEST_ID" ]] && args+=( -F "reply_to_message_id=${MANIFEST_ID}" )
  if [[ "${BACKUP_TELEGRAM_SILENT:-0}" == "1" ]]; then
    args+=( -F "disable_notification=true" )
  fi
  curl "${args[@]}" -o "$resp_file"
  file_id=$(python3 -c "
import json,sys
try:
  d=json.load(open('$resp_file'))
  if d.get('ok'):
    print(d['result']['document']['file_id'])
  else:
    print('')
except Exception:
  print('')
")
  if [[ -n "$file_id" ]]; then
    UPLOADED=$((UPLOADED+1))
    PART_RESULTS+=("{\"file_id\":\"${file_id}\",\"name\":\"${base}\",\"size\":$(stat -c%s "$part")}")
    say "uploaded ${num}/${total} ${base} file_id=${file_id:0:24}…"
  else
    FAILED=$((FAILED+1))
    PART_RESULTS+=("{\"file_id\":null,\"name\":\"${base}\",\"size\":$(stat -c%s "$part"),\"failed\":true}")
    say "FAIL ${num}/${total} ${base}"
  fi
done

END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))

# -------- 5. Send completion notice ---------------------------------------

if [[ "$FAILED" -gt 0 ]]; then
  WARN_LINE="⚠️ *${FAILED} chunk(s) failed — re-run after investigating network.*"
else
  WARN_LINE=""
fi
DONE_STATUS=$([[ "$MODE" == "single-gz" ]] && echo "complete" || echo "(see parts above)")
DONE=$(cat <<EOF
✅ *Backup ${DONE_STATUS}*
• Parts uploaded: \`${UPLOADED}/${PART_COUNT}\`  •  failed: \`${FAILED}\`
• Wall time: \`${DURATION}s\`
• Host: \`$(hostname)\`  •  DB: \`${PGDATABASE}\`

${WARN_LINE}
EOF
)
done_resp_id="$(tg_send_manifest "$DONE")"

# ---- 6. Write local registry (enables automated restore later) -----------
REG_DIR="$PROJECT_DIR/backups/telegram-registry"
mkdir -p "$REG_DIR"
REG_FILE="$REG_DIR/${TIMESTAMP}.json"
parts_json="["
for idx in "${!PART_RESULTS[@]}"; do
  parts_json+="${PART_RESULTS[$idx]}"
  if (( idx < ${#PART_RESULTS[@]} - 1 )); then
    parts_json+=","
  fi
done
parts_json+="]"
cat > "$REG_FILE" <<EOF
{
  "timestamp":  "${TIMESTAMP}",
  "db":         "${PGDATABASE}",
  "mode":       "${MODE}",
  "size_gz":    ${GZ_SIZE},
  "size_plain": ${PLAIN_SIZE},
  "sha256":     "${SHA256}",
  "duration_s": ${DURATION},
  "host":       "$(hostname)",
  "manifest_message_id": "${MANIFEST_ID}",
  "completion_message_id": "${done_resp_id}",
  "parts":      ${parts_json}
}
EOF
say "registry → ${REG_FILE}"

# ---- 7. Retention: prune registries older than 30 days --------------------
# Local registry is convenient for restore-by-file-id but grows forever,
# so we cap it. Backups themselves live on Telegram (unlimited retention
# by design) — only the local index is pruned.
RETENTION_DAYS="${BACKUP_REGISTRY_RETENTION_DAYS:-30}"
PRUNED=$(find "$REG_DIR" -maxdepth 1 -type f -name '*.json' -mtime +"$RETENTION_DAYS" -print -delete 2>/dev/null | wc -l)
[[ "${PRUNED:-0}" -gt 0 ]] && say "pruned ${PRUNED} registry file(s) older than ${RETENTION_DAYS}d"

# ---- 8. Best-effort log rotation -----------------------------------------
LOG_FILE="$PROJECT_DIR/logs/backup-telegram.log"
if [[ -f "$LOG_FILE" ]] && [[ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]]; then
  mv "$LOG_FILE" "${LOG_FILE}.$(ts).old"
  gzip -9 "${LOG_FILE}.$(ts).old" 2>/dev/null || true
fi

say "done  uploaded=${UPLOADED}/${PART_COUNT}  failed=${FAILED}  duration=${DURATION}s"
[[ "$FAILED" -gt 0 ]] && exit 2 || exit 0
