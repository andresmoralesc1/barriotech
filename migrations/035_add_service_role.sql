-- Migration 035: Add 'service' role + profiles.wants_map.
--
-- Third account type: service providers. Default is "the service comes to
-- you" (a domicilio / online), so no map visibility is created at signup.
-- If the user opts in via the signup checkbox ("Tengo un local/estudio
-- físico"), a vendors row is created in the same transaction and
-- profiles.wants_map is set to true.
--
-- The role is still immutable post-registration (trigger from migration
-- 020). To change a role, disable the trigger, UPDATE, re-enable.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['buyer'::text, 'seller'::text, 'service'::text, 'admin'::text]));

COMMENT ON COLUMN users.role IS
  '''buyer'' = compra. ''seller'' = vende productos físicos. ''service'' = ofrece servicios (a domicilio por defecto; con local si marcó wants_map). ''admin'' = super-admin (no self-register).';

-- profiles.role mirrors users.role; widen its check if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role = ANY (ARRAY['buyer'::text, 'seller'::text, 'service'::text, 'admin'::text]));
  END IF;
END $$;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wants_map BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.wants_map IS
  'Migration 035: signup-time decision for role=''service''. true = user opted to appear on /map (vendors row created at register). false = no map presence. Read by /onboarding to decide if seller/service onboarding slider should run.';

COMMIT;
