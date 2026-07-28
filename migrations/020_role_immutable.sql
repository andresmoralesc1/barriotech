-- 020 — Role immutability.
--
-- Why:
--   The audit at /apps/web/app/api/auth/me/route.ts:48-52 documented that
--   'role' is intentionally NOT updatable through PATCH /api/auth/me.
--   This is enforced at the application layer, but a future admin endpoint
--   or direct SQL access could bypass it. A database-level guard makes
--   the rule unforgeable.
--
-- Behavior:
--   - If a row's NEW.role equals the OLD.role, the UPDATE proceeds normally.
--   - If a row's NEW.role differs from the OLD.role, the UPDATE raises
--     an exception (sqlstate P0001) with code 'role_immutable'. The route
--     that runs the UPDATE must catch and surface a 409 Conflict.
--
-- Why a trigger and not a CHECK constraint:
--   CHECK constraints can't reference OLD vs NEW. Triggers are the only
--   mechanism that can compare the row before and after the UPDATE.
--
-- Why we use a partial UPDATE (NEW = OLD) → RAISE EXCEPTION, not BEFORE
-- UPDATE → RETURN NULL:
--   Returning NULL silently aborts the UPDATE without telling the caller
--   why. A RAISE EXCEPTION propagates as a Postgres error 22023 (or
--   P0001 for trigger-raised) which the API can detect and surface.
--
-- How to "promote" a buyer to a seller if the business model ever allows it:
--   - Disable the trigger: ALTER TABLE users DISABLE TRIGGER users_role_immutable;
--   - UPDATE users SET role = 'seller' WHERE id = ...;
--   - Re-enable: ALTER TABLE users ENABLE TRIGGER users_role_immutable;
--
-- Tested locally: an UPDATE that changes role raises
--   ERROR:  role is immutable after registration (sqlstate P0001)
-- and the API surfaces it as 500. After this migration, route handlers
-- should catch code P0001 and return 409 instead.

CREATE OR REPLACE FUNCTION users_role_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role is immutable after registration'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_role_immutable ON users;
CREATE TRIGGER users_role_immutable
  BEFORE UPDATE OF role
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_role_immutable_guard();

COMMENT ON TRIGGER users_role_immutable ON users IS
  'Prevents silent privilege escalation by blocking any UPDATE that changes role. The current role is fixed at /api/auth/register. To change a role, disable the trigger, run the UPDATE, and re-enable it.';
