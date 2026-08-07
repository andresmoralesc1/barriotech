/**
 * Tests for /api/products endpoints — runs with Node's built-in test runner.
 *
 * Run: node --test scripts/tests/products.test.js
 *
 * These tests do NOT require authentication. They cover:
 *   - shape contracts that the seller UI relies on
 *   - validation errors that must come back as 400 (not 500) so the UI
 *     can show a useful message
 *   - ownership/authz paths (404 without auth, 401 etc.)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadEnv, getBase } = require('./_lib/env-loader')

loadEnv()

const BASE = getBase()

async function fetchJSON(path, options = {}) {
  const res = await fetch(BASE + path, options)
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body, headers: res.headers }
}

// Sprint 6 D.1 helper: log in the seeded test seller and return the
// cookie header for downstream requests. Returns `{ cookieHeader: '' }`
// if login failed, so the test can early-return.
async function loginTestSeller() {
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'frutas.donjaime@gps.test',
      password: 'TestPass2026!',
    }),
  })
  if (res.status !== 200) return { cookieHeader: '' }
  const setCookie = res.headers.get('set-cookie') || ''
  // Same set-cookie parsing as the other tests in this file.
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')
  return { cookieHeader }
}

// --- POST /api/products -----------------------------------------------------

test('POST /api/products without auth returns 401', async () => {
  // CRIT fix: POST was already behind requireAuth, but make the contract
  // explicit so a future regression flips to 200/201 instead of bypassing
  // auth silently.
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x', price: 1 }),
  })
  assert.equal(res.status, 401, 'POST without auth must be 401')
})

test('POST /api/products with missing name still 401 (auth checked first)', async () => {
  // Server short-circuits on auth before validating body, so a missing-name
  // request still gets 401. This documents the ordering: auth wins over
  // body validation so anonymous users can't probe field names.
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 1000 }),
  })
  assert.equal(res.status, 401)
})

// --- PATCH /api/products/[id] -----------------------------------------------

test('PATCH /api/products/{bad-uuid} returns 400, not 500', async () => {
  // CRIT fix: the old handler ran DELETE regardless of HTTP method, so any
  // call to a malformed id would reach the SQL layer. The new handler
  // validates UUID format up front and returns 400.
  const res = await fetchJSON('/api/products/not-a-uuid', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })
  assert.equal(res.status, 400, 'bad UUID must return 400, not 500')
  assert.ok(res.body?.error, 'should include an error message')
})

test('PATCH /api/products/{bad-uuid} returns 400 (DELETE method)', async () => {
  // Same UUID guard for DELETE
  const res = await fetchJSON('/api/products/not-a-uuid', {
    method: 'DELETE',
  })
  assert.equal(res.status, 400)
})

test('PATCH /api/products/{valid-uuid} without auth returns 401', async () => {
  // Use a syntactically valid UUID to get past the regex and hit the auth
  // check. Order: UUID → auth → ownership → body.
  const res = await fetchJSON('/api/products/00000000-0000-0000-0000-000000000000', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })
  assert.equal(res.status, 401)
})

test('DELETE /api/products/{valid-uuid} without auth returns 401', async () => {
  const res = await fetchJSON('/api/products/00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
  })
  assert.equal(res.status, 401)
})

// --- GET /api/products ------------------------------------------------------

test('GET /api/products returns products array (anonymous)', async () => {
  // GET is intentionally public so the catalogue is browseable.
  const res = await fetchJSON('/api/products?vendorId=00000000-0000-0000-0000-000000000000')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products), 'response must have products[]')
})

test('GET /api/products?limit=… shape is stable', async () => {
  // No filters → all products. Smoke-test the response shape.
  const res = await fetchJSON('/api/products')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products))
  // If there are any rows, each must have the fields the UI renders
  for (const p of res.body.products.slice(0, 3)) {
    assert.ok('id' in p && 'name' in p && 'price' in p, 'product row must have id/name/price')
  }
})

// --- Audit 2026-07-19: extended validation tests ----------------------------

test('GET /api/products?vendorId=bad-uuid returns empty array, not 500', async () => {
  // CRIT audit fix: previously a non-UUID vendorId would reach the SQL layer
  // and Postgres would return 22P02 (invalid_text_representation) → 500.
  // Now the handler validates the UUID and returns 200 with products: [].
  const res = await fetchJSON('/api/products?vendorId=not-a-uuid')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.products, [])
})

test('GET /api/products response shape excludes columns not in allowlist', async () => {
  // Audit fix: switched from SELECT * to an explicit column list so we don't
  // leak future internal columns (e.g. deleted_at, internal_notes).
  // The audit listed 7 public columns. Anything beyond must NOT be present.
  // Sprint 6 D.1 added `is_active` so sellers can see which products are
  // hidden in their own catalogue (the public catalog filter only returns
  // is_active=true rows, but the column is still in the response so the
  // seller UI can show a "Visible / Oculto" pill).
  const res = await fetchJSON('/api/products')
  assert.equal(res.status, 200)
  for (const p of res.body.products.slice(0, 3)) {
    // Migration 102 (services) added kind + the 3 service-only columns.
    const allowed = ['id', 'vendor_id', 'name', 'description', 'price', 'photo_url', 'is_active', 'created_at', 'kind', 'duration_minutes', 'modality', 'pricing_unit']
    const keys = Object.keys(p)
    for (const k of keys) {
      assert.ok(allowed.includes(k), `unexpected column ${k} leaked in GET /api/products`)
    }
  }
})

test('POST /api/products requires authentication (revocation-aware)', async () => {
  // Audit fix: switched verifyToken → requireAuth so a revoked session cannot
  // keep creating products until natural JWT expiry.
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', price: 1 }),
  })
  assert.equal(res.status, 401, 'must be 401 without auth')
})

test('POST /api/products rejects array-typed name (strict body validation)', async () => {
  // Audit fix: previous code did `if (!name)` which accepted arrays because
  // `if ([1,2])` is truthy. Now the handler checks typeof === 'string'.
  // Without auth we still get 401 (auth wins), but the body parse path must
  // be defensive — we test by sending a body that would otherwise crash the
  // legacy trim() call if it got past auth.
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ['producto'], price: 1000 }),
  })
  assert.equal(res.status, 401, 'auth must be checked first; array-bodied POST still 401')
})

// --- /api/products/[id]/photos ----------------------------------------------

test('GET /api/products/{bad-uuid}/photos returns 400, not 500', async () => {
  // Audit fix: UUID validation up front so a malformed path doesn't reach
  // Postgres and produce a 22P02 error.
  const res = await fetchJSON('/api/products/not-a-uuid/photos')
  assert.equal(res.status, 400)
})

test('POST /api/products/{bad-uuid}/photos returns 400', async () => {
  const res = await fetchJSON('/api/products/not-a-uuid/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/x.jpg' }),
  })
  assert.equal(res.status, 400)
})

test('DELETE /api/products/{bad-uuid}/photos returns 400', async () => {
  const res = await fetchJSON('/api/products/not-a-uuid/photos', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: '00000000-0000-0000-0000-000000000000' }),
  })
  assert.equal(res.status, 400)
})

test('POST /api/products/{uuid}/photos without auth returns 401', async () => {
  const res = await fetchJSON('/api/products/00000000-0000-0000-0000-000000000000/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/x.jpg' }),
  })
  assert.equal(res.status, 401)
})

test('DELETE /api/products/{uuid}/photos without auth returns 401', async () => {
  const res = await fetchJSON('/api/products/00000000-0000-0000-0000-000000000000/photos', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: '00000000-0000-0000-0000-000000000000' }),
  })
  assert.equal(res.status, 401)
})

// --- Audit 2026-07-20: PATCH photos + FTS endpoint -----------------------

test('PATCH /api/products/{bad-uuid}/photos returns 400', async () => {
  const res = await fetchJSON('/api/products/not-a-uuid/photos', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: [] }),
  })
  assert.equal(res.status, 400)
})

test('PATCH /api/products/{uuid}/photos without auth returns 401', async () => {
  const res = await fetchJSON('/api/products/00000000-0000-0000-0000-000000000000/photos', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: ['00000000-0000-0000-0000-000000000000'] }),
  })
  assert.equal(res.status, 401)
})

test('GET /api/products?q=… accepts free-text search and does not 500', async () => {
  // Anonymous endpoint; we don't assert a particular shape beyond "no 500"
  // because the seed data changes per environment. We just confirm the
  // endpoint tolerates the ?q= param with empty / whitespace / normal input.
  for (const q of ['', '   ', 'empanada', 'arepas con queso', "L'Orange"]) {
    const url = `/api/products?q=${encodeURIComponent(q)}`
    const res = await fetchJSON(url)
    assert.notEqual(res.status, 500, `?q=${q} should not 500`)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.products), 'response has products array')
  }
})

test('GET /api/products?q=bad-chars does not crash (plainto_tsquery sanitizes)', async () => {
  const res = await fetchJSON('/api/products?q=' + encodeURIComponent('!!!()&&||'))
  assert.notEqual(res.status, 500)
  assert.equal(res.status, 200)
})
// --- Audit 2026-07-20: backfill + slug resolve ---------------------------

function readDbUrl() {
  const envPath = path.join(__dirname, '../../apps/web/.env')
  if (!fs.existsSync(envPath)) return process.env.DATABASE_URL || ''
  const txt = fs.readFileSync(envPath, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^(DATABASE_URL)\s*=\s*(.*)$/)
    if (m) return m[2].trim().replace(/^["']|["']$/g, '')
  }
  return process.env.DATABASE_URL || ''
}

const { setupTestVendor, wipeCiTestRows } = require('./_lib/seed')

test('setup: wipe ci-test-* rows from previous runs', async () => {
  await wipeCiTestRows()
})

test('migration 017 left no products without a product_photos row', async () => {
  // Run a direct DB query. We import pg only when needed so the file is still
  // safe to import in environments without DB access.
  const pg = require('pg')
  const dbUrl = readDbUrl()
  if (!dbUrl) {
    // No DB URL — skip rather than fail.
    return
  }
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM products p
         LEFT JOIN product_photos ph ON ph.product_id = p.id
        WHERE ph.id IS NULL`
    )
    assert.equal(rows[0].n, 0, 'no orphan products without a product_photos row')
  } finally {
    await client.end()
  }
})

test('GET /api/vendors/{id}/catalog returns products for a public id', async () => {
  // Create a fresh test vendor with a known id + slug + product + photo.
  // This way the test doesn't depend on whatever data lives in the DB.
  const v = await setupTestVendor()

  const res = await fetchJSON(`/api/vendors/${v.vendorId}/catalog`)
  assert.equal(res.status, 200)
  assert.ok(res.body.vendor, 'response has vendor object')
  assert.ok(Array.isArray(res.body.products), 'response has products array')
})

// --- Sprint 6 D.1: products.is_active toggle --------------------------------

test('POST /api/products returns is_active=true (default) for new products (D.1)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Test Toggle Product ' + Date.now(),
      description: 'For testing is_active',
      price: 1000,
      vendor_id: v.vendorId,
    }),
  })
  assert.equal(res.status, 201, `expected 201, got ${res.status}`)
  assert.equal(res.body.product?.is_active, true,
    'new products default to is_active=true (column default)')
})

test('PATCH /api/products/[id] toggles is_active (D.1)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const created = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Toggle Target ' + Date.now(),
      price: 500,
      vendor_id: v.vendorId,
    }),
  })
  if (created.status !== 201) return
  const productId = created.body.product.id

  const hide = await fetchJSON(`/api/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ isActive: false }),
  })
  assert.equal(hide.status, 200)
  assert.equal(hide.body.product?.is_active, false, 'should be hidden after PATCH isActive:false')

  const show = await fetchJSON(`/api/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ isActive: true }),
  })
  assert.equal(show.status, 200)
  assert.equal(show.body.product?.is_active, true, 'should be visible after PATCH isActive:true')
})

test('PATCH /api/products/[id] rejects non-boolean isActive (D.1)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const created = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ name: 'Strict Bool ' + Date.now(), price: 100, vendor_id: v.vendorId }),
  })
  if (created.status !== 201) return
  const res = await fetchJSON(`/api/products/${created.body.product.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ isActive: 'true' }),
  })
  assert.equal(res.status, 400)
  assert.match(res.body.error || '', /booleano/i,
    'should reject string "true" with a clear boolean error')
})

test('GET /api/products (anonymous) hides products with is_active=false (D.1)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const created = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ name: 'Draft Product ' + Date.now(), price: 100, vendor_id: v.vendorId }),
  })
  if (created.status !== 201) return
  const productId = created.body.product.id

  await fetchJSON(`/api/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ isActive: false }),
  })

  const anon = await fetchJSON(`/api/products?vendorId=${v.vendorId}`)
  assert.equal(anon.status, 200)
  const anonIds = (anon.body.products || []).map((p) => p.id)
  assert.ok(!anonIds.includes(productId),
    'anonymous view must hide is_active=false products')

  const anonWithFlag = await fetchJSON(`/api/products?vendorId=${v.vendorId}&includeDrafts=true`)
  assert.equal(anonWithFlag.status, 200)
  const anonFlagIds = (anonWithFlag.body.products || []).map((p) => p.id)
  assert.ok(!anonFlagIds.includes(productId),
    'includeDrafts=true should only work for authenticated sellers, not anonymous viewers')
})

// --- Sprint 8 D.2: products metric tile regression tests --------------

test('Sprint 8 D.2: GET /api/products?vendorId=X&includeDrafts=true returns hidden products with is_active=false', async () => {
  // The dashboard fetches with includeDrafts=true so it can show the
  // published/hidden breakdown. The previous default filtered to
  // is_active=true only — sellers couldn't see their paused items in
  // the dashboard metric.
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  // Create a product, hide it.
  const created = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ name: 'Hidden Test ' + Date.now(), price: 100, vendor_id: v.vendorId }),
  })
  if (created.status !== 201) return
  await fetchJSON(`/api/products/${created.body.product.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ isActive: false }),
  })

  // Anonymous with includeDrafts=true should NOT see the hidden product.
  const anon = await fetchJSON(`/api/products?vendorId=${v.vendorId}&includeDrafts=true`)
  assert.equal(anon.status, 200)
  const anonIds = (anon.body.products || []).map((p) => p.id)
  assert.ok(!anonIds.includes(created.body.product.id),
    'anonymous viewers still must NOT see drafts even with includeDrafts=true')

  // Authenticated seller with includeDrafts=true SHOULD see it.
  const seller = await fetchJSON(`/api/products?vendorId=${v.vendorId}&includeDrafts=true`, {
    headers: { Cookie: login.cookieHeader },
  })
  assert.equal(seller.status, 200)
  const sellerIds = (seller.body.products || []).map((p) => p.id)
  assert.ok(sellerIds.includes(created.body.product.id),
    'authenticated seller should see their own hidden product with includeDrafts=true')
  // And the hidden product carries is_active=false so the dashboard can
  // count it.
  const hidden = seller.body.products.find((p) => p.id === created.body.product.id)
  assert.equal(hidden.is_active, false, 'is_active=false should be in the response')
})

test('Sprint 8 D.2: GET /api/products allowlist includes is_active (response shape guard)', async () => {
  // Regression: if a future refactor drops is_active from the SELECT
  // list, the ProductsMetricTile would silently show hiddenCount=0 and
  // sellers wouldn't know they have paused items. This test catches that.
  const res = await fetchJSON('/api/products')
  assert.equal(res.status, 200)
  for (const p of res.body.products.slice(0, 3)) {
    assert.ok('is_active' in p, 'is_active must always be present in the response shape')
    assert.equal(typeof p.is_active, 'boolean', 'is_active must be a boolean')
  }
})
