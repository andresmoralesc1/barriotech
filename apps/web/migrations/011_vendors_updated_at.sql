-- Add updated_at to vendors.
--
-- The /api/account/export route SELECTs updated_at from vendors, but
-- the original DDL never created the column. Result: every account
-- export request returned 500 with "column updated_at does not exist".
--
-- Nullable on purpose. Existing rows stay NULL (we don't backfill
-- with created_at because the value is semantically distinct — when
-- did the row last change?). New rows will get values only when the
-- application explicitly sets them in an UPDATE statement; this
-- migration does not add an ON UPDATE trigger (we want a single
-- canonical place for that decision when we wire it up).

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
