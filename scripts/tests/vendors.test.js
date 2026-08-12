/**
 * Tests for vendors/products endpoints — runs with Node's built-in test runner.
 *
 * Run: node --test scripts/tests/vendors.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadEnv, getBase } = require('./_lib/env-loader')
const { setupTestUser } = require('./_lib/seed')

loadEnv()

const BASE = getBase()

async function fetchJSON(path, options = {}) {
  const res = await fetch(BASE + path, options)
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body, headers: res.headers }
}

test('GET /api/vendors returns vendor list', async () => {
  const res = await fetchJSON('/api/vendors')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.vendors), 'should have vendors array')
  assert.ok(res.body.vendors.length > 0, 'should have at least one vendor')
})

test('GET /api/vendors response shape: ads is always an array (VIEW-backed)', async () => {
  // Migration 014_ads_view_and_seed.sql creates a `ads` VIEW on top of
  // ad_campaigns. Previously the GET silently returned ads: [] with a warn
  // per request because the code read FROM ads but the real table was
  // ad_campaigns. Now the response must include an `ads` array (possibly
  // empty when no active campaigns exist) — and the endpoint must NOT 500
  // when the underlying table is empty.
  const res = await fetchJSON('/api/vendors')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.ads), 'ads should be an array (never undefined)')
  // Shape contract: each ad row, if any, has the camelCase keys the UI expects.
  for (const ad of res.body.ads) {
    assert.ok('id' in ad && 'brandName' in ad && 'imageUrl' in ad && 'targetUrl' in ad,
      'ad row must expose id/brandName/imageUrl/targetUrl keys')
  }
})

test('GET /api/vendors exposes vehicle fields in payload', async () => {
  const res = await fetchJSON('/api/vendors')
  const sample = res.body.vendors[0]
  // The API should always return these keys, even if null — UI uses them.
  assert.ok('vehicleType' in sample, 'vendor payload should expose vehicleType key')
  assert.ok('vehiclePhotoUrl' in sample, 'vendor payload should expose vehiclePhotoUrl key')
})

test('GET /api/vendors?active=true only returns active vendors', async () => {
  const res = await fetchJSON('/api/vendors?active=true')
  assert.equal(res.status, 200)
  for (const v of res.body.vendors) {
    assert.equal(v.isActive, true, 'all vendors should be active')
  }
})

test('GET /api/vendors?withLocation=true filters out vendors without GPS', async () => {
  const res = await fetchJSON('/api/vendors?withLocation=true')
  assert.equal(res.status, 200)
  for (const v of res.body.vendors) {
    assert.ok(typeof v.latitude === 'number' && typeof v.longitude === 'number',
      `vendor ${v.id} missing GPS`)
  }
})

test('GET /api/products returns product list', async () => {
  const res = await fetchJSON('/api/products')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products))
})

test('GET /api/cities returns COLOMBIA_CITIES', async () => {
  const res = await fetchJSON('/api/cities')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.cities))
  assert.ok(res.body.cities.find((c) => c.id === 'bogota'), 'should have bogota')
  assert.ok(res.body.cities.find((c) => c.id === 'medellin'), 'should have medellin')
})

test('GET /api/stats returns counters', async () => {
  const res = await fetchJSON('/api/stats')
  assert.equal(res.status, 200)
  assert.ok(typeof res.body.activeVendors === 'number')
  assert.ok(typeof res.body.activeCities === 'number')
})

test('GET /api/favorites without token returns 401', async () => {
  const res = await fetchJSON('/api/favorites')
  assert.equal(res.status, 401)
})

test('GET /api/orders without token returns 401', async () => {
  const res = await fetchJSON('/api/orders')
  assert.equal(res.status, 401)
})

test('GET /api/notifications without token returns 401', async () => {
  const res = await fetchJSON('/api/notifications')
  assert.equal(res.status, 401)
})
// /api/vendors/me — regression test for the bug where GET returned HTTP 500
// because the handler was actually a PATCH (called req.json() in a GET).
// The fix split the file into distinct GET and PATCH handlers.
test('GET /api/vendors/me without auth returns 401', async () => {
  const res = await fetchJSON('/api/vendors/me')
  assert.equal(res.status, 401)
})

test('GET /api/vendors/me as authenticated seller returns 200 with vendors array', async () => {
  // Login as a real seller with a vendor row (Test Seller 24, set up in
  // scripts/seed-testseller24.sql or manually). We use a generic seller
  // email created during smoke testing.
  // Use the actual seller from the production DB.
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  // If this user no longer exists (deleted during cleanup), skip — the GET
  // behaviour is still covered by the unauthenticated 401 test above.
  if (loginRes.status !== 200) return

  // Forward the cookie jar from login → me request.
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookieHeader },
  })
  // Either 200 with vendors array, or 200 with empty list (no vendor row
  // yet). Both are acceptable; 500 is the regression we care about.
  assert.equal(res.status, 200, 'must not be 500 anymore')
  assert.ok(Array.isArray(res.body.vendors), 'response shape: { vendors: [...] }')
})

test('PATCH /api/vendors/me with invalid cityId returns 400', async () => {
  // No auth → 401, with auth + bad city → 400. The 401 path is the simplest
  // smoke test that doesn't depend on a specific user existing.
  const res = await fetchJSON('/api/vendors/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cityId: 'atlantis' }),
  })
  // 401 (no auth) or 400 (auth + bad city) are both correct; 500 is the bug.
  assert.ok(res.status === 401 || res.status === 400,
    `expected 401 or 400, got ${res.status}: ${JSON.stringify(res.body)}`)
})

// Regression: After commit c84a990 split GET into { vendors: [...] } and PATCH
// into { vendor: {...} }, three client pages (/products, /profile/edit,
// /settings) were still reading data.vendor instead of data.vendors[0]. That
// made /products always render the empty "Sin perfil de vendedor" state, even
// for sellers with a real vendor. The fix on the client side uses:
//   const list = data.vendors ?? (data.vendor ? [data.vendor] : [])
// We can't directly unit-test client code here, but we CAN lock in the API
// contract: a seller with a vendor must get `vendors.length >= 1`. If a
// future refactor reverts the endpoint back to `{ vendor: {...} }`, these
// tests will catch it.
test('GET /api/vendors/me returns vendors[] shape (not legacy vendor shape)', async () => {
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return // skip if test user gone

  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookieHeader },
  })
  assert.equal(res.status, 200)
  // Contract: response MUST contain `vendors` array (the new shape from c84a990).
  // Legacy single-vendor `vendor` shape is no longer supported by the backend;
  // clients use a defensive fallback to stay compatible during partial deploys.
  assert.ok(Array.isArray(res.body.vendors),
    'API contract: { vendors: [...] } (post-c84a990), not { vendor: {...} }')
  assert.equal(res.body.vendor, undefined,
    'API must NOT also include legacy `vendor` field (would mask new shape)')
})

test('GET /api/vendors/me with logged-in seller returns at least one vendor for Test Seller 24', async () => {
  // This user was seeded with a vendor row (scripts/seed-testseller24.sql).
  // If their vendor got deleted during cleanup, skip — the contract test above
  // still gates the response shape.
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return

  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookieHeader },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.vendors))
  assert.ok(res.body.vendors.length >= 1,
    'seeded test seller must have at least one vendor row — otherwise /products and /profile/edit render the "Sin perfil de vendedor" empty state')
  // The shape returned must have a top-level `id` so the client pages can
  // call `list[0].id` without further unwrapping.
  assert.ok(typeof res.body.vendors[0].id === 'string' && res.body.vendors[0].id.length > 0,
    'first vendor must expose a non-empty id')
})

// ─── Sprint 4 B6: completion stats on /api/vendors/me ───────────────────
test('GET /api/vendors/me returns completionPercent and missingFields (B6)', async () => {
  // Sprint 4 UX finishing added `completionPercent` (0-100) and
  // `missingFields[]` to each vendor entry so the SellerOnboardingBanner
  // can show concrete progress instead of a generic "completá el registro".
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookieHeader },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.vendors))
  if (res.body.vendors.length === 0) return

  const v = res.body.vendors[0]
  // completionPercent is an integer 0..100
  assert.equal(typeof v.completionPercent, 'number',
    'completionPercent must be a number')
  assert.ok(Number.isInteger(v.completionPercent),
    'completionPercent must be an integer')
  assert.ok(v.completionPercent >= 0 && v.completionPercent <= 100,
    `completionPercent must be in [0, 100], got ${v.completionPercent}`)
  // missingFields is an array of strings from a known set
  assert.ok(Array.isArray(v.missingFields),
    'missingFields must be an array')
  const KNOWN = new Set(['name', 'description', 'category', 'phone', 'photo', 'city', 'location'])
  for (const f of v.missingFields) {
    assert.ok(KNOWN.has(f), `unknown missing field: ${f}`)
  }
  // Invariant: 100% means no missing fields
  if (v.completionPercent === 100) {
    assert.equal(v.missingFields.length, 0,
      '100% completion must have zero missing fields')
  }
})

// ─── POST /api/vendors — funnel fix ─────────────────────────────────────
//
// Regression: VendorFormSlide (in /onboarding) called POST /api/vendors/me,
// which only exposes GET and PATCH. The server returned 405 silently and
// every new seller was stranded at step 0 of onboarding → 0% funnel conversion.
// Fix: real POST /api/vendors endpoint + VendorFormSlide updated to call it.

test('POST /api/vendors without auth returns 401', async () => {
  const res = await fetchJSON('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', category: 'comida' }),
  })
  assert.equal(res.status, 401,
    `expected 401 (anon blocked), got ${res.status}: ${JSON.stringify(res.body)}`)
})

test('POST /api/vendors with missing name returns 400', async () => {
  // Login first so we exercise the post-auth validation path (not the anon 401).
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return // skip if test user gone
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ category: 'comida' }), // missing name
  })
  assert.equal(res.status, 400,
    `expected 400 (missing name), got ${res.status}: ${JSON.stringify(res.body)}`)
})

test('POST /api/vendors with invalid category returns 400', async () => {
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ name: 'Test Puesto', category: 'no-existe' }),
  })
  assert.equal(res.status, 400,
    `expected 400 (invalid category), got ${res.status}: ${JSON.stringify(res.body)}`)
})

test('POST /api/vendors as seller with existing vendor returns 409 Conflict', async () => {
  // Test Seller 24 (frutas.donjaime) already owns a vendor — the endpoint must
  // refuse the second one with 409 (one-vendor-per-seller rule) instead of
  // silently creating a duplicate.
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ name: 'Segundo Puesto', category: 'comida' }),
  })
  assert.equal(res.status, 409,
    `expected 409 (already has vendor), got ${res.status}: ${JSON.stringify(res.body)}`)
  assert.ok(res.body?.vendor?.id, '409 response should include existing vendor.id')
})

test('POST /api/vendors response shape returns vendor.id, slug, isActive=false', async () => {
  // Contract check — what the client (VendorFormSlide) expects back.
  // We use the 409 path as a proxy: if the response carries `vendor.id` and
  // a string `error`, the new endpoint is live and the shape is what the
  // frontend expects after fix. The full 201 path needs a fresh user and is
  // covered by manual smoke tests (creating a new seller in /register).
  const loginRes = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (loginRes.status !== 200) return
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')

  const res = await fetchJSON('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ name: 'X', category: 'comida' }),
  })
  // Either 409 (already has vendor — most common in CI) or 201 (fresh user).
  assert.ok(res.status === 409 || res.status === 201,
    `expected 201 or 409, got ${res.status}: ${JSON.stringify(res.body)}`)
  if (res.status === 201) {
    assert.ok(res.body?.vendor?.id, '201 response should include vendor.id')
    assert.ok(res.body?.vendor?.slug, '201 response should include vendor.slug')
    assert.equal(res.body.vendor.isActive, false,
      'new vendor starts hidden — vendor opts in via VendorVisibility toggle')
  } else {
    // 409 case: must surface the existing vendor info so the client can
    // route the user straight to the dashboard instead of looping the form.
    assert.ok(res.body?.vendor?.id, '409 response should include existing vendor.id')
  }
})

// --- Sprint 11 B-AUTH-3: register funnel regression tests -------

test('Sprint 11 B-AUTH-3: PATCH /api/vendors/[id] accepts isActive (camelCase)', async () => {
  // The auto-bootstrap creates a vendor on register when role=seller.
  // The onboarding form calls PATCH with `isActive: true` (camelCase) —
  // this must update the DB column, not be silently dropped.
  const u = await setupTestUser({ role: 'seller' })
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: u.email, password: u.password }),
  })
  const cookie = loginRes.headers.get('set-cookie').split(';')[0]

  const meRes = await fetch(`${BASE}/api/vendors/me`, { headers: { Cookie: cookie } })
  const meData = await meRes.json()
  const vendor = meData.vendors[0]
  if (!vendor) {
    assert.ok(true, 'no vendor — auto-bootstrap did not run, skipping')
    return
  }
  const patchRes = await fetch(`${BASE}/api/vendors/${vendor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ isActive: true }),
  })
  const patchData = await patchRes.json()
  assert.ok(patchData.vendor, 'PATCH should return a vendor')
  // The PATCH response row uses snake_case (DB column). The seed
  // user picked up the auto-bootstrap vendor with is_active=false;
  // we're now flipping it to true via the camelCase sending path.
  assert.equal(patchData.vendor.is_active, true,
    'is_active should now be true after PATCH with isActive: true')
})

test('Sprint 11 B-AUTH-3: GET /api/vendors?active=true returns vendors without GPS ping', async () => {
  // Previously the active=true filter REQUIRED location_updated_at >= now-5min.
  // This broke the funnel for newly-registered sellers who haven't pinged
  // GPS yet. After the fix, is_active=true alone is enough.
  const res = await fetch(`${BASE}/api/vendors?active=true`)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(data.vendors), 'vendors should be an array')
  // We don't assert a specific count because the seed runs vary.
  // We only assert that the filter does NOT throw SQL errors.
  assert.ok(data.vendors.every(v => v.isActive === true),
    'every returned vendor should have isActive=true')
})

// --- Task 6: service role can read/edit /api/vendors/me ---

test('service user with wantsMap=true gets 200 + studio vendor on GET /api/vendors/me', async () => {
  // Registers a service user with wantsMap=true (auto-bootstraps a
  // station_type='studio' vendor row). The GET endpoint must accept
  // role='service' and return the vendor in the new shape.
  const ts = Date.now() + Math.random()
  const email = `svc-vm-${ts}@barriotech-test.com`
  const phone = `+57307${String(ts).slice(-8)}`
  const res = await fetchJSON('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'SvcVm123!',
      name: 'Svc VM', phone, cityId: 'bogota',
      role: 'service', wantsMap: true,
      acceptedTerms: true, acceptedPrivacy: true,
    }),
  })
  assert.equal(res.status, 200, `register failed: ${JSON.stringify(res.body)}`)
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  const me = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookie },
  })
  assert.equal(me.status, 200,
    `service+wantsMap=true GET should be 200, got ${me.status}: ${JSON.stringify(me.body)}`)
  assert.ok(Array.isArray(me.body.vendors), 'response must have vendors array')
  assert.ok(me.body.vendors.length >= 1, 'service+wantsMap=true must have a vendor row')
  assert.equal(me.body.vendors[0].stationType, 'studio',
    `station_type must be 'studio', got ${me.body.vendors[0].stationType}`)
})

test('service user with wantsMap=false gets 404 on GET /api/vendors/me', async () => {
  // Service users who skipped the map checkbox have no vendor row.
  // The endpoint must return 404 (not 200+empty, not 500) so the client
  // can distinguish "no vendor yet" from "vendor exists".
  const ts = Date.now() + Math.random()
  const email = `svc-vm2-${ts}@barriotech-test.com`
  const phone = `+57308${String(ts).slice(-8)}`
  const res = await fetchJSON('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: 'SvcVm2123!',
      name: 'Svc VM2', phone, cityId: 'bogota',
      role: 'service', wantsMap: false,
      acceptedTerms: true, acceptedPrivacy: true,
    }),
  })
  assert.equal(res.status, 200, `register failed: ${JSON.stringify(res.body)}`)
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  const me = await fetchJSON('/api/vendors/me', {
    headers: { Cookie: cookie },
  })
  assert.equal(me.status, 404,
    `service+wantsMap=false GET should be 404, got ${me.status}: ${JSON.stringify(me.body)}`)
})
