-- 025 — Role immutability: drop `OF role` qualifier from the trigger.
--
-- Why:
--   Migration 020 created the guard with `BEFORE UPDATE OF role`. The
--   guard function (NEW.role IS DISTINCT FROM OLD.role) is correct, but
--   the `OF role` qualifier is a soft spot:
--
--     1. A row-level UPDATE that mentions role in the SET clause but
--        passes a value identical to OLD.role still fires the trigger
--        (the guard then allows it). That's the intended happy path.
--     2. A row-level UPDATE that does NOT mention role in the SET clause
--        at all — `UPDATE users SET name = 'x' WHERE id = ...` — does
--        NOT fire the trigger. NEW.role = OLD.role in that case, so
--        there's nothing to bypass today. But future edge cases
--        (DEFAULT, generated columns, MERGE statements) can insert
--        statements where role shifts without explicit SET.
--
--   Defense in depth: drop the `OF role` qualifier so the trigger
--   fires on EVERY row UPDATE. The guard function still compares
--   NEW vs OLD role, so legitimate UPDATEs (role unchanged) pass
--   through untouched. Only role-changing writes are blocked.
--
-- Risk profile: zero functional change for current callers. The
-- trigger fires more often (every UPDATE) but the only added cost
-- is a string comparison per row, which is negligible.

BEGIN;

-- Drop and recreate without the `OF role` qualifier.
DROP TRIGGER IF EXISTS users_role_immutable ON public.users;

CREATE TRIGGER users_role_immutable
  BEFORE UPDATE
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_role_immutable_guard();

COMMENT ON TRIGGER users_role_immutable ON public.users IS
  'Prevents silent privilege escalation by blocking any UPDATE that changes role (BEFORE UPDATE — fires on every UPDATE; the guard function compares NEW vs OLD, so legitimate role-unchanged writes are unaffected).';

COMMIT;
