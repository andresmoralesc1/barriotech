-- Migration 102: service offerings.
--
-- Extends `products` to carry both physical products AND services so a
-- single vendor catalog can host both. The schema is permissive enough
-- to add booking/calendar/payments later without forcing a second
-- migration per new field.
--
-- Why extend products and not add a parallel `services` table:
--
--   1. Single-catalog rule: every seller owns exactly one vendor row,
--      and that vendor's offerings (today: products) hang off it.
--      Two tables means two carts, two filter UIs, two admin views.
--   2. Reuse: Spanish FTS (mig 018), soft-delete cascade (mig 028),
--      is_active toggle (mig 023), photo URL regex (in 023) and the
--      product_photos carousel all already work for any "offering".
--   3. MVP is catalog + WhatsApp contact. There is no booking yet, no
--      schedule, no payment. The shape of a service offering today
--      (name, description, price, photo, duration, modality, unit) is
--      a strict superset of a product's shape.
--
-- A `kind` discriminator keeps the domain closed. If a future need
-- splits services into "class" vs "appointment" vs "rental", add the
-- new kind in BOTH the CHECK here AND in packages/core/src/types.
--
-- Backwards compatibility:
--
--   * `kind` defaults to 'product' so all 39+ existing rows keep
--     working without any data migration.
--   * The cross-field CHECK guarantees that rows with kind='product'
--     have NULL duration/modality/pricing_unit, and rows with
--     kind='service' have all three populated. Existing rows satisfy
--     the product branch automatically.
--   * Vendor.category CHECK is widened to 11 values. Existing 6 stay
--     valid; the 5 new ones (clases/bienestar/belleza/hogar/eventos)
--     are accepted from this migration forward.
--
-- After applying: regenerate schema.full.sql for CI:
--   pg_dump ... | tail -n +11 | head -n -1 > schema.full.sql
-- (see migration 023 for the same instruction).

BEGIN;

-- 1. Discriminator on products.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'product'
  CHECK (kind IN ('product', 'service'));

-- 2. Service-only fields. NULL for product rows (enforced by CHECK below).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 600);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS modality VARCHAR(16)
  CHECK (modality IS NULL OR modality IN ('on_site', 'travels', 'remote'));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pricing_unit VARCHAR(16)
  CHECK (pricing_unit IS NULL OR pricing_unit IN ('unit', 'hour', 'session', 'class'));

-- 3. Cross-field consistency: product rows have no service fields;
-- service rows have all three. Single constraint, single source of truth.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_kind_fields_consistent'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_kind_fields_consistent CHECK (
        (kind = 'product'
          AND duration_minutes IS NULL
          AND modality IS NULL
          AND pricing_unit IS NULL)
        OR
        (kind = 'service'
          AND duration_minutes IS NOT NULL
          AND modality IS NOT NULL
          AND pricing_unit IS NOT NULL)
      );
  END IF;
END $$;

-- 4. Extend vendor category CHECK to add 5 service categories.
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_category_check;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_category_check CHECK (
    category IS NOT NULL AND category IN (
      -- existing product categories
      'frutas','comida','bebidas','artesanias','ropa','otros',
      -- new service categories
      'clases','bienestar','belleza','hogar','eventos'
    )
  );

-- 5. Partial index for the "newest active services" buyer query.
--    Mirrors products_is_active_true_idx (mig 023), scoped to kind.
CREATE INDEX IF NOT EXISTS products_kind_service_idx
  ON products (created_at DESC)
  WHERE is_active = true AND kind = 'service';

-- 6. Comments for future readers / ORM reflection.
COMMENT ON COLUMN products.kind IS
  'Migration 102: discriminator. ''product'' = physical good; ''service'' = session/class with duration + modality + pricing_unit.';
COMMENT ON COLUMN products.duration_minutes IS
  'Migration 102: service-only. 5..600 minutes. NULL when kind=''product''.';
COMMENT ON COLUMN products.modality IS
  'Migration 102: service-only. on_site (client visits provider), travels (provider visits client — e.g. peluquería a domicilio), remote (online). NULL when kind=''product''.';
COMMENT ON COLUMN products.pricing_unit IS
  'Migration 102: service-only. unit|hour|session|class — a label, not a multiplier. NULL when kind=''product''.';

-- 7. Pre-flight: assert no product rows were given service fields.
--    Should always pass given the DEFAULT 'product' and no backfill.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM products
   WHERE kind = 'product'
     AND (duration_minutes IS NOT NULL
          OR modality IS NOT NULL
          OR pricing_unit IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'pre-flight: % product rows carry service fields', bad;
  END IF;
END $$;

COMMIT;
