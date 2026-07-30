-- Tier 21 follow-up: tier 19's CHECK constraint was a no-op because ip
-- was NOT NULL. Make ip nullable, then re-add the constraint so it
-- actually enforces "exactly one of (ip, user_id, identifier)".

ALTER TABLE rate_limit_attempts
  ALTER COLUMN ip DROP NOT NULL;

ALTER TABLE rate_limit_attempts
  DROP CONSTRAINT IF EXISTS rate_limit_attempts_keyed_by_one;

ALTER TABLE rate_limit_attempts
  ADD CONSTRAINT rate_limit_attempts_keyed_by_one CHECK (
    (CASE WHEN ip         IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN user_id    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN identifier IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Migrate legacy login_account rows that stored the email in the ip
-- column. pgcrypto is needed for digest(); create it if missing.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE rate_limit_attempts
   SET identifier = encode(digest(lower(ip), 'sha256'), 'hex'),
       ip         = NULL
 WHERE bucket = 'login_account'
   AND ip IS NOT NULL
   AND ip LIKE '%_@_%';

-- These should now be zero — sanity check in case we forgot any rows.
DO $$
DECLARE
  leftover INTEGER;
BEGIN
  SELECT COUNT(*) INTO leftover
    FROM rate_limit_attempts
   WHERE bucket = 'login_account' AND ip IS NOT NULL AND ip LIKE '%_@_%';
  IF leftover > 0 THEN
    RAISE NOTICE 'migration 101: % leftover legacy login_account rows with email-shaped ip', leftover;
  END IF;
END $$;
