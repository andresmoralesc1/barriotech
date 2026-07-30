-- Add last_used_at to push_subscriptions.
--
-- The /api/push/subscribe and /api/account/export routes reference this
-- column, but the original push_subscriptions table created outside
-- this migration directory omitted it. The result was a 500 on every
-- push subscribe attempt and a SQL error on every account export.
--
-- ADD COLUMN with NOT NULL DEFAULT is metadata-only in PG 11+ (no table
-- rewrite), so this is safe to run on the live table even with millions
-- of rows. Existing rows get NOW() as the backfill value.
--
-- Audit: 2026-07-30 — found during prod health check (push subscribe
-- was 500 for every user; the column was missing from the original
-- DDL even though both writers always supply NOW()).

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
