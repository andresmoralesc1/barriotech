# Backup infrastructure (Tier 19)

Two complementary backups run every night:

| Cron | Script | Destination | Retention |
|---|---|---|---|
| `30 3 * * *` | `scripts/backup-db.sh` | local `./backups/` | 7 daily + 4 weekly |
| `0 3 * * *`  | `scripts/backup-db-to-telegram.sh` | Telegram chat `TELEGRAM_BACKUP_CHAT_ID` | unlimited (Telegram side) + 30d local registry |

Both use the same env (`apps/web/.env` → `DB_*` / `PGPASSWORD`).

## Why two destinations?

- **Local**: fast to restore, no network risk, but bound to this VM.
- **Telegram**: off-site mirror. If the server's disk dies, recovery is still possible.
  Telegram stores up to 2 GB per file (we cap uploads at 19 MB) and is effectively
  free. Latency is high (~3 s per chunk) but backups run at 3 am so it doesn't matter.

## Restore — three modes

| Scenario | Command |
|---|---|
| Files already on disk | `bash scripts/restore-db-from-telegram.sh <newdb>` |
| Pull from Telegram automatically | `bash scripts/restore-db-from-telegram.sh <newdb> --from-registry backups/telegram-registry/<latest>.json` |
| Manual from chat | `bash scripts/restore-db-from-telegram.sh <newdb> --from-chat` (prints instructions) |

Restore creates a NEW database — never overwrites production.
The script cat-pipes `part-NNN.sql.gz` parts in numeric order into `psql --single-transaction`.

## Chunking

If a single `.sql.gz` would exceed the 19 MB Telegram cap, the backup script
switches to "split-plain" mode:

- dumps to uncompressed plain SQL
- `split -b 19M` into numbered parts
- gzips each part individually (parts can be downloaded independently)
- posts each as a separate Telegram document

Restore concatenates them: `cat part-001.sql.gz part-002.sql.gz | gunzip | psql`.

## Files

| File | Purpose |
|---|---|
| `scripts/backup-db.sh` | Local-disk backup with retention |
| `scripts/backup-db-to-telegram.sh` | Off-site backup to Telegram |
| `scripts/restore-db-from-telegram.sh` | Restore companion (3 modes) |
| `scripts/_tg_restore.py` | Python helper used by `--from-registry` mode |
| `backups/telegram-registry/<TS>.json` | Local index of bot-side `file_id`s (gitignored, 30-day retention) |
| `logs/backup-telegram.log` | Cron log (gitignored) |
