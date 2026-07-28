-- Migration 027: allow 'admin' role for super admin / field-agent manager.
--
-- The original users_role_check constraint only allowed 'buyer' and 'seller'.
-- This migration extends it to allow 'admin' so we can promote trusted users
-- (e.g. Andres) to a super-admin role that can view all vendors/clients,
-- override verifications, and deactivate vendors.
--
-- We DO NOT relax the immutability rules from migration 020 — admins can't
-- be created via self-registration. The register endpoint still rejects
-- role='admin' (validated at the API layer, not here). This is purely a
-- constraint update.
--
-- To create the first admin, run:
--   node scripts/dev/create-admin.js <email>

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['buyer'::text, 'seller'::text, 'admin'::text]));

-- Audit log for admin actions (view, activate, deactivate, verify override).
-- Kept separate from auth events so we can age out admin logs at a different
-- cadence (90 days default) than login/refresh events (30 days).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  metadata    JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin   ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON admin_audit_log (target_type, target_id, created_at DESC);
