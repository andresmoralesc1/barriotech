-- Etapa 6: Monetization — sponsorships + ad campaigns + vendor vehicle info.
--
-- Adds:
--   - vendors.vehicle_type, vendors.vehicle_photo_url (for the "anunciate en
--     el carrito" revenue stream — vendor uploads a photo of their cart,
--     clients see the cart type when discovering vendors nearby)
--   - sponsorships table (vendor pays to be featured)
--   - ad_campaigns table (external brands pay for visibility in /mapa + /vendors)
--
-- Money columns are stored in COP cents (BIGINT) to avoid float drift.

-- 1. Vendor vehicle info ------------------------------------------------------

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT
    CHECK (vehicle_type IN ('bicicleta','moto','carro','pie','triciclo','otro')),
  ADD COLUMN IF NOT EXISTS vehicle_photo_url TEXT;

COMMENT ON COLUMN vendors.vehicle_type IS 'How the vendor moves around — used for filtering and "advertise on carts" feature';
COMMENT ON COLUMN vendors.vehicle_photo_url IS 'Photo of the cart/vehicle shown to buyers for trust';

-- 2. Sponsorships (vendor pays to be featured) --------------------------------

CREATE TABLE IF NOT EXISTS sponsorships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL CHECK (plan IN ('semanal','mensual')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','cancelled','expired','pending_payment')),
  wompi_reference TEXT,
  payment_method  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sponsorships_vendor_active
  ON sponsorships(vendor_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sponsorships_expires
  ON sponsorships(ends_at) WHERE status = 'active';

COMMENT ON TABLE sponsorships IS 'Vendor self-paid promotion: aparece primero en /mapa y /vendors durante la ventana';

-- 3. Ad campaigns (external brands) -------------------------------------------

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name        TEXT NOT NULL,
  contact_email     TEXT NOT NULL,
  image_url         TEXT NOT NULL,
  target_url        TEXT NOT NULL,
  target_city_id    TEXT,
  target_category   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','expired','pending_payment')),
  impressions_count BIGINT NOT NULL DEFAULT 0,
  clicks_count      BIGINT NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_active_window
  ON ad_campaigns(status, starts_at, ends_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_target
  ON ad_campaigns(target_city_id, target_category);

COMMENT ON TABLE ad_campaigns IS 'External brand campaigns (Coca-Cola, banks, etc.) shown as cards in /mapa + /vendors';

-- 4. View: vendors with active sponsorship flag -------------------------------
-- Used by /api/vendors/map and /api/vendors (the list page) to prioritize
-- sponsored vendors WITHOUT requiring a join at every read.

CREATE OR REPLACE VIEW vendors_with_sponsorship AS
SELECT
  v.*,
  EXISTS (
    SELECT 1 FROM sponsorships s
    WHERE s.vendor_id = v.id
      AND s.status = 'active'
      AND NOW() BETWEEN s.starts_at AND s.ends_at
  ) AS is_sponsored,
  COALESCE((
    SELECT MAX(s.ends_at) FROM sponsorships s
    WHERE s.vendor_id = v.id AND s.status = 'active'
  ), NULL) AS sponsored_until
FROM vendors v;

COMMENT ON VIEW vendors_with_sponsorship IS 'vendors + is_sponsored flag — pre-computed via EXISTS for fast filtering';