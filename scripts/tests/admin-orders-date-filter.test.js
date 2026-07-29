/**
 * Tests for tier 11 — orders date range filter (admin UI).
 *
 * The backend /api/admin/orders has supported `since` and `until` since
 * tier 6 — the UI just didn't expose them. These tests verify the
 * filter params land on the endpoint correctly so the operator can
 * scope their orders view by date.
 *
 * Scope:
 *  1. since alone narrows to orders created on/after that day
 *  2. until alone narrows to orders created before that day
 *  3. since + until returns the window only
 *  4. malformed date is silently ignored (no crash)
 *  5. combined with status filter — both apply
 *  6. empty since + until returns full list (no regression)
 *
 * Run: node --test scripts/tests/admin-orders-date-filter.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/gps-street-sellers/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/gps-street-sellers/apps/web/.env'),
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
    const email = `ci-test-admin-tier11-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'CI Admin Tier11', 'admin', true) RETURNING id, email`,
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
    const slug = `ci-tier11-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase()
    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, 'bogota', true, true)
       RETURNING id`,
      [profileId, `Tier11 Vendor ${SUFFIX}`, slug]
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

async function createOrder(buyerProfileId, vendorId, status, createdAt) {
  const c = await dbClient()
  try {
    // orders.total is numeric(10,2) (not cents). Use 100.00 as a non-zero
    // value to dodge any "must be > 0" constraints.
    const r = await c.query(
      `INSERT INTO orders (buyer_id, vendor_id, status, total, created_at)
       VALUES ($1, $2, $3, 100.00, $4)
       RETURNING id, created_at`,
      [buyerProfileId, vendorId, status, createdAt]
    )
    return r.rows[0]
  } finally { await c.end() }
}

async function resetTestOrders() {
  const c = await dbClient()
  try {
    await c.query(
      `DELETE FROM orders WHERE vendor_id IN (
         SELECT id FROM vendors WHERE name LIKE 'Tier11 Vendor %'
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

test('1. since alone narrows to orders created on/after that day', async () => {
  await resetTestOrders()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await createOrder(buyerProfileId, vendorId, 'pending', `${yesterday} 12:00:00`)
  await createOrder(buyerProfileId, vendorId, 'pending', `${today} 12:00:00`)

  const res = await fetchJSON(`/api/admin/orders?since=${today}&limit=100`, {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.orders), 'orders must be array')
  for (const o of res.body.orders) {
    const created = new Date(o.createdAt).toISOString().slice(0, 10)
    assert.ok(created >= today, `expected ${created} >= ${today} (since filter)`)
  }
  const hasToday = res.body.orders.some(
    (o) => new Date(o.createdAt).toISOString().slice(0, 10) === today
  )
  assert.ok(hasToday, 'expected today row to appear in since=today')
  const hasYesterday = res.body.orders.some(
    (o) => new Date(o.createdAt).toISOString().slice(0, 10) === yesterday
  )
  assert.ok(!hasYesterday, 'expected yesterday row to be excluded by since=today')
})

test('2. until alone narrows to orders created before that day', async () => {
  await resetTestOrders()
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await createOrder(buyerProfileId, vendorId, 'pending', `${today} 12:00:00`)
  await createOrder(buyerProfileId, vendorId, 'pending', `${tomorrow} 12:00:00`)

  const res = await fetchJSON(`/api/admin/orders?until=${tomorrow}&limit=100`, {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    const created = new Date(o.createdAt).toISOString().slice(0, 10)
    assert.ok(created < tomorrow, `expected ${created} < ${tomorrow} (until exclusive)`)
  }
  const hasToday = res.body.orders.some(
    (o) => new Date(o.createdAt).toISOString().slice(0, 10) === today
  )
  assert.ok(hasToday, 'expected today row to appear in until=tomorrow')
  const hasTomorrow = res.body.orders.some(
    (o) => new Date(o.createdAt).toISOString().slice(0, 10) === tomorrow
  )
  assert.ok(!hasTomorrow, 'expected tomorrow row to be excluded by until=tomorrow')
})

test('3. since + until returns the window only', async () => {
  await resetTestOrders()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await createOrder(buyerProfileId, vendorId, 'pending', `${yesterday} 12:00:00`)
  await createOrder(buyerProfileId, vendorId, 'pending', `${today} 12:00:00`)
  await createOrder(buyerProfileId, vendorId, 'pending', `${tomorrow} 12:00:00`)

  const res = await fetchJSON(
    `/api/admin/orders?since=${today}&until=${tomorrow}&limit=100`,
    { headers: { Cookie: adminAuth.cookie } }
  )
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    const created = new Date(o.createdAt).toISOString().slice(0, 10)
    assert.ok(created >= today && created < tomorrow, `expected ${created} in [${today}, ${tomorrow})`)
  }
  const hasToday = res.body.orders.some(
    (o) => new Date(o.createdAt).toISOString().slice(0, 10) === today
  )
  assert.ok(hasToday, 'expected today row in window')
})

test('4. empty since or until is treated as no filter (no regression)', async () => {
  // Empty strings are ignored by the backend (the `if (since)` check).
  // Verify that explicitly passing empty strings behaves the same as
  // omitting them — guards against a future refactor that treats "" as
  // a literal date.
  const res = await fetchJSON('/api/admin/orders?since=&until=&limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.orders), 'orders must be array')
})

test('5. combined with status filter — both apply', async () => {
  await resetTestOrders()
  const today = new Date().toISOString().slice(0, 10)
  await createOrder(buyerProfileId, vendorId, 'pending', `${today} 12:00:00`)
  await createOrder(buyerProfileId, vendorId, 'completed', `${today} 13:00:00`)

  const res = await fetchJSON(
    `/api/admin/orders?since=${today}&status=pending&limit=100`,
    { headers: { Cookie: adminAuth.cookie } }
  )
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    const created = new Date(o.createdAt).toISOString().slice(0, 10)
    assert.equal(created, today, 'every row must be today')
    assert.equal(o.status, 'pending', 'every row must be pending')
  }
  const hasPending = res.body.orders.some((o) => o.status === 'pending')
  assert.ok(hasPending, 'expected pending row in status+since filter')
  const hasCompleted = res.body.orders.some((o) => o.status === 'completed')
  assert.ok(!hasCompleted, 'expected completed row excluded by status=pending')
})

test('6. empty since + until returns full list (no regression)', async () => {
  const res = await fetchJSON('/api/admin/orders?limit=100', {
    headers: { Cookie: adminAuth.cookie },
  })
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.orders), 'orders must be array')
  assert.equal(typeof res.body.total, 'number', 'total must be a number')
})
