-- 039 — Sponsorships: race + double-charge protection
-- Audit 2026-08-14 (C1): the previous "no-stack" guard locked the
-- sponsorships table with FOR UPDATE, but if a vendor has no active
-- row yet, the query returns zero rows and acquires no lock. Two
-- concurrent POSTs both pass the check and both INSERT. Now:
--   (a) unique partial index on (vendor_id) WHERE status IN
--       ('active','pending_payment') — DB-level defense in depth
--   (b) the route now locks the vendor row instead of the missing
--       sponsorship row, so concurrent POSTs serialize at the vendor.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsorships_one_active_per_vendor
  ON sponsorships (vendor_id)
  WHERE status IN ('active', 'pending_payment');

COMMIT;

-- The migration is idempotent. To verify:
-- SELECT count(*) FROM sponsorships WHERE status IN ('active','pending_payment');
-- Should be unique per vendor_id.
