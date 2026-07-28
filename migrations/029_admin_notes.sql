-- 029_admin_notes.sql
--
-- Admin notes per user (client or vendor). Free-text annotations
-- admins leave on a user record so the next operator picking up the
-- account has context. Distinct from admin_audit_log: that table is
-- a tamper-evident action history (one row per admin-initiated
-- action), this table is the human-written *narrative* on top of it.
--
-- PROBLEM
-- When an admin triages a flagged buyer or a vendor with a complaint,
-- the next admin to touch the record has to start from zero. We
-- currently have audit_log ("account was deactivated at 2pm by
-- andres@...") but no place to write "deactivated pending chargeback
-- resolution, customer is Maria Lopez, call before reactivating".
-- Operators resort to external chat logs, which don't survive role
-- changes or vacation.
--
-- DESIGN
-- One row per note, immutable except for the soft-delete columns.
--   - target_type  'user' | 'vendor' (we ship 'user' this tier; the
--     column is there so the vendor drawer can adopt the same
--     table later without a migration)
--   - target_id    UUID of the user or vendor
--   - author_id    admin who wrote the note
--   - body         the note itself, max 2000 chars (enforced at API
--     layer to keep the column predictable; PG has no CHECK on length
--     by default)
--   - deleted_at   NULL = visible, non-NULL = tombstone. We soft-delete
--     instead of hard so the audit trail stays complete ("this note
--     was removed at X by Y" is itself a fact worth keeping, but
--     today we don't surface that — easy to add a `deleted_by` column
--     later if we need it)
--
-- The author and target are FKs to users(id) so a future cleanup
-- script that removes admin users can't orphan notes. There's no
-- ON DELETE CASCADE — if an admin is removed their notes stay
-- (with a NULL author_id after the FK is nulled). We don't expect
-- to delete admins; if we do, we'll handle the data migration by
-- hand.
--
-- Indexes serve the two access patterns we care about:
--   1. "Show me all notes for this user, newest first" — list view
--      in the drawer
--   2. "What notes has this admin written lately?" — admin profile
--      or cross-reference (rare but cheap to support)

CREATE TABLE IF NOT EXISTS admin_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'vendor')),
  target_id   UUID NOT NULL,
  author_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- Notes for a specific target, newest first, soft-deleted hidden.
CREATE INDEX IF NOT EXISTS idx_admin_notes_target
  ON admin_notes (target_type, target_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Reverse lookup by author (admin profile / cross-references).
CREATE INDEX IF NOT EXISTS idx_admin_notes_author
  ON admin_notes (author_id, created_at DESC);
