-- 038 — Performance indexes + cleanup
-- Audit 2026-08-14 (PERF-4): apps/web/app/api/vendors/[id]/route.ts:71 does
--   SELECT * FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC
-- Today idx_reviews_vendor_id is single-column; PG sorts in memory. At 200+
-- reviews per vendor this dominates. Add the composite to mirror the
-- pattern already used for products (idx_products_vendor_created).
-- Audit 2026-08-14 (PERF-5): add pagination to /api/reviews.
-- No created_at index on reviews — needed for ?sort=newest.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_reviews_vendor_id_created
  ON reviews (vendor_id, created_at DESC);

-- Helps ?sort=newest queries on /api/reviews.
CREATE INDEX IF NOT EXISTS idx_reviews_created_at
  ON reviews (created_at DESC);

-- /api/products already has idx_products_vendor_created (migration 016)
-- but the public browse sorts by p.created_at DESC. Add a covering
-- index so the WHERE p.is_active = true + ORDER BY uses an index
-- sort, not a Sort node.
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products (is_active, created_at DESC)
  WHERE is_active = true;

COMMIT;
