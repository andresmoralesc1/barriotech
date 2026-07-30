-- Tier 21: extend rate_limit_attempts with user_id + identifier columns so we
-- can throttle by authenticated user OR by pre-auth identifier (email/phone
-- hash) instead of relying solely on IP. Pure NAT/corporate-network users
-- behind a shared public IP no longer share each other's rate-limit counters.

ALTER TABLE rate_limit_attempts
  ADD COLUMN IF NOT EXISTS user_id    UUID    NULL  REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS identifier TEXT    NULL;

-- ip must be nullable so user/identifier-keyed rows can leave it empty.
-- Pre-existing IP-only rows are unchanged (their ip value is still there).
ALTER TABLE rate_limit_attempts
  ALTER COLUMN ip DROP NOT NULL;

-- Partial indexes — only ever queried when the corresponding column is non-null,
-- so the index stays small and the predicate cuts scan cost dramatically.
CREATE INDEX IF NOT EXISTS idx_rate_limit_user_bucket_time
  ON rate_limit_attempts (user_id, bucket, attempted_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier_bucket_time
  ON rate_limit_attempts (identifier, bucket, attempted_at DESC)
  WHERE identifier IS NOT NULL;

-- CHECK constraint: every row is keyed by exactly one of (ip, user_id, identifier).
-- Existing IP-only rows satisfy it; new user-keyed rows satisfy it; new
-- identifier-keyed rows satisfy it. Mixed rows are rejected — there must
-- be a single, unambiguous throttle key.
ALTER TABLE rate_limit_attempts
  DROP CONSTRAINT IF EXISTS rate_limit_attempts_keyed_by_one;

ALTER TABLE rate_limit_attempts
  ADD CONSTRAINT rate_limit_attempts_keyed_by_one CHECK (
    (CASE WHEN ip         IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN user_id    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN identifier IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- The legacy login route abuses the `ip` column to store lowercased email
-- addresses (bucket = 'login_account'). Backfill those into the new
-- identifier column with a stable hash so future queries target only the
-- new key. We DO NOT deduplicate — old ip-keyed rows remain but become
-- inert for identifier-keyed queries. After backfill the count(*)
-- on identifier = X is the fresh 15-minute window, while the legacy
-- ip-keyed row is just discarded.
UPDATE rate_limit_attempts
   SET identifier = encode(digest(lower(ip), 'sha256'), 'hex'),
       ip = NULL
 WHERE bucket = 'login_account'
   AND ip IS NOT NULL
   AND ip LIKE '%_@_%';

-- helper extension is not available by default; create it if missing.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
