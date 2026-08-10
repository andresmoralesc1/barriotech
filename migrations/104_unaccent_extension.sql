-- Migration 104: enable unaccent extension + use it in vendor search.
--
-- Phase G3 of the services rollout: today the buyer search
-- (`/api/vendors?q=...`) does a plain ILIKE on vendor.name +
-- description + product.name. That means typing "peluqueria"
-- misses vendors named "Peluquería a Domicilio Test" because
-- Postgres ILIKE is byte-compare, not accent-insensitive in the
-- default `C` collation.
--
-- `unaccent` is a Postgres contrib extension that strips diacritics.
-- It is bundled with the default Postgres install (no separate
-- package needed), just not enabled by default.
--
-- After enabling, the search query in `apps/web/app/api/vendors/
-- filters.ts` wraps both sides with `unaccent(...)` so a buyer
-- typing any of {peluqueria, Peluquería, PELUQUERIA} matches
-- a vendor with the same letters + accents.
--
-- Safety:
-- - `IF NOT EXISTS` so re-running is a no-op.
-- - Requires superuser or `CREATE EXTENSION` privilege on the
--   database. The migration runner uses the `DB_USER` from
--   apps/web/.env (default: postgres) which has CREATE
--   EXTENSION by default.

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

COMMIT;
