-- 028_soft_delete_vendors.sql
--
-- Soft delete for vendors.
--
-- PROBLEM
-- A vendor has FK references from products, orders, reviews, favorites,
-- and sponsorships (see FK declarations on those tables). Hard-deleting
-- a vendor therefore cascades into a lot of historical churn — orders
-- still wanted for reporting, reviews still wanted for vendor rating,
-- sponsored-payout history still wanted for accounting. We also can't
-- surface "this vendor was removed at 2pm Tuesday" in the audit log if
-- we destroy the row.
--
-- ADD COLUMN
-- A nullable timestamptz. NULL = active, non-NULL = deleted at that time.
-- The "soft delete" is the standard pattern — cheap, reversible, and it
-- keeps every join downstream alive.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- PARTIAL INDEX
-- The most common admin listing is "all non-deleted vendors, sorted
-- by created_at DESC". A partial index over (created_at DESC) WHERE
-- deleted_at IS NULL serves that exact query without bloat from the
-- soft-deleted rows (which are queried separately in the papelera).
CREATE INDEX IF NOT EXISTS idx_vendors_active_created_at
  ON vendors (created_at DESC)
  WHERE deleted_at IS NULL;

-- UPDATE PUBLIC VIEW
-- The buyer-facing map, list, and search all read from
-- vendors_with_sponsorship. Filtering at the view guarantees no
-- deleted vendor leaks into a public response, even if a caller
-- forgets to add the predicate inline.
DROP VIEW IF EXISTS vendors_with_sponsorship;
CREATE VIEW vendors_with_sponsorship AS
  SELECT
    id, profile_id, name, description, category,
    latitude, longitude, is_active, rating, review_count,
    photo_url, created_at, phone, city_id, is_verified,
    location_updated_at, vehicle_type, vehicle_photo_url, slug,
    station_type, business_hours_enabled,
    business_hours_start, business_hours_end, business_days,
    (EXISTS (
      SELECT 1
      FROM sponsorships s
      WHERE s.vendor_id = v.id
        AND s.status = 'active'
        AND now() >= s.starts_at
        AND now() <= s.ends_at
    )) AS is_sponsored,
    COALESCE((
      SELECT max(s.ends_at)
      FROM sponsorships s
      WHERE s.vendor_id = v.id AND s.status = 'active'
    ), NULL) AS sponsored_until
  FROM vendors v
  WHERE v.deleted_at IS NULL;

-- DOWN MIGRATION (for rollback)
-- DROP VIEW IF EXISTS vendors_with_sponsorship;
-- CREATE VIEW vendors_with_sponsorship AS
--   SELECT id, profile_id, name, description, category, latitude, longitude,
--     is_active, rating, review_count, photo_url, created_at, phone, city_id,
--     is_verified, location_updated_at, vehicle_type, vehicle_photo_url,
--     slug, station_type, business_hours_enabled, business_hours_start,
--     business_hours_end, business_days,
--     (EXISTS (SELECT 1 FROM sponsorships s WHERE s.vendor_id = v.id AND s.status = 'active' AND now() >= s.starts_at AND now() <= s.ends_at)) AS is_sponsored,
--     COALESCE((SELECT max(s.ends_at) FROM sponsorships s WHERE s.vendor_id = v.id AND s.status = 'active'), NULL) AS sponsored_until
--   FROM vendors v;
-- DROP INDEX IF EXISTS idx_vendors_active_created_at;
-- ALTER TABLE vendors DROP COLUMN IF EXISTS deleted_at;
