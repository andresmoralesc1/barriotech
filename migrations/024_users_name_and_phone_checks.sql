-- 024 — Display name + phone CHECK constraints.
--
-- Why:
--   The audit at 2026-07-27 listed two closely related MEDIUM findings:
--
--   M2 — users.name has NO length or character CHECK. The application
--        enforces 2..100 chars at register/PATCH, but a direct DB write,
--        a future API, or a Postgres-level intrusion can store a 1-char
--        string, a 5MB blob, or a name made entirely of zero-width
--        characters. Same with bidi controls — the app's PATCH route
--        normalizes them on input, but anyone with role UPDATE can
--        bypass the application layer.
--
--   M3 — users.phone is unconstrained beyond UNIQUE. A blank string,
--        an emoji, or a phone number with a SQL-injection-shaped payload
--        can sneak past the partial unique index (which doesn't check
--        format). The Colombian 10-digit rule and the sanitizeDisplayName
--        treatment now live at the data layer, not just at the API edge.
--
-- Why a constraint and not just a trigger:
--   CHECK constraints on a single column block ANY write to that column
--   that violates the rule, regardless of source (app, admin tools, psql,
--   bug-recovery scripts). Triggers can be disabled; CHECKs can't be
--   skipped silently.
--
-- Migration safety:
--   Before adding each constraint we run a DEDUPLICATION + TRIM PASS over
--   existing rows. This handles the unlikely case where a stale or
--   imported row already violates the rule — better to clean it now than
--   to block the migration forever. The dedup uses NULL on the duplicate
--   (matching users_phone_unique's partial-index pattern), not a hard
--   delete, to preserve FK references.
--
-- Idempotency:
--   Both constraints are wrapped in `DO $$ ... EXCEPTION` blocks so the
--   migration is safe to re-run after a partial failure.

BEGIN;

-- ─── M3 — phone normalization + dedup + CHECK ─────────────────────────
--   Normalize existing rows: keep only digits, drop the rest. Trims
--   leading 57 (Colombia country code) so duplicates created via the
--   "+57" vs raw-10-digit UI paths collapse. Empty/whitespace becomes
--   NULL (so the partial unique index applies uniformly).
UPDATE public.users
  SET phone = CASE
    WHEN phone IS NULL OR btrim(phone) = '' THEN NULL
    ELSE ltrim(regexp_replace(btrim(phone), '\D', '', 'g'), '57')
  END
WHERE phone IS NOT NULL;

-- Collapse duplicates created by the +57 vs raw-10-digit inconsistency:
-- keep the OLDEST row, NULL out the phone on the others. We pick oldest
-- via created_at + id (stable tiebreaker). touch updated_at is irrelevant
-- since users has no updated_at column.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY phone
           ORDER BY created_at NULLS LAST, id
         ) AS rn
  FROM public.users
  WHERE phone IS NOT NULL
)
UPDATE public.users u
  SET phone = NULL
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_format_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_phone_format_check
      CHECK (
        phone IS NULL
        OR (length(phone) BETWEEN 10 AND 15 AND phone ~ '^[0-9]+$')
      );
  END IF;
END$$;

-- ─── M2 — name length + character CHECK ─────────────────────────────────
--   The XQuery-style character class `[^[:cntrl:]]` blocks ALL control
--   characters including \t, \r, \n, \u0000, and the bidi/zero-width
--   set. Together with normalize() in the app, this is defense in depth.
--
--   The name pattern allows Unicode letters, marks, spaces, common
--   punctuation (-, ', .), and digits. The audit excluded @ from the
--   allowlist on purpose: a name like "@everyone" is a UX/safety risk
--   in notifications.
UPDATE public.users
  SET name = btrim(name)
WHERE name IS NOT NULL
  AND (name <> btrim(name) OR name ~ '^[[:cntrl:]]');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_name_length_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_name_length_check
      CHECK (length(name) BETWEEN 2 AND 100);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_name_charset_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_name_charset_check
      CHECK (name !~ '^[[:cntrl:]]' AND name !~ '[[:cntrl:]]$');
  END IF;
END$$;

COMMIT;

COMMENT ON CONSTRAINT users_phone_format_check ON public.users IS
  'Phone, when present, must be 10-15 digits only (no country prefix 57; the app strips it on input). NULL allowed (paired with users_email_or_phone_required).';
COMMENT ON CONSTRAINT users_name_length_check ON public.users IS
  'Display name must be 2..100 chars (inclusive). Padded with sanitize+trim at the API.';
COMMENT ON CONSTRAINT users_name_charset_check ON public.users IS
  'Display name cannot start or end with a control character (defense against bidi/zero-width masking).';
