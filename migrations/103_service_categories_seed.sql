-- Migration 103: seed service categories into the lookup table.
--
-- Background: migration 102 expanded `vendors.category_check` to accept
-- 11 values (6 product + 5 service), and updated `packages/core` /
-- `apps/web` CATEGORIES constants. The CATEGORIES constants drive the
-- filter chips in FilterBar.tsx + the buyer-side chip rendering.
--
-- What was missed: `POST /api/vendors` validates the category against
-- the `categories` lookup table:
--
--   SELECT id FROM categories WHERE id = $1
--
-- That table only had the 6 product categories seeded in schema.sql.
-- A seller trying to POST `category: "clases"` (or any of the new
-- service ids) was getting 400 "Categoría inválida" even though the
-- CHECK constraint accepted it. Net effect: no service vendor could
-- be created via the API, so the map filter chips rendered empty
-- results and the user reported "los servicios no aparecen en el mapa".
--
-- This migration seeds the missing 5 rows. Icons match the Lucide
-- icons used by the apps/web CategoryIconMap consumers (the TS file
-- stores the icon as a string emoji for backwards compat; the Lucide
-- icon is resolved client-side).
--
-- Idempotent: ON CONFLICT (id) DO NOTHING so re-running the migration
-- is safe. The CHECK constraint on vendors already accepts these
-- values (mig 102) — no constraint change here.

BEGIN;

INSERT INTO categories (id, label, icon) VALUES
  ('clases',     'Clases',     '🎓'),
  ('bienestar',  'Bienestar',  '💆'),
  ('belleza',    'Belleza',    '💇'),
  ('hogar',      'Hogar',      '🛠️'),
  ('eventos',    'Eventos',    '🎉')
ON CONFLICT (id) DO NOTHING;

COMMIT;
