/**
 * Tests for tier 12 — orders total range filter (minTotal/maxTotal).
 *
 * The backend /api/admin/orders has supported `minTotal` and `maxTotal`
 * since tier 6 — the UI just didn't expose them. These tests verify
 * the filter params land on the endpoint correctly.
 *
 * Scope:
 *  1. minTotal alone narrows to orders with total >= minTotal
 *  2. maxTotal alone narrows to orders with total <= maxTotal
 *  3. minTotal + maxTotal returns the band only
 *  4. invalid minTotal returns 400 (backend validates)
 *  5. negative minTotal returns 400
 *  6. combined with status — both filters apply
 *  7. empty values are no-ops (no regression)
 *
 * Run: node --test scripts/tests/admin-orders-total-filter.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/barriotech/apps/web/.env'),
})
const { setupTestUser } = require('./_lib/seed')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3008'
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  let text = null
  try { text = await res.text() } catch {}
  if (text) {
    try { body = JSON.parse(text) } catch { /* HTML body */ }
  }
  return { status: res.status, body, text, headers: res.headers }
}

async function dbClient() {
  const c = new Client({
    host: DB_HOST || 'localhost',
    port: parseInt(DB_PORT || '5432', 10),
    database: DB_NAME || 'gps_street_sellers',
    user: DB_USER || 'postgres',
    password: typeof DB_PASSWORD === 'string' ? DB_PASSWORD : 'postgres',
  })
  await c.connect()
  return c
}

async function createAdmin() {
  const c = await dbClient()
  try {
    const email = `ci-test-admin-tier12-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'CI Admin Tier12', 'admin', true) RETURNING id, email`,
      [email, hash]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

async function loginAdmin(email) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`)
  } finally { await c.end() }
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${res.text}`)
  const cookie = res.headers.get('set-cookie')
  const m = cookie.match(/token=([^;]+)/)
  if (!m) throw new Error('No token cookie')
  return { cookie: `token=${m[1]}` }
}

async function getProfileId(email) {
  const c = await dbClient()
  try {
    const r = await c.query(`SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [email])
    return r.rows[0]?.id
  } finally { await c.end() }
}

async function seedVendorWithSeller() {
  const seller = await setupTestUser({ role: 'seller', cityId: 'bogota' })
  const profileId = await getProfileId(seller.email)
  if (!profileId) throw new Error('seed: seller profile missing')
  const c = await dbClient()
  try {
    const slug = `ci-tier12-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase()
    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, 'bogota', true, true)
       RETURNING id`,
      [profileId, `Tier12 Vendor ${SUFFIX}`, slug]
    )
    return { vendorId: v.rows[0].id, profileId, seller }
  } finally { await c.end() }
}

async function seedBuyer() {
  const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
  const profileId = await getProfileId(buyer.email)
  if (!profileId) throw new Error('seed: buyer profile missing')
  return { buyer, profileId }
}

async function createOrder(buyerProfileId, vendorId, status, total) {
  const c = await dbClient()
  try {
    const r = await c.query(
      `INSERT INTO orders (buyer_id, vendor_id, status, total)
       VALUES ($1, $2, $3, $4)
       RETURNING id, total, status`,
      [buyerProfileId, vendorId, status, total]
    )
    return r.rows[0]
  } finally { await c.end() }
}

async function resetTestOrders() {
  const c = await dbClient()
  try {
    await c.query(
      `DELETE FROM orders WHERE vendor_id IN (
         SELECT id FROM vendors WHERE name LIKE 'Tier12 Vendor %'
       )`
    )
  } finally { await c.end() }
}

let adminAuth
let buyerProfileId
let vendorId

test('setup: create admin, buyer, vendor', async () => {
  const admin = await createAdmin()
  adminAuth = await loginAdmin(admin.email)
  const { profileId: b } = await seedBuyer()
  buyerProfileId = b
  const v = await seedVendorWithSeller()
  vendorId = v.vendorId
  assert.ok(adminAuth.cookie, 'admin cookie set')
  assert.ok(buyerProfileId, 'buyer profile created')
  assert.ok(vendorId, 'vendor created')
})

test('1. minTotal alone narrows to orders with total >= minTotal', async () => {
  await resetTestOrders()
  // Seed three orders with distinct totals.
  await createOrder(buyerProfileId, vendorId, 'pending', 100)
  await createOrder(buyerProfileId, vendorId, 'pending', 500)
  await createOrder(buyerProfileId, vendorId, 'pending', 1000)

  const res = await fetchJSON('/api/admin/orders?minTotal=500&limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  // Our three seeded orders must all be returned.
  const our = res.body.orders.filter((o) => o.vendor?.id === vendorId)
  assert.equal(our.length, 2, `expected 2 seeded orders >= 500, got ${our.length}`)
  for (const o of our) {
    assert.ok(parseFloat(o.total) >= 500, `expected ${o.total} >= 500`)
  }
})

test('2. maxTotal alone narrows to orders with total <= maxTotal', async () => {
  await resetTestOrders()
  await createOrder(buyerProfileId, vendorId, 'pending', 100)
  await createOrder(buyerProfileId, vendorId, 'pending', 500)
  await createOrder(buyerProfileId, vendorId, 'pending', 1000)

  const res = await fetchJSON('/api/admin/orders?maxTotal=500&limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  const our = res.body.orders.filter((o) => o.vendor?.id === vendorId)
  assert.equal(our.length, 2, `expected 2 seeded orders <= 500, got ${our.length}`)
  for (const o of our) {
    assert.ok(parseFloat(o.total) <= 500, `expected ${o.total} <= 500`)
  }
})

test('3. minTotal + maxTotal returns the band only', async () => {
  await resetTestOrders()
  await createOrder(buyerProfileId, vendorId, 'pending', 100)
  await createOrder(buyerProfileId, vendorId, 'pending', 300)
  await createOrder(buyerProfileId, vendorId, 'pending', 700)
  await createOrder(buyerProfileId, vendorId, 'pending', 1500)

  const res = await fetchJSON('/api/admin/orders?minTotal=200&maxTotal=1000&limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  const our = res.body.orders.filter((o) => o.vendor?.id === vendorId)
  // Only 300 and 700 fall in [200, 1000].
  assert.equal(our.length, 2, `expected 2 in band, got ${our.length}`)
  for (const o of our) {
    const t = parseFloat(o.total)
    assert.ok(t >= 200 && t <= 1000, `expected ${t} in [200, 1000]`)
  }
})

test('4. invalid minTotal returns 400', async () => {
  const res = await fetchJSON('/api/admin/orders?minTotal=not-a-number', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.ok(res.body?.error, 'error message expected')
})

test('5. negative minTotal returns 400', async () => {
  const res = await fetchJSON('/api/admin/orders?minTotal=-100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
})

test('6. combined with status filter — both apply', async () => {
  await resetTestOrders()
  await createOrder(buyerProfileId, vendorId, 'pending', 500)
  await createOrder(buyerProfileId, vendorId, 'completed', 500)

  const res = await fetchJSON(
    '/api/admin/orders?minTotal=100&status=pending&limit=100',
    { headers: { Cookie: adminAuth.cookie } }
  )
  assert.equal(res.status, 200)
  const our = res.body.orders.filter((o) => o.vendor?.id === vendorId)
  // Only the pending one survives.
  assert.equal(our.length, 1, `expected 1 row, got ${our.length}`)
  assert.equal(our[0].status, 'pending')
  assert.ok(parseFloat(our[0].total) >= 100)
})

test('7. empty values are no-ops (no regression)', async () => {
  const res = await fetchJSON('/api/admin/orders?minTotal=&maxTotal=&limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.orders), 'orders must be array')
})
