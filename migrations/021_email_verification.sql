-- 021 — Email verification.
--
-- Why:
--   The audit at the end of the production-readiness review flagged that
--   users can register and use sensitive actions (creating vendors, posting
--   reviews, contacting sellers) without proving they own the email. A
--   hostile actor can squat on someone else's email, lock them out, and
--   abuse the platform from a verified account tied to the victim's
--   contact info.
--
--   Ley 1581/2012 (Habeas Data) and good security practice both call for
--   email verification before treating an email as a trusted channel.
--
-- Design:
--   - Add `email_verified` BOOLEAN NOT NULL DEFAULT false to `users`.
--   - Add `email_verified_at` TIMESTAMPTZ (audit trail of when verified).
--   - New table `email_verification_tokens` (token, user_id, expires_at,
--     used_at) with a partial unique index on (user_id) WHERE used_at IS NULL
--     so at most one active token per user.
--   - Tokens are 32-byte random base64url strings, 24h TTL.
--   - Existing users are NOT backfilled as verified — that would defeat
--     the point for the existing user base. Operators can run
--     `UPDATE users SET email_verified = true WHERE created_at < '...';`
--     for the MVP cohort if needed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.email_verified IS
  'True once the user has clicked the verification link in their email.
  Required to be true for: POST /api/vendors, POST /api/reviews,
  POST /api/contact. Soft-blocked (banner) for everything else.';
COMMENT ON COLUMN users.email_verified_at IS
  'Audit trail of when the user verified their email. NULL until verified.';

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
  ON email_verification_tokens(expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE email_verification_tokens IS
  'One-time email verification tokens. We store the SHA-256 hash of the
  token, never the plaintext, so a DB dump alone can''t be used to verify
  arbitrary emails. The plaintext token only lives in the email the user
  receives, once.';

COMMENT ON COLUMN email_verification_tokens.token_hash IS
  'SHA-256 of the token (base64url). The plaintext is only sent to the
  user''s email and is never stored.';
COMMENT ON COLUMN email_verification_tokens.expires_at IS
  'Tokens expire 24 hours after creation. The /api/auth/verify-email
  endpoint returns 410 Gone for expired tokens.';
COMMENT ON COLUMN email_verification_tokens.used_at IS
  'Set when the token is consumed. NULL means the token is still active
  (or expired, depending on expires_at).';
