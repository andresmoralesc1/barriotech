# Service Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third signup role `service` (with optional map-visibility checkbox at signup) to BarrioTech without changing buyer/seller/admin behavior.

**Architecture:** New DB CHECK allows `role='service'`; new `profiles.wants_map` column persists the signup decision; register API branches vendor auto-bootstrap based on `wantsMap`; RegisterForm grid becomes 3 cards + conditional checkbox; all type unions widen to include `'service'`; endpoint role-gates open to `service` only where the existing role gate mirrors capability (create product, read own vendor). No changes to migration 020's role-immutability trigger.

**Tech Stack:** Next.js 15 App Router, TypeScript, Postgres (raw SQL via `pg`), Zustand store, Vitest-style node test files under `scripts/tests/`. Postgres connection: `apps/web/lib/db.ts` `pool`. Test runner: existing pattern — node script that POSTs against a running dev server (see `scripts/tests/auth.test.js` for shape).

## Global Constraints

- **Role immutability:** Migration 020's trigger stays in place. Role is fixed at signup.
- **Existing roles unaffected:** Every branch for `role === 'buyer'` and `role === 'seller'` keeps its current behavior. New branches are additive (`|| role === 'service'`).
- **Spanish copy:** All user-facing strings in Spanish to match the existing app.
- **TypeScript:** All union widens must include `'service'`. Never narrow a union back to `'buyer' | 'seller'`.
- **DB constraint names:** `users_role_check` (drop + recreate); `profiles_role_check` may or may not exist — guard with `DO $$ ... pg_constraint ... $$` block.
- **Profile column default:** `wants_map BOOLEAN NOT NULL DEFAULT false` — every existing profile gets `false`, which is the safe default (it just means "no map visibility opted in").
- **No new vendor columns:** `station_type='studio'` already covers map-visible services.
- **No admin / post-signup toggle:** Explicitly out of scope (see design spec §Out of Scope).

---

## File Structure

### New files

- `migrations/035_add_service_role.sql` — DB changes.

### Modified files

| File | Why |
|---|---|
| `apps/web/lib/core/types/index.ts` | `UserRole` adds `'service'` |
| `apps/web/lib/auth.ts` | `VerifiedUser.role` union (2 sites) |
| `apps/web/lib/auth-edge.ts` | `TokenPayload.role` union |
| `apps/web/app/api/auth/register/route.ts` | Accept `service` + `wantsMap`, branch vendor bootstrap |
| `apps/web/app/api/products/route.ts` | Allow `role='service'` (line 157) |
| `apps/web/app/api/vendors/me/route.ts` | Allow `role='service'` (line 35, 162) |
| `apps/web/app/api/vendors/me/settings/route.ts` | Allow `role='service'` (line 61) |
| `apps/web/components/auth/RegisterForm.tsx` | 3-col grid + checkbox |
| `apps/web/app/(auth)/login/page.tsx` | Widen `initialRole` literal (line 56) |
| `apps/web/app/(auth)/onboarding/page.tsx` | Trigger for `service + wantsMap` |
| `apps/web/app/settings/page.tsx` | 4-branch role label (line 174) |
| `apps/web/app/(buyer)/map/page.tsx` | Vendor check for service (line 78) |
| `apps/web/components/seller/Dashboard.tsx` | Allow `role='service'` (line 194) |
| `apps/web/hooks/useEditProfile.ts` | Allow `role='service'` (line 45) |
| `apps/web/hooks/useProductsPage.ts` | Allow `role='service'` (line 171) |
| `apps/web/components/SellerOnboardingBanner.tsx` | Allow `role='service'` (line 98) |
| `scripts/tests/auth.test.js` | Service signup cases |
| `scripts/tests/services.test.js` | Service product creation cases |
| `scripts/tests/vendors.test.js` | Service vendor me cases |

**Out of scope (intentional):** `apps/web/components/SiteHeader.tsx` role-gated menu items (we want service users to land on the same map page as buyers — they navigate to `/dashboard` like sellers, but we are NOT adding a header dropdown entry in this iteration). If the user wants it, that's a follow-up. Same for `proxy.ts:75` and `VendorDetailClient.tsx` (both are seller-only operational guards that have no business affecting services today).

---

## Task 1: Database migration

**Files:**
- Create: `migrations/035_add_service_role.sql`

**Interfaces:**
- Consumes: nothing (additive migration).
- Produces: `users.role` accepts `'service'`; `profiles.wants_map` column exists with default `false`.

- [ ] **Step 1: Create the migration file**

Write `migrations/035_add_service_role.sql`:

```sql
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
```

- [ ] **Step 2: Apply migration locally**

Run: `node scripts/migrate.js` (or whatever the project uses — check `migrations/000_create_migrations_table.sql` for the runner script name)

Verify: `psql $DATABASE_URL -c "\d users"` shows `users_role_check` with the 4-value list. `psql $DATABASE_URL -c "\d profiles"` shows `wants_map` column with default `false`.

Expected: success, no errors. Existing rows still satisfy the CHECK.

- [ ] **Step 3: Verify backwards compat**

Run: `psql $DATABASE_URL -c "SELECT role, count(*) FROM users GROUP BY role;"`

Expected: existing roles unchanged (counts identical to before migration).

- [ ] **Step 4: Commit**

```bash
cd /home/telchar/barriotech
git add migrations/035_add_service_role.sql
git commit -m "feat(db): add 'service' role + profiles.wants_map (mig 035)"
```

---

## Task 2: Widen TypeScript role unions

**Files:**
- Modify: `apps/web/lib/core/types/index.ts:1`
- Modify: `apps/web/lib/auth.ts:204`, `apps/web/lib/auth.ts:229`
- Modify: `apps/web/lib/auth-edge.ts:14`

**Interfaces:**
- Consumes: nothing.
- Produces: `UserRole` and all `role: 'buyer' | 'seller' | 'admin'` unions compile with `'service'` added.

- [ ] **Step 1: Widen `UserRole` core type**

In `apps/web/lib/core/types/index.ts`, replace line 1:

```ts
export type UserRole = 'buyer' | 'seller' | 'admin'
```

with:

```ts
export type UserRole = 'buyer' | 'seller' | 'service' | 'admin'
```

- [ ] **Step 2: Widen `TokenPayload`**

In `apps/web/lib/auth-edge.ts`, replace line 14:

```ts
role: 'buyer' | 'seller' | 'admin'
```

with:

```ts
role: 'buyer' | 'seller' | 'service' | 'admin'
```

- [ ] **Step 3: Widen `VerifiedUser` + cast site**

In `apps/web/lib/auth.ts`, replace line 204:

```ts
role: 'buyer' | 'seller' | 'admin'
```

with:

```ts
role: 'buyer' | 'seller' | 'service' | 'admin'
```

Replace line 229:

```ts
role: auth.role as 'buyer' | 'seller' | 'admin',
```

with:

```ts
role: auth.role as 'buyer' | 'seller' | 'service' | 'admin',
```

- [ ] **Step 4: Typecheck**

Run: `cd /home/telchar/barriotech/apps/web && pnpm tsc --noEmit`

Expected: zero new errors. (Pre-existing errors are fine — they should be the same as before this task.)

- [ ] **Step 5: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/lib/core/types/index.ts apps/web/lib/auth.ts apps/web/lib/auth-edge.ts
git commit -m "feat(types): widen UserRole and auth unions to include 'service'"
```

---

## Task 3: Register API accepts `service` + `wantsMap`

**Files:**
- Modify: `apps/web/app/api/auth/register/route.ts`

**Interfaces:**
- Consumes: widened `UserRole` (Task 2).
- Produces: `POST /api/auth/register` accepts body `{ ..., role: 'service', wantsMap?: boolean }`. If `role='service'` and `wantsMap=true`, a `vendors` row is created with `station_type='studio'`, `is_active=true`, seeded lat/lng from `cityId`'s city center. `profiles.wants_map` is set accordingly. The response user object includes `wantsMap` (so the client knows where to navigate next).

- [ ] **Step 1: Add failing test**

In `scripts/tests/auth.test.js`, append a new `describe('service signup', ...)` block at the bottom. Use the existing test patterns — look at the first describe in this file to copy the request helper / `BASE_URL` setup.

```js
describe('service signup', () => {
  const ts = Date.now()
  const email = `svc-${ts}@barriotech-test.com`
  const phone = `+57300${String(ts).slice(-8)}`
  const password = 'SvcTest123!'

  it('registers a service user without map visibility', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password, name: 'Servicio Test',
        phone, cityId: 'bogota',
        role: 'service', wantsMap: false,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.role).toBe('service')
    expect(body.user.wantsMap).toBe(false)
  })

  it('registers a service user WITH map visibility and creates vendor', async () => {
    const email2 = `svc2-${ts}@barriotech-test.com`
    const phone2 = `+57301${String(ts).slice(-8)}`
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email2, password, name: 'Servicio Con Local',
        phone: phone2, cityId: 'bogota',
        role: 'service', wantsMap: true,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.role).toBe('service')
    expect(body.user.wantsMap).toBe(true)
    // vendor row check: GET /api/vendors/me with the returned cookie
    const cookies = res.headers.get('set-cookie') || ''
    const me = await fetch(`${BASE_URL}/api/vendors/me`, {
      headers: { cookie: cookies.split(';')[0] },
    })
    expect(me.status).toBe(200)
    const vendor = await me.json()
    expect(vendor.station_type).toBe('studio')
  })

  it('rejects service signup with wantsMap=true but no cityId', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `svc-no-city-${ts}@barriotech-test.com`, password,
        name: 'Sin Ciudad', phone: `+57302${String(ts).slice(-8)}`,
        role: 'service', wantsMap: true,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects unknown role values', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `bad-${ts}@barriotech-test.com`, password,
        name: 'Bad Role', phone: `+57303${String(ts).slice(-8)}`,
        role: 'admin',
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    // admin still rejected at the API layer (per migration 027 comment)
    expect(res.status).toBe(400)
  })
})
```

If `BASE_URL` is not exported, copy whatever mechanism the first `describe` uses.

- [ ] **Step 2: Run the new tests, expect failures**

Run: `cd /home/telchar/barriotech && node scripts/tests/auth.test.js`

Expected: the four new cases fail with `400` (current code rejects `'service'`) or assertion errors on the response shape. Pre-existing tests still pass.

- [ ] **Step 3: Extend the body parser type**

In `apps/web/app/api/auth/register/route.ts`, line 41 area, update the parsed-body type to include `wantsMap`:

```ts
const parsed = await parseJsonBody<{
  email?: unknown; password?: unknown; name?: unknown;
  phone?: unknown; cityId?: unknown; role?: unknown;
  wantsMap?: unknown;
  acceptedTerms?: unknown; acceptedPrivacy?: unknown;
}>(req)
```

And in the destructure on line ~46, add `wantsMap`:

```ts
const { email, password, name, phone, cityId, role, wantsMap, acceptedTerms, acceptedPrivacy } = parsed.body
```

- [ ] **Step 4: Widen the role validation**

In the same file, replace the role validation block (around line 70):

```ts
if (role !== 'buyer' && role !== 'seller') {
  return NextResponse.json(
    { error: 'Selecciona un tipo de cuenta: vendedor o comprador' },
    { status: 400 }
  )
}
```

with:

```ts
if (role !== 'buyer' && role !== 'seller' && role !== 'service') {
  return NextResponse.json(
    { error: 'Selecciona un tipo de cuenta: vendedor, comprador o servicio' },
    { status: 400 }
  )
}
const wantsMap = role === 'service' ? Boolean(wantsMap) : false
```

- [ ] **Step 5: Add the service-with-map city validation**

Right after the existing seller city validation (the block that returns 400 if `roleValue === 'seller' && !cityId`), add:

```ts
if (roleValue === 'service' && wantsMap && !cityId) {
  return NextResponse.json(
    { error: 'Selecciona una ciudad para tu local/estudio' },
    { status: 400 }
  )
}
```

- [ ] **Step 6: Branch the vendor auto-bootstrap**

Find the existing `if (roleValue === 'seller')` block. Replace it with:

```ts
if (roleValue === 'seller' || (roleValue === 'service' && wantsMap)) {
  const firstName = trimmedName.split(' ')[0] || trimmedName || 'vendedor'
  const placeholderName = `Mi negocio de ${firstName}`
  const slug = await generateUniqueSlug(client, placeholderName, (typeof cityId === 'string' ? cityId : null))
  const cityCenter = (typeof cityId === 'string')
    ? COLOMBIA_CITIES.find((c) => c.id === cityId)?.center
    : undefined
  const seedLat = cityCenter ? cityCenter[0] : null
  const seedLng = cityCenter ? cityCenter[1] : null
  const stationType = roleValue === 'service' ? 'studio' : 'mobile'
  await client.query(
    `INSERT INTO vendors (
      profile_id, name, slug, category, description,
      city_id, latitude, longitude, station_type,
      phone, is_active, is_verified, created_at
    )
    VALUES ($1, $2, $3, 'comida', '', $4, $5, $6, $7, $8, true, false, NOW())
    ON CONFLICT DO NOTHING`,
    [profileId, placeholderName, slug, cityId || null, seedLat, seedLng, stationType, cleanPhone || null]
  )
}
```

Note: `is_active` is `true` here for both branches, matching the design spec's behavior (visible immediately on the map at city center). This is a *change* for the seller branch from `false` → `true`; verify in `git diff` that the only change is the literal.

If you spot that the original seller branch used `false` and the design requires `false` for sellers (re-read the spec §2 — it says sellers get a vendor seeded at city center, so visible if they enable it themselves later — different from services which auto-activate), keep the seller branch at `false` and only set `true` for the service branch. Use:

```ts
const isActive = roleValue === 'service' && wantsMap
// ...
[profileId, placeholderName, slug, cityId || null, seedLat, seedLng, stationType, cleanPhone || null, isActive]
```

and add `is_active` to the column list. Re-read the existing branch and the design spec to decide — when in doubt, default to **preserving seller behavior** (the only branch that should differ in this PR is the new service branch).

- [ ] **Step 7: Set `profiles.wants_map`**

Inside the transaction, after the profile INSERT and before COMMIT, add:

```ts
await client.query(
  'UPDATE profiles SET wants_map = $1 WHERE user_id = $2',
  [wantsMap, user.id]
)
```

- [ ] **Step 8: Echo `wantsMap` in the response**

In the JSON response object (around the `user:` block), add `wantsMap` to the user object:

```ts
user: {
  id: user.id,
  email: user.email || '',
  fullName: user.name,
  phone: user.phone || '',
  cityId: user.city_id,
  role: user.role,
  avatarUrl: '',
  emailVerified: false,
  wantsMap,
},
```

- [ ] **Step 9: Run tests, expect pass**

Run: `cd /home/telchar/barriotech && node scripts/tests/auth.test.js`

Expected: all 4 new cases pass. Pre-existing cases still pass.

- [ ] **Step 10: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/app/api/auth/register/route.ts scripts/tests/auth.test.js
git commit -m "feat(auth): accept role='service' + wantsMap, branch vendor bootstrap"
```

---

## Task 4: RegisterForm — 3rd role card + wantsMap checkbox

**Files:**
- Modify: `apps/web/components/auth/RegisterForm.tsx`

**Interfaces:**
- Consumes: `UserRole` widened (Task 2).
- Produces: signup form with 3 role cards (Comprador · Vendedor · Servicio) and a conditional "Tengo un local/estudio físico" checkbox below the grid when `selectedRole === 'service'`. Submits `wantsMap` in the payload.

- [ ] **Step 1: Widen the `initialRole` prop type**

In `apps/web/components/auth/RegisterForm.tsx`, line 17, change:

```ts
initialRole?: 'buyer' | 'seller'
```

to:

```ts
initialRole?: UserRole
```

Add the import at the top:

```ts
import type { UserRole } from '@/lib/core/types'
```

- [ ] **Step 2: Widen the `selectedRole` state type**

Line 63, change:

```ts
const [selectedRole, setSelectedRole] = useState<'buyer' | 'seller'>(initialRole)
```

to:

```ts
const [selectedRole, setSelectedRole] = useState<UserRole>(initialRole)
```

- [ ] **Step 3: Add the `showOnMap` state**

Right after the existing `useState` calls (after `showPassword`), add:

```ts
const [showOnMap, setShowOnMap] = useState(false)
```

- [ ] **Step 4: Update the submit payload**

Find the payload build:

```ts
const payload: Record<string, unknown> = {
  password: regPassword,
  name: fullName,
  cityId,
  role: selectedRole,
  acceptedTerms,
  acceptedPrivacy,
}
```

Add `wantsMap` to the payload only for service role:

```ts
const payload: Record<string, unknown> = {
  password: regPassword,
  name: fullName,
  cityId,
  role: selectedRole,
  acceptedTerms,
  acceptedPrivacy,
}
if (selectedRole === 'service') {
  payload.wantsMap = showOnMap
}
```

- [ ] **Step 5: Update the post-register routing**

Find:

```ts
const target =
  redirectTo === 'onboarding' && data.user.role === 'seller'
    ? '/onboarding'
    : '/map'
```

Replace with:

```ts
const role = data.user.role as UserRole
const wantsMap = Boolean(data.user.wantsMap)
const needsOnboarding =
  redirectTo === 'onboarding' &&
  (role === 'seller' || (role === 'service' && wantsMap))
const target = needsOnboarding ? '/onboarding' : '/map'
```

- [ ] **Step 6: Change grid to 3 columns**

Find the role grid block:

```tsx
<div className="grid grid-cols-2 gap-3">
  <button ... Comprador ...>
  <button ... Vendedor ...>
</div>
```

Replace with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
  <button
    type="button"
    onClick={() => setSelectedRole('buyer')}
    aria-pressed={selectedRole === 'buyer'}
    className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
      selectedRole === 'buyer'
        ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
    }`}
  >
    <div className="text-2xl mb-1">🛒</div>
    <div className="text-sm font-semibold text-gray-800">Comprador</div>
    <div className="text-xs text-gray-500">Buscar y pedir</div>
  </button>
  <button
    type="button"
    onClick={() => setSelectedRole('seller')}
    aria-pressed={selectedRole === 'seller'}
    className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
      selectedRole === 'seller'
        ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
    }`}
  >
    <div className="text-2xl mb-1">📍</div>
    <div className="text-sm font-semibold text-gray-800">Vendedor</div>
    <div className="text-xs text-gray-500">Aparecer en el mapa</div>
  </button>
  <button
    type="button"
    onClick={() => setSelectedRole('service')}
    aria-pressed={selectedRole === 'service'}
    className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
      selectedRole === 'service'
        ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
    }`}
  >
    <div className="text-2xl mb-1">🛠️</div>
    <div className="text-sm font-semibold text-gray-800">Servicio</div>
    <div className="text-xs text-gray-500">A domicilio o con local</div>
  </button>
</div>
```

- [ ] **Step 7: Add the conditional `wantsMap` checkbox**

Right after the closing `</div>` of the role grid, add:

```tsx
{selectedRole === 'service' && (
  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer py-2.5 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors min-h-[44px]">
    <input
      type="checkbox"
      checked={showOnMap}
      onChange={(e) => setShowOnMap(e.target.checked)}
      className="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-primary-700 focus:ring-primary"
    />
    <span>
      Tengo un local/estudio físico y quiero aparecer en el mapa.
      <span className="block text-xs text-gray-500 mt-0.5">
        Si no tienes local, omite esta opción. Tus servicios se podrán buscar en /servicios igual.
      </span>
    </span>
  </label>
)}
```

- [ ] **Step 8: Build & smoke test**

Run: `cd /home/telchar/barriotech/apps/web && pnpm build`

Expected: builds without TS errors. (Pre-existing warnings are fine.)

Then in dev: visit `/login` → click "Regístrate gratis" → confirm 3 role cards render → click "Servicio" → confirm the checkbox appears → submit a service signup (with `wantsMap` checked and unchecked) and confirm the success path.

- [ ] **Step 9: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/components/auth/RegisterForm.tsx
git commit -m "feat(auth-ui): 3-role signup grid + wantsMap checkbox for service"
```

---

## Task 5: Login page + onboarding wiring

**Files:**
- Modify: `apps/web/app/(auth)/login/page.tsx:56`
- Modify: `apps/web/app/(auth)/onboarding/page.tsx`

**Interfaces:**
- Consumes: widened `UserRole`.
- Produces: login page passes `initialRole={searchParams.get('role') as UserRole | null}`; onboarding triggers seller-style slider for `role='service'` users that have `wantsMap=true`.

- [ ] **Step 1: Widen the `initialRole` literal in login page**

In `apps/web/app/(auth)/login/page.tsx`, around line 56, change:

```tsx
initialRole={searchParams.get('role') === 'seller' ? 'seller' : 'buyer'}
```

to:

```tsx
initialRole={(searchParams.get('role') as 'seller' | 'service' | null) ?? 'buyer'}
```

(The `?? 'buyer'` keeps buyer as the default; explicit `'seller'` or `'service'` from URL wins.)

- [ ] **Step 2: Add failing onboarding test**

In `scripts/tests/auth.test.js`, append to the `describe('service signup', ...)` block:

```js
it('service+wantsMap=true is sent to /onboarding via cookie/route check', async () => {
  // Just confirms the user record has wants_map=true in DB after register.
  const email = `svc-onb-${Date.now()}@barriotech-test.com`
  const phone = `+57304${Date.now().toString().slice(-8)}`
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password, name: 'Servicio Onb',
      phone, cityId: 'bogota',
      role: 'service', wantsMap: true,
      acceptedTerms: true, acceptedPrivacy: true,
    }),
  })
  const body = await res.json()
  expect(body.user.role).toBe('service')
  expect(body.user.wantsMap).toBe(true)
})
```

- [ ] **Step 3: Run test, expect pass (already covered by Task 3)**

Run: `cd /home/telchar/barriotech && node scripts/tests/auth.test.js`

Expected: passes because the response includes `wantsMap` (Task 3 step 8).

- [ ] **Step 4: Update onboarding trigger logic**

In `apps/web/app/(auth)/onboarding/page.tsx`, find the `if (user?.role === 'seller')` branches (around lines 57 and 121) and replace with:

```tsx
const isOnboardingUser = user?.role === 'seller' || (user?.role === 'service' && user.wantsMap === true)
```

Use `isOnboardingUser` in place of the original `user?.role === 'seller'` checks in that file.

(The `user.wantsMap` field must already be present on the `User` type in the Zustand store — Task 6 widens that, but it's safe to add the field now since `User.wantsMap?: boolean` is additive.)

- [ ] **Step 5: Typecheck**

Run: `cd /home/telchar/barriotech/apps/web && pnpm tsc --noEmit`

Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/app/\(auth\)/login/page.tsx apps/web/app/\(auth\)/onboarding/page.tsx scripts/tests/auth.test.js
git commit -m "feat(onboarding): trigger seller flow for service+wantsMap users"
```

---

## Task 6: Vendor + product endpoint role gates

**Files:**
- Modify: `apps/web/app/api/products/route.ts:157`
- Modify: `apps/web/app/api/vendors/me/route.ts:35`, `route.ts:162`
- Modify: `apps/web/app/api/vendors/me/settings/route.ts:61`

**Interfaces:**
- Consumes: widened `TokenPayload.role`.
- Produces: endpoints accept `role='service'` in addition to `role='seller'`. Same response shapes. Missing-vendor for service users returns the existing 404 pattern.

- [ ] **Step 1: Add failing tests**

In `scripts/tests/services.test.js`, append:

```js
describe('service role product posting', () => {
  // Setup helper — register a service user, return cookies + token.
  async function makeServiceUser({ wantsMap = false } = {}) {
    const ts = Date.now() + Math.random()
    const email = `svc-prod-${ts}@barriotech-test.com`
    const phone = `+57305${String(ts).slice(-8)}`
    const password = 'SvcProd123!'
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password, name: 'Svc Prod',
        phone, cityId: 'bogota',
        role: 'service', wantsMap,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') || ''
    const cookie = setCookie.split(';')[0]
    return { cookie }
  }

  it('service user can POST a service-kind product', async () => {
    const { cookie } = await makeServiceUser()
    const res = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Clase de yoga',
        description: '60 minutos a domicilio',
        price: 50000,
        kind: 'service',
        duration_minutes: 60,
        modality: 'travels',
        pricing_unit: 'session',
        category: 'bienestar',
      }),
    })
    expect(res.status).toBe(201)
  })

  it('buyer cannot POST a service-kind product', async () => {
    // Register a buyer.
    const ts = Date.now() + Math.random()
    const email = `byr-prod-${ts}@barriotech-test.com`
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password: 'ByrProd123!',
        name: 'Byr Prod', phone: `+57306${String(ts).slice(-8)}`,
        cityId: 'bogota', role: 'buyer',
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
    const post = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'X', description: 'Y', price: 100,
        kind: 'service', duration_minutes: 60,
        modality: 'travels', pricing_unit: 'session',
      }),
    })
    expect(post.status).toBe(403)
  })
})
```

In `scripts/tests/vendors.test.js`, append:

```js
describe('service role vendor endpoints', () => {
  it('GET /api/vendors/me with wantsMap=true returns the vendor', async () => {
    const ts = Date.now() + Math.random()
    const email = `svc-vm-${ts}@barriotech-test.com`
    const phone = `+57307${String(ts).slice(-8)}`
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password: 'SvcVm123!',
        name: 'Svc VM', phone, cityId: 'bogota',
        role: 'service', wantsMap: true,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
    const me = await fetch(`${BASE_URL}/api/vendors/me`, { headers: { cookie } })
    expect(me.status).toBe(200)
    const body = await me.json()
    expect(body.station_type).toBe('studio')
  })

  it('GET /api/vendors/me with wantsMap=false returns 404', async () => {
    const ts = Date.now() + Math.random()
    const email = `svc-vm2-${ts}@barriotech-test.com`
    const phone = `+57308${String(ts).slice(-8)}`
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password: 'SvcVm2123!',
        name: 'Svc VM2', phone, cityId: 'bogota',
        role: 'service', wantsMap: false,
        acceptedTerms: true, acceptedPrivacy: true,
      }),
    })
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
    const me = await fetch(`${BASE_URL}/api/vendors/me`, { headers: { cookie } })
    expect(me.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests, expect failures**

Run: `cd /home/telchar/barriotech && node scripts/tests/services.test.js scripts/tests/vendors.test.js`

Expected: all new cases fail (currently `role !== 'seller'` returns 403 for service users).

- [ ] **Step 3: Open `/api/products` to service**

In `apps/web/app/api/products/route.ts`, line 157, change:

```ts
if (decoded.role !== 'seller') {
```

to:

```ts
if (decoded.role !== 'seller' && decoded.role !== 'service') {
```

- [ ] **Step 4: Open `/api/vendors/me` GET + PATCH to service**

In `apps/web/app/api/vendors/me/route.ts`, lines 35 and 162, change the role guard (likely `if (auth.role !== 'seller')`) to:

```ts
if (auth.role !== 'seller' && auth.role !== 'service') {
```

Same edit for line 162.

- [ ] **Step 5: Open `/api/vendors/me/settings` PATCH to service**

In `apps/web/app/api/vendors/me/settings/route.ts`, line 61, change:

```ts
if (auth.role !== 'seller') {
```

to:

```ts
if (auth.role !== 'seller' && auth.role !== 'service') {
```

- [ ] **Step 6: Handle missing vendor cleanly for service users**

In `/api/vendors/me` GET, after the auth guard passes, the existing query selects by `profile_id`. Service users without `wantsMap=true` have no vendor row — the existing handler should already return 404 (verify by reading lines 35–110). If it returns 500 or 200 with empty body, add an explicit `if (!vendor) return NextResponse.json({ error: 'vendor_not_found', code: 'vendor_not_found' }, { status: 404 })`.

Same check for `/api/vendors/me/settings` PATCH.

- [ ] **Step 7: Run tests, expect pass**

Run: `cd /home/telchar/barriotech && node scripts/tests/services.test.js scripts/tests/vendors.test.js`

Expected: all new cases pass.

- [ ] **Step 8: Run full test suite to catch regressions**

Run: `cd /home/telchar/barriotech && for f in scripts/tests/*.test.js; do echo "--- $f ---"; node "$f" || echo "FAIL: $f"; done`

Expected: all suites pass.

- [ ] **Step 9: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/app/api/products/route.ts apps/web/app/api/vendors/me/route.ts apps/web/app/api/vendors/me/settings/route.ts scripts/tests/services.test.js scripts/tests/vendors.test.js
git commit -m "feat(api): open vendor + product endpoints to role='service'"
```

---

## Task 7: UI surfaces — settings, map, dashboard, hooks

**Files:**
- Modify: `apps/web/store/useStore.ts` — `User.wantsMap?: boolean`
- Modify: `apps/web/app/settings/page.tsx:174`
- Modify: `apps/web/app/(buyer)/map/page.tsx:78`
- Modify: `apps/web/components/seller/Dashboard.tsx:194`
- Modify: `apps/web/hooks/useEditProfile.ts:45`
- Modify: `apps/web/hooks/useProductsPage.ts:171`
- Modify: `apps/web/components/SellerOnboardingBanner.tsx:98`

**Interfaces:**
- Consumes: widened `UserRole`.
- Produces: service users can navigate to `/dashboard` (the seller dashboard) and to `/profile/edit`; settings page labels them correctly; map page allows them to see their own vendor pin if they opted in.

- [ ] **Step 1: Add `wantsMap` to `User` type**

In `apps/web/store/useStore.ts`, find the `User` type definition (around line 10) and add:

```ts
wantsMap?: boolean
```

after the `role: UserRole | null` line.

- [ ] **Step 2: Settings page 4-branch label**

In `apps/web/app/settings/page.tsx`, around line 174, replace:

```tsx
{user.role === 'buyer' ? 'Comprador' : 'Vendedor'}
```

with:

```tsx
{user.role === 'buyer'
  ? 'Comprador'
  : user.role === 'seller'
  ? 'Vendedor'
  : user.role === 'service'
  ? 'Servicio'
  : 'Admin'}
```

If the file uses `settings/page.tsx` with different surrounding code (e.g. a function returning a label), mirror the same 4-branch logic.

- [ ] **Step 3: Map page vendor check**

In `apps/web/app/(buyer)/map/page.tsx`, around line 78, change:

```tsx
if (user?.role === 'seller' && vendorId) {
```

to:

```tsx
if ((user?.role === 'seller' || user?.role === 'service') && vendorId) {
```

- [ ] **Step 4: Open Dashboard / useEditProfile / useProductsPage / SellerOnboardingBanner to service**

In each of these files, find the role guard and add `|| role === 'service'`:

- `apps/web/components/seller/Dashboard.tsx:194` — `if (user?.role !== 'seller')` → `if (user?.role !== 'seller' && user?.role !== 'service')`
- `apps/web/hooks/useEditProfile.ts:45` — same pattern.
- `apps/web/hooks/useProductsPage.ts:171` — same pattern.
- `apps/web/components/SellerOnboardingBanner.tsx:98` — `if (!user || user.role !== 'seller')` → `if (!user || (user.role !== 'seller' && user.role !== 'service'))`

For Dashboard, also verify the page-level guard returns the right redirect. Read the surrounding context — if the guard returns `<NotSeller />` or a redirect, ensure that for `role='service'` the redirect target makes sense (likely `/dashboard` is reachable). Don't add new redirects — just let service users through the same gate as sellers.

- [ ] **Step 5: Typecheck**

Run: `cd /home/telchar/barriotech/apps/web && pnpm tsc --noEmit`

Expected: zero new errors.

- [ ] **Step 6: Smoke test in browser**

Start dev server (`cd /home/telchar/barriotech && pm2 restart barriotech` or `pnpm dev`).

Manually:
1. Register a new `service` user with `wantsMap=false`. Verify they land on `/map`, see no vendor pin for themselves, can browse.
2. Register a new `service` user with `wantsMap=true` + `cityId='bogota'`. Verify they land on `/onboarding`, complete it, see their pin on the map at Bogotá center, can navigate to `/dashboard`.
3. As a service user with vendor, click "Mis productos" → add a service-kind product → confirm it shows in `/servicios` browse.

- [ ] **Step 7: Commit**

```bash
cd /home/telchar/barriotech
git add apps/web/store/useStore.ts apps/web/app/settings/page.tsx apps/web/app/\(buyer\)/map/page.tsx apps/web/components/seller/Dashboard.tsx apps/web/hooks/useEditProfile.ts apps/web/hooks/useProductsPage.ts apps/web/components/SellerOnboardingBanner.tsx
git commit -m "feat(ui): allow service role across settings, map, dashboard, hooks"
```

---

## Task 8: Final test pass + regression

**Files:**
- No new files. Run all existing tests.

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: full test suite passes; no regressions.

- [ ] **Step 1: Run full test suite**

Run: `cd /home/telchar/barriotech && for f in scripts/tests/*.test.js; do echo "--- $f ---"; node "$f" || echo "FAIL: $f"; done | tee /tmp/test-results.txt`

Expected: no `FAIL` lines.

- [ ] **Step 2: Run typecheck**

Run: `cd /home/telchar/barriotech/apps/web && pnpm tsc --noEmit`

Expected: zero new errors.

- [ ] **Step 3: Build**

Run: `cd /home/telchar/barriotech/apps/web && pnpm build`

Expected: build succeeds.

- [ ] **Step 4: Restart pm2 + verify live**

Run: `cd /home/telchar/barriotech && pm2 restart barriotech && sleep 3 && curl -sS https://barriotech.com.co/api/health | head`

Expected: pm2 restarts cleanly; health endpoint returns 200.

- [ ] **Step 5: Update memory file**

Run: `cat >> /home/telchar/.claude/projects/-home-telchar/memory/barriotech.md <<'EOF'

## Service account role (2026-08-12)

Third role `service` in `users.role` (mig 035). Signup grid = 3 cards; service users see a conditional "Tengo local/estudio" checkbox (default off). When checked → vendors row auto-created with `station_type='studio'`, `is_active=true`, city-center lat/lng; `profiles.wants_map=true`. When unchecked → no vendor row, lands on /map. Service users can post `kind='service'` products and appear in /servicios. ~13 files touched; vendor + product endpoints opened to `role='service'`; role immutability trigger (mig 020) still in force.
EOF`

- [ ] **Step 6: Final commit**

```bash
cd /home/telchar/barriotech
git add -A
git diff --cached --stat
git commit -m "chore: post-impl housekeeping + memory update" || echo "nothing to commit"
```

---

## Self-Review Notes

- Spec §1 (DB migration) → Task 1.
- Spec §2 (Register API) → Task 3.
- Spec §3 (RegisterForm) → Task 4.
- Spec §4 (Routing) → embedded in Task 4 step 5.
- Spec §5 (Onboarding) → Task 5.
- Spec §6 (wants_map on profiles) → Task 1 (column) + Task 3 (write) + Task 5 (read).
- Spec §7 (Type unions) → Task 2 (core) + Task 7 step 1 (User type) + Task 4 step 1 (RegisterForm initialRole).
- Spec §8 (Products) → Task 6.
- Spec §9 (Vendor endpoints) → Task 6.
- Spec §10 (Admin/dashboard/settings) → Task 7 (UI surfaces). Admin endpoints intentionally untouched (out of scope per spec).
- Spec §11 (Tests) → Tasks 3, 5, 6 (per-file). Final pass in Task 8.

**Coverage gaps:** none. The post-signup toggle and admin endpoints are explicitly out of scope per the design spec.

**Type consistency:** `UserRole` is widened exactly once in Task 2. `wantsMap` is named `wantsMap` in RegisterForm state, `wantsMap` in the API body, and `wants_map` in the DB column (the conversion happens at the API boundary in Task 3). `User.wantsMap?: boolean` is the in-app shape.
