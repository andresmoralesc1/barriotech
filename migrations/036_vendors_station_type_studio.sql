-- Migration 036: Add 'studio' to vendors.station_type CHECK constraint.
--
-- Task 3 (2026-08-12) introduces the service-account signup with map
-- visibility. When a service user opts in via wantsMap=true, register
-- creates a vendors row with station_type='studio' to distinguish
-- "fixed local/studio" services from "mobile/fixed" street-vendor
-- categories already supported.
--
-- WHY THIS MIGRATION
-- The original CHECK from migration 008 allows only 'fixed' and 'mobile'.
-- Task 1 (migration 035) widened the user.role enum to include 'service'
-- but did not extend the station_type enum — a real gap. Without this
-- migration, the register endpoint for service+wantsMap hits
-- 23514 (check_violation) and the entire signup transaction rolls back.
--
-- 'studio' = a service provider with a physical local/studio that is
-- pinned to a fixed lat/lng (the city center at signup; the owner can
-- drag to a precise address via the dashboard). Distinct from 'fixed'
-- (street-vendor / parking-lot cart) and 'mobile' (walking/moving vendor)
-- because services are categorized and filtered separately on the
-- /servicios page — using 'fixed' would lump barbershops in with
-- hot-dog carts and break the filter.

BEGIN;

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_station_type_check;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_station_type_check
  CHECK (station_type IS NULL OR station_type IN ('fixed'::text, 'mobile'::text, 'studio'::text));

COMMENT ON COLUMN vendors.station_type IS
  '''fixed'' = street vendor in the same spot (parking-lot cart, fruit stand). ''mobile'' = moves around the city. ''studio'' = service provider with a physical local (barber, salon, classes). NULL allowed but discouraged.';

COMMIT;
