-- Etapa 4: Consent logs for Ley 1581/2012 compliance.
-- Records every consent event: registration, policy version accepted,
-- IP, user agent, and type of consent (terms, privacy, marketing).
--
-- Required by art. 12 Ley 1581 — proof of consent must be available.
--
-- Run: psql ... -f migrations/006_add_consent_logs.sql
-- Or:  npm run migrate

CREATE TABLE IF NOT EXISTS consent_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  -- NULL user_id for pre-registration events (e.g. cookie banner for
  -- a logged-out visitor). We keep those for audit.
  email       varchar(255),  -- captured for pre-registration events
  consent_type varchar(50) NOT NULL,
  -- 'terms'      — accepted terms and conditions
  -- 'privacy'    — accepted the privacy/data-treatment policy
  -- 'cookies'    — accepted cookie banner (analytics, non-essential)
  -- 'marketing'  — opted into marketing emails (future)
  -- 'push'       — opted into web-push notifications
  policy_version varchar(20) NOT NULL,
  granted     boolean NOT NULL,
  ip_address  inet,
  user_agent  text,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- Look up all consents for a user (right of access / audit).
CREATE INDEX IF NOT EXISTS consent_logs_user_id_idx
  ON consent_logs (user_id, created_at DESC);

-- Look up consents by type + version (e.g. "who accepted v1.0 of policy?").
CREATE INDEX IF NOT EXISTS consent_logs_type_version_idx
  ON consent_logs (consent_type, policy_version);

-- Prevent duplicate inserts: one consent per (user, type, version).
-- Partial index because email-only pre-registration events have NULL user_id.
CREATE UNIQUE INDEX IF NOT EXISTS consent_logs_unique_user_type_version
  ON consent_logs (COALESCE(user_id::text, email), consent_type, policy_version)
  WHERE user_id IS NOT NULL;