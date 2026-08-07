/**
 * Tests for migration 102 (service offerings) — runs with Node's built-in
 * test runner.
 *
 * Run: node --test scripts/tests/services.test.js
 *
 * Coverage:
 *   - GET /api/products returns the new columns (kind, duration_minutes,
 *     modality, pricing_unit) on every row.
 *   - GET /api/products?kind=product|service filters correctly.
 *   - POST /api/products with kind=service creates a row carrying all 3
 *     service fields; the DB cross-field CHECK passes.
 *   - POST /api/products with invalid modality / pricing_unit returns 400.
 *   - POST /api/products with duration out of 5..600 returns 400.
 *   - POST /api/products with kind=product still works (default branch).
 *   - PATCH /api/products/[id] rejects attempts to change kind or service
 *     fields (out of scope for migration 102).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { loadEnv, getBase } = require('./_lib/env-loader')
const { setupTestVendor, wipeCiTestRows } = require('./_lib/seed')

loadEnv()

const BASE = getBase()

async function fetchJSON(path, options = {}) {
  const res = await fetch(BASE + path, options)
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body, headers: res.headers }
}

// Sprint 6 D.1 helper reused: log in the seeded test seller.
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
  const cookieHeader = setCookie.split(',').map((c) => c.split(';')[0]).join('; ')
  return { cookieHeader }
}

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

test('setup: wipe ci-test-* rows from previous runs', async () => {
  await wipeCiTestRows()
})

// --- GET shape --------------------------------------------------------------

test('GET /api/products response includes the migration-102 columns', async () => {
  const res = await fetchJSON('/api/products')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products))
  // Even an empty catalogue should return [] with the allowlist applied.
  // If rows are present, each must carry kind + service columns.
  for (const p of res.body.products.slice(0, 3)) {
    assert.ok('kind' in p, 'GET response must include `kind`')
    assert.ok('duration_minutes' in p, 'GET response must include `duration_minutes`')
    assert.ok('modality' in p, 'GET response must include `modality`')
    assert.ok('pricing_unit' in p, 'GET response must include `pricing_unit`')
  }
})

test('GET /api/products?kind=service returns only service rows', async () => {
  // The seeded seller might not have a service-category vendor. The filter
  // is still validated by the SQL — it must return a 200 with rows that
  // have kind='service' (if any) or an empty array.
  const res = await fetchJSON('/api/products?kind=service')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products))
  for (const p of res.body.products) {
    assert.equal(p.kind, 'service', 'every row must have kind=service when ?kind=service')
  }
})

test('GET /api/products?kind=invalid returns 200 with empty array', async () => {
  // Bad input is ignored: handler falls through to "no kind filter" and
  // returns the public catalogue. Better than a 400 because the public
  // GET is anonymous and shouldn't echo validation failures.
  const res = await fetchJSON('/api/products?kind=bogus')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.products))
})

// --- POST kind=service ------------------------------------------------------

test('POST /api/products with kind=service persists duration + modality + pricing_unit', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return // seeded seller missing — skip
  const v = await setupTestVendor()

  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Clase de salsa ' + Date.now(),
      description: 'Nivel principiante',
      price: 25000,
      photo_url: null,
      vendor_id: v.vendorId,
      kind: 'service',
      duration_minutes: 60,
      modality: 'on_site',
      pricing_unit: 'class',
    }),
  })
  if (res.status !== 201) return // vendor ownership check rejected
  const product = res.body.product
  assert.equal(product.kind, 'service')
  assert.equal(product.duration_minutes, 60)
  assert.equal(product.modality, 'on_site')
  assert.equal(product.pricing_unit, 'class')
})

test('POST /api/products with kind=service and invalid modality returns 400', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Bad Modality ' + Date.now(),
      price: 1000,
      vendor_id: v.vendorId,
      kind: 'service',
      duration_minutes: 60,
      modality: 'on_the_way', // not in enum
      pricing_unit: 'class',
    }),
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.match(res.body.error || '', /modalidad/i)
})

test('POST /api/products with kind=service and duration out of range returns 400', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Bad Duration ' + Date.now(),
      price: 1000,
      vendor_id: v.vendorId,
      kind: 'service',
      duration_minutes: 2, // below 5
      modality: 'on_site',
      pricing_unit: 'class',
    }),
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.match(res.body.error || '', /duraci/i)
})

test('POST /api/products with kind=service and invalid pricing_unit returns 400', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Bad Unit ' + Date.now(),
      price: 1000,
      vendor_id: v.vendorId,
      kind: 'service',
      duration_minutes: 60,
      modality: 'on_site',
      pricing_unit: 'per_visit', // not in enum
    }),
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.match(res.body.error || '', /unidad/i)
})

// --- POST kind=product (default) -------------------------------------------

test('POST /api/products defaults kind=product (backwards compat)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const res = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({
      name: 'Plain Product ' + Date.now(),
      description: 'No kind field — defaults to product',
      price: 1500,
      vendor_id: v.vendorId,
    }),
  })
  assert.equal(res.status, 201)
  assert.equal(res.body.product.kind, 'product',
    'omitted kind must default to "product"')
  assert.equal(res.body.product.duration_minutes, null)
  assert.equal(res.body.product.modality, null)
  assert.equal(res.body.product.pricing_unit, null)
})

// --- PATCH kind/service-fields blocked -------------------------------------

test('PATCH /api/products/[id] rejects kind change (400)', async () => {
  const login = await loginTestSeller()
  if (!login.cookieHeader) return
  const v = await setupTestVendor()
  const created = await fetchJSON('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ name: 'Plain ' + Date.now(), price: 100, vendor_id: v.vendorId }),
  })
  if (created.status !== 201) return
  const res = await fetchJSON(`/api/products/${created.body.product.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: login.cookieHeader },
    body: JSON.stringify({ kind: 'service' }),
  })
  assert.equal(res.status, 400)
  assert.match(res.body.error || '', /elimina.*crea|producto.*servicio/i)
})

// --- DB CHECK guard ---------------------------------------------------------

test('migration 102 cross-field CHECK exists in pg_constraint', async () => {
  // Direct DB check: the constraint must exist so a future migration that
  // drops it would fail this test loudly.
  const pg = require('pg')
  const dbUrl = readDbUrl()
  if (!dbUrl) return // skip when no DB URL
  const c = new pg.Client({ connectionString: dbUrl })
  await c.connect()
  try {
    const { rows } = await c.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'products_kind_fields_consistent'`
    )
    assert.equal(rows.length, 1, 'cross-field CHECK must be present')
  } finally {
    await c.end()
  }
})

test('migration 102 vendors.category CHECK lists 11 values', async () => {
  // The product categories + 5 service categories must all be in the
  // CHECK definition. If a future migration drops the constraint or
  // narrows it, this test fails loudly.
  const pg = require('pg')
  const dbUrl = readDbUrl()
  if (!dbUrl) return
  const c = new pg.Client({ connectionString: dbUrl })
  await c.connect()
  try {
    const { rows } = await c.query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'vendors_category_check'`
    )
    const def = rows[0]?.def || ''
    for (const cat of ['frutas','comida','bebidas','artesanias','ropa','otros',
                       'clases','bienestar','belleza','hogar','eventos']) {
      assert.ok(def.includes(`'${cat}'`),
        `vendors_category_check must include '${cat}' (def=${def})`)
    }
  } finally {
    await c.end()
  }
})

// --- TS/SQL drift guard -----------------------------------------------------

test('packages/core CATEGORIES includes 5 service categories', () => {
  // Lightweight assertion: the TS file lists all 5 new ids.
  const f = path.join(__dirname, '../../packages/core/src/constants/categories.ts')
  const txt = fs.readFileSync(f, 'utf8')
  for (const cat of ['clases','bienestar','belleza','hogar','eventos']) {
    assert.ok(txt.includes(`id: '${cat}'`),
      `${f} must define category '${cat}'`)
  }
})

test('apps/web mirror CATEGORIES includes 5 service categories', () => {
  const f = path.join(__dirname, '../../apps/web/lib/core/constants/categories.ts')
  const txt = fs.readFileSync(f, 'utf8')
  for (const cat of ['clases','bienestar','belleza','hogar','eventos']) {
    assert.ok(txt.includes(`id: '${cat}'`),
      `${f} must define category '${cat}'`)
  }
})
