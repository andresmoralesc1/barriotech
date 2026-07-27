-- 026 — last_login_at column on users.
--
-- Why:
--   L6 (audit 2026-07-27): login() never wrote back the moment a user
--   authenticated. The audit trail was "user registered" + "user
--   deleted" with no in-between breadcrumbs. Useful for:
--     - SIEM: detect a user who suddenly logs in from a new country
--       after 6 months dormant (impossible travel).
--     - Ops: confirm last_active_at for /dashboard freshness checks.
--     - Security: forensic timeline when an account is compromised.
--
-- Schema:
--   last_login_at  timestamptz  nullable, defaults to NULL.
--   No DEFAULT now() — we explicitly want NULL until the first login
--   so we can tell brand-new users from dormant-but-returned ones
--   (the latter is the security signal).
--
-- Migration safety:
--   - The column is non-nullable=NO. Existing rows get NULL (which is
--     "we don't know when they last logged in" — accurate).
--   - No backfill. We can't recover historical logins from logs.
--
-- Future hook:
--   We could ALSO add last_login_ip on the same column family, but
--   the audit didn't ask for it and consent_logs.ip_address already
--   records the registration IP, which is the higher-value signal.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.users.last_login_at IS
  'Last successful POST /api/auth/login for this user. NULL until the first login after this migration. Updated on every successful login (L6 audit 2026-07-27). Pairs with login_failure audit logs in pino JSON for forensic timeline correlation.';

COMMIT;
