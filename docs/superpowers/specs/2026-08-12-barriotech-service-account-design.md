# Service accounts in BarrioTech — Design Spec

**Date:** 2026-08-12
**Author:** brainstorm (user + Claude)
**Status:** Draft — pending user approval

---

## Problem

The signup form today offers two account types — **Comprador** (buyer) and **Vendedor**
(seller). The user wants a third option: **Servicio** (service provider). Service
providers default to "the service comes to you" (a domicilio / online), so they should
not be forced to appear on the map. If a service provider has a physical studio (e.g.
a tattoo shop), map visibility should be opt-in via a checkbox at signup time.

The product schema (`products.kind='service'`, migration 102) and the 5 service
categories (migration 103 — clases, bienestar, belleza, hogar, eventos) already exist.
The blocker is that they all hang off `vendors`, and creating a `vendors` row today
requires `role='seller'`.

## Decision

Add a third top-level role `service` to `users.role`, exposed as a third card in the
signup grid. Map visibility is an opt-in checkbox at signup. If checked, the
registration flow auto-creates a `vendors` row with `station_type='studio'`,
`is_active=true`, and seeds `latitude`/`longitude` from the chosen city center
(mirroring the existing seller auto-bootstrap). If unchecked, no `vendors` row is
created and the user does not appear on `/map`.

A service user who opted out at signup can publish `products` with `kind='service'`
(the seller → service catalog is symmetric: both roles can post products and
services), and their offerings appear in `/servicios` browse regardless of map
visibility — map visibility is a separate axis from catalog visibility.

## Out of scope (deferred to future iterations)

- **Post-signup map-visibility toggle.** If a service user opted out at signup, they
  cannot enable map visibility later without re-registering. YAGNI — the user asked
  for the decision at signup, and adding a toggle later is a 30-min change once the
  need appears.
- **Admin list of services.** Admin can list services via direct SQL
  (`SELECT * FROM users WHERE role='service'`) — no admin UI change yet.
- **Dedicated `/dashboard-servicios` route.** Service users without map visibility go
  to `/map` after signup (same as buyer). They access their catalog via the same
  `/dashboard` entry point as sellers; copy differentiates the role.

## Design

### 1. Database

**New migration** `migrations/035_add_service_role.sql`:

```sql
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['buyer'::text, 'seller'::text, 'service'::text, 'admin'::text]));

-- Mirror on profiles (inserted with role from users at register time).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'profiles_role_check' AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role = ANY (ARRAY['buyer'::text, 'seller'::text, 'service'::text, 'admin'::text]));
  END IF;
END $$;

COMMENT ON COLUMN users.role IS
  '''buyer'' = compra. ''seller'' = vende productos físicos en la calle/local. '
  '''service'' = ofrece servicios (a domicilio/remoto por defecto; con local si '
  'marcó el checkbox de signup). ''admin'' = super-admin (no self-register).';

COMMIT;
```

**No changes** to `users_role_immutable` trigger (migration 020) — role stays
immutable post-registration, preserving the "decision at signup" guarantee.

**No new column** in `vendors`. The service-specific bits live in the existing
fields: `station_type='studio'` for opt-in map visibility, `kind='service'` on
`products` for service offerings (already there).

### 2. Register API

**File:** `apps/web/app/api/auth/register/route.ts`

- Body type accepts `role: 'buyer' | 'seller' | 'service'` and new optional
  `wantsMap?: boolean` (default `false`).
- Validation:
  - `if (!['buyer','seller','service'].includes(role as string))` → 400.
  - If `role === 'service' && wantsMap === true`, `cityId` is required (needed to
    seed the studio's lat/lng). Returns 400 if missing.
  - If `role === 'service' && wantsMap === false`, `cityId` is optional.
- Auto-bootstrap of `vendors` row:
  - `role === 'seller'` → existing branch (always creates vendor, seeds city
    center, `station_type='mobile'`).
  - `role === 'service' && wantsMap === true` → new branch, mirrors seller
    bootstrap with `station_type='studio'` and seeds city center for the pin.
  - `role === 'service' && wantsMap === false` → **no** vendor row. Buyer-like.
  - `role === 'buyer'` → unchanged.
- Token payload's `role` field uses the broader union; this is a widening so no
  other token-validation code needs a code change beyond the type unions (see §6).
- `signTokenSync({ userId, email, role: roleValue as ..., tokenVersion: 1 }, '15m')`
  — cast is safe because the DB CHECK already validated the role.

### 3. Register frontend

**File:** `apps/web/components/auth/RegisterForm.tsx`

- `Props.initialRole?: 'buyer' | 'seller' | 'service'` (widened).
- Internal state: `selectedRole` widens to `'buyer' | 'seller' | 'service'`.
- New state: `showOnMap: boolean` (default `false`).
- Role grid: `grid-cols-2` → `grid-cols-3` (or `grid-cols-1 sm:grid-cols-3` to
  avoid mobile cramping).
  - Card 1: 🛒 **Comprador** — "Buscar y pedir".
  - Card 2: 📍 **Vendedor** — "Aparecer en el mapa".
  - Card 3: 🛠️ **Servicio** — "Ofrecer servicios" (sub: "A domicilio o con local").
- Below the grid, **conditional block** (only renders when `selectedRole === 'service'`):
  - Checkbox styled like the existing Terms/Privacy checkboxes:
    - Label: "Tengo un local/estudio físico y quiero aparecer en el mapa".
    - Sub-copy (smaller, gray-500): "Si no tienes local, omite esta opción. Tus
      servicios se podrán buscar en /servicios igual."
- Submit payload:
  ```ts
  const payload = {
    ...existing,
    role: selectedRole,
    wantsMap: selectedRole === 'service' ? showOnMap : undefined,
  }
  ```
  Server tolerates `wantsMap` being `undefined` for buyer/seller.

### 4. Routing post-register

`RegisterForm.tsx` already has the routing table at the bottom of `handleSubmit`:

| `selectedRole` | `redirectTo='map'` | `redirectTo='onboarding'` |
|---|---|---|
| `buyer` | `/map` | `/map` |
| `seller` | `/map` | `/onboarding` |
| `service` + `wantsMap=true` | `/map` | `/onboarding` |
| `service` + `wantsMap=false` | `/map` | `/map` |

The only caller today is `(auth)/login/page.tsx` with `redirectTo="map"`. That
means today service+wantsMap=true also lands on `/map` (no onboarding flow). The
login page is the simple toggle-on-the-auth-card flow; the dedicated onboarding
flow only fires from the `/onboarding` route's redirect logic — see §5.

### 5. Onboarding

**File:** `apps/web/app/(auth)/onboarding/page.tsx`

- Today: `if (user?.role === 'seller')` triggers the seller onboarding slider.
- New: `if (user?.role === 'seller' || (user?.role === 'service' && user.wantsMap === true))`
  triggers the same flow (sellers and map-visible services share the photo +
  location slides).
- `service + wantsMap=false` skips onboarding entirely (already at `/map`).

The `wantsMap` flag needs to be readable from the user object. Decision: store it
on `profiles` as a nullable boolean column added in migration 035 — see §6.

### 6. Storing `wantsMap` — needed by onboarding decision

The onboarding page can only decide correctly if it knows `wantsMap`. Two options:

**Option A (chosen):** Add `wants_map BOOLEAN` to `profiles` table.
- Populated at register time by the API.
- Read by onboarding page.
- Updateable later via PATCH `/api/profile` if we ever build the post-signup toggle.

**Option B:** Encode it into `vendors.station_type` (`studio` = on map, absence = off map).
- No schema change.
- But: `wantsMap=false` means **no** vendor row exists at all. So the onboarding
  page can only check this via `EXISTS (SELECT 1 FROM vendors WHERE profile_id = ...)`,
  which couples onboarding to the vendors table.

Option A is cleaner: explicit, in `profiles`, and survives if we later add the
post-signup toggle.

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wants_map BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.wants_map IS
  'Migration 035: signup-time decision for role=''service''. true = user opted to appear on /map (vendor row created at register). false = no map presence. Read by /onboarding to decide if seller/service onboarding slider should run.';
```

API behavior:
- `wantsMap === true` AND `role === 'service'` → set `profiles.wants_map = true`,
  create vendor row, send to onboarding.
- `wantsMap === false` OR `role !== 'service'` → `profiles.wants_map = false`,
  no vendor row.

### 7. Type unions across the codebase

Every TypeScript union `role: 'buyer' | 'seller'` widens to `... | 'service'`.
Known sites from exploration:

- `apps/web/lib/auth-edge.ts:14` — `TokenPayload.role`
- `apps/web/lib/auth.ts:204` — `VerifiedUser.role`
- `apps/web/store/useStore.ts` — `User.role`
- `apps/web/components/auth/RegisterForm.tsx` — `initialRole`, `selectedRole`
- `apps/web/app/(auth)/login/page.tsx:56` — `initialRole` prop pass-through

A `grep -rn "role === 'seller'\|role !== 'seller'\|role === 'buyer'\|role !== 'buyer'"` pass during implementation will surface any remaining sites. Most are
informational (`if (role === 'seller') show seller dashboard`) and need a new
`|| role === 'service'` branch where the feature surfaces; the rest just widen.

### 8. Product posting

**File:** `apps/web/app/api/products/route.ts:157`

Today: `if (decoded.role !== 'seller')` rejects.

New: `if (decoded.role !== 'seller' && decoded.role !== 'service')` rejects.
Both roles can post `kind='product'` or `kind='service'`. No change to the
schema or to the existing test suite for sellers.

### 9. Vendor profile endpoints

**Files:**
- `apps/web/app/api/vendors/me/route.ts` (GET + PATCH)
- `apps/web/app/api/vendors/me/settings/route.ts` (PATCH)

Today: rejects if `role !== 'seller'`.

New: rejects if `role !== 'seller' && role !== 'service'`. A service user without
a vendor row (wantsMap=false) gets a `404 vendor_not_found` from GET, and the
PATCH endpoint is unreachable for them (frontend hides the menu). No "create
vendor on demand" endpoint is added in this iteration — YAGNI.

### 10. Admin / dashboard / settings

- `apps/web/app/api/admin/clients/route.ts:59` filters `role='buyer'` — no change.
  Services are not "clients" in the admin sense.
- `apps/web/app/admin/*` — no listing of services added (see Out of Scope).
- `apps/web/app/settings/page.tsx:174` — ternary expands:
  - `role === 'buyer'` → "Comprador"
  - `role === 'seller'` → "Vendedor"
  - `role === 'service'` → "Servicio"
  - `role === 'admin'` → "Admin"
- `apps/web/app/(buyer)/map/page.tsx:78` — `if (user?.role === 'seller' && vendorId)`
  → `if ((user?.role === 'seller' || user?.role === 'service') && vendorId)`.
  Allows service users with vendor rows to see the same map UI as sellers.
- Sidebar/dashboard items for "Mis productos" etc. show when
  `role === 'seller' || role === 'service'`. Copy differentiates: "Mis productos"
  for seller, "Mis servicios" for service.

### 11. Tests

Three test files get new cases (kept minimal, mirroring existing style):

- **`scripts/tests/auth.test.js`** — POST `/api/auth/register` with:
  - `role: 'service', wantsMap: false` → 200, user.role='service', no vendor row.
  - `role: 'service', wantsMap: true, cityId: 'bogota'` → 200, user.role='service',
    vendor row with station_type='studio' and latitude/longitude near city center.
  - PATCH `/api/auth/me` with `role: 'seller'` for an existing service user →
    409 (trigger migration 020 enforces immutability).

- **`scripts/tests/services.test.js`** — POST `/api/products` with
  `kind: 'service'` as a service user → 201. Same as buyer → 403.

- **`scripts/tests/vendors.test.js`** — GET `/api/vendors/me` with role='service'
  and an existing vendor row → 200 with the vendor payload. Without a vendor row →
  404 with `code: 'vendor_not_found'`.

## Files changed (summary)

| Layer | Path | Change |
|---|---|---|
| DB | `migrations/035_add_service_role.sql` | NEW — extend CHECK + add `profiles.wants_map` |
| API | `apps/web/app/api/auth/register/route.ts` | Accept `'service'`, branch vendor creation, set `wants_map` |
| API | `apps/web/app/api/products/route.ts` | Allow `role='service'` |
| API | `apps/web/app/api/vendors/me/route.ts` | Allow `role='service'` |
| API | `apps/web/app/api/vendors/me/settings/route.ts` | Allow `role='service'` |
| Types | `apps/web/lib/auth.ts`, `auth-edge.ts`, `store/useStore.ts` | Widen `role` union |
| Front | `apps/web/components/auth/RegisterForm.tsx` | 3-col grid, conditional checkbox, payload field |
| Front | `apps/web/app/(auth)/login/page.tsx` | Pass widened `initialRole` |
| Front | `apps/web/app/(auth)/onboarding/page.tsx` | Branch on `role='service' && wantsMap` |
| Front | `apps/web/app/settings/page.tsx` | 4-branch role label |
| Front | `apps/web/app/(buyer)/map/page.tsx:78` | Allow service users with vendor |
| Front | `apps/web/components/seller/*` (sidebar) | Show for `role in ['seller','service']` |
| Tests | `scripts/tests/auth.test.js`, `services.test.js`, `vendors.test.js` | New cases |

**Total: 1 new migration, ~13 modified files. All changes mechanical.**

## Migration plan (deployment)

1. Apply `035_add_service_role.sql` — additive only (extends CHECK, adds
   `profiles.wants_map` with default `false`). Backwards compatible: existing
   buyer/seller/admin rows satisfy the new CHECK; the new column has a default.
2. Deploy app changes.
3. No data backfill needed — existing users keep their roles.

## Verification (pre-completion)

- [ ] Migration applies cleanly on a fresh DB clone.
- [ ] Existing seller signup still works end-to-end (regression).
- [ ] New `service` signup with `wantsMap=false` lands on `/map`, no vendor row.
- [ ] New `service` signup with `wantsMap=true` lands on `/onboarding`, vendor row
      with `station_type='studio'`, lat/lng from city center.
- [ ] `/api/vendors/me` for a service user with vendor returns the vendor.
- [ ] `/api/vendors/me` for a service user without vendor returns 404.
- [ ] `/api/products` accepts `kind='service'` from service users.
- [ ] Token payload's `role` field reflects `'service'` correctly.
- [ ] Role immutability: PATCH `/api/auth/me` with new role → 409.
- [ ] All three updated test files pass.
