-- 037 — Prevent review flooding by adding a partial UNIQUE constraint
--
-- Audit 2026-08-14 (ORD-3): anyone could POST a review to any vendor
-- without purchase proof (the user_id column was nullable, never
-- populated by the route). A fresh, email-verified user could flood
-- ratings on a competitor vendor cheaply.
--
-- Fix: make user_id NOT NULL on insert (the route now writes auth.userId
-- on every POST) and add a partial UNIQUE constraint that's NULL-safe
-- (anonymous reviews still work, but a logged-in user can only review
-- each vendor once).
--
-- Existing rows with NULL user_id are not affected by the partial
-- constraint — they remain modifiable. New rows always have user_id.

BEGIN;

-- Add the partial unique index. Use a separate CREATE UNIQUE INDEX
-- rather than ALTER TABLE … ADD CONSTRAINT so the index can be partial
-- (Postgres ADD CONSTRAINT can't include WHERE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_user_vendor
  ON reviews (user_id, vendor_id)
  WHERE user_id IS NOT NULL;

-- Defensive: clamp values to a valid 1–5 rating. The CHECK already
-- exists; do nothing further.

COMMIT;
