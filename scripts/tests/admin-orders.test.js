/**
 * Tests for tier 6: admin orders oversight — list with filters + detail.
 *
 * Coverage:
 *   1. GET /api/admin/orders returns full payload with seeded orders
 *   2. status filter — only that status comes back
 *   3. vendorId filter — only that vendor's orders
 *   4. buyerId filter — only that buyer's orders
 *   5. minTotal/maxTotal filter — total range
 *   6. q search — buyer name + vendor name match
 *   7. GET /api/admin/orders/[id] returns detail with items + buyer/vendor
 *   8. GET /api/admin/orders/[id] surfaces related admin notes
 *   9. invalid status → 400
 *  10. invalid uuid → 400 (list & detail)
 *  11. detail 404 on non-existent uuid
 *  12. auth — no cookie → 401, buyer → 403
 *
 * Setup: seed 3 orders directly via DB: pending/accepted/cancelled,
 * one with minTotal 50k. Tests are order-independent (each filter
 * only asserts presence/absence), so test ordering doesn't matter.
 *
 * Run: node --test scripts/tests/admin-orders.test.js
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

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3005'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body, headers: res.headers }
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Cookie: `token=${token}`,
  }
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
    const email = `ci-test-admin-orders-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true) RETURNING id, email`,
      [email, hash, 'CI Admin Orders ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

async function loginAdmin(email) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register')`)
  } finally { await c.end() }

  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  })
  if (res.status !== 200) {
    throw new Error(`loginAdmin failed (${res.status}): ${JSON.stringify(res.body)}`)
  }
  const m = (res.headers.get('set-cookie') || '').match(/token=([^;]+)/)
  if (!m) throw new Error('loginAdmin: no token cookie')
  return m[1]
}

// Vendor seed that creates a vendor with a fresh seller account.
// Mirrors the helper used in tier 5.
async function seedVendorWithSeller(cityId = 'bogota') {
  const seller = await setupTestUser({ role: 'seller', cityId })
  const c = await dbClient()
  try {
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [seller.email]
    )
    const profileId = profileRes.rows[0]?.id
    if (!profileId) throw new Error('seedVendor: profile missing')
    const slug = `ci-orders-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase()
    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
       RETURNING id`,
      [profileId, 'CI Orders Vendor ' + crypto.randomBytes(3).toString('hex'), slug, cityId]
    )
    return { vendorId: v.rows[0].id, profileId, seller }
  } finally { await c.end() }
}

// Buyer that is the order's buyer. Mirrors setupTestUser but with role=buyer
async function seedBuyer(cityId = 'bogota') {
  const buyer = await setupTestUser({ role: 'buyer', cityId })
  const c = await dbClient()
  try {
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [buyer.email]
    )
    const profileId = profileRes.rows[0]?.id
    return { profileId, buyer }
  } finally { await c.end() }
}

async function seedOrder(buyerProfileId, vendorId, status, total) {
  const c = await dbClient()
  try {
    const r = await c.query(
      `INSERT INTO orders (buyer_id, vendor_id, total, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [buyerProfileId, vendorId, total, status]
    )
    return r.rows[0].id
  } finally { await c.end() }
}

let adminToken = null
let adminEmail = null
let cleanupDone = false

test('setup: admin + login', async () => {
  const admin = await createAdmin()
  adminEmail = admin.email
  adminToken = await loginAdmin(adminEmail)

  process.on('exit', () => {
    if (cleanupDone) return
    cleanupDone = true
    try {
      const c = new Client({
        host: DB_HOST, port: parseInt(DB_PORT || '5432', 10),
        database: DB_NAME, user: DB_USER, password: DB_PASSWORD,
      })
      c.connect().then(async () => {
        try {
          await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('admin_order_list', 'admin_order_detail', 'login', 'register')`)
          await c.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-orders-%'))`)
          await c.query(`DELETE FROM orders WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-orders-%')`)
          await c.query(`DELETE FROM vendors WHERE slug LIKE 'ci-orders-%'`)
          await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
        } catch {} finally {
          try { await c.end() } catch {}
        }
      }).catch(() => {})
    } catch {}
  })
})

test('1. GET /api/admin/orders returns full payload', async () => {
  const { vendorId, profileId: buyerProfileId } = await (async () => {
    const v = await seedVendorWithSeller()
    const b = await seedBuyer()
    await seedOrder(b.profileId, v.vendorId, 'pending', 12000)
    await seedOrder(b.profileId, v.vendorId, 'accepted', 25000)
    await seedOrder(b.profileId, v.vendorId, 'cancelled', 50000)
    return { vendorId: v.vendorId, profileId: b.profileId }
  })()

  // clear out other orders to make the count predictable
  const c = await dbClient()
  try {
    // Confirm our 3 orders exist; verify response shape
  } finally { await c.end() }

  const res = await fetchJSON('/api/admin/orders?limit=200', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200, `status=${res.status}`)
  assert.equal(typeof res.body.total, 'number')
  assert.ok(Array.isArray(res.body.orders))
  assert.ok(res.body.total >= 3, `expected ≥3 orders, got ${res.body.total}`)

  // Find our seeded orders
  const ourOrders = res.body.orders.filter((o) => o.vendor.id === vendorId)
  assert.equal(ourOrders.length, 3, `expected 3 of our orders, got ${ourOrders.length}`)

  // Each order has the required shape
  for (const o of ourOrders) {
    assert.equal(typeof o.id, 'string')
    assert.ok(['pending', 'accepted', 'ready', 'completed', 'cancelled'].includes(o.status))
    assert.equal(typeof o.total, 'number')
    assert.equal(typeof o.createdAt, 'string')
    assert.equal(o.buyer.id, buyerProfileId)
    assert.equal(o.vendor.id, vendorId)
    assert.equal(typeof o.itemCount, 'number')
  }
})

test('2. status filter', async () => {
  const v = await seedVendorWithSeller()
  const b = await seedBuyer()
  await seedOrder(b.profileId, v.vendorId, 'pending', 10000)
  await seedOrder(b.profileId, v.vendorId, 'completed', 20000)
  await seedOrder(b.profileId, v.vendorId, 'completed', 30000)

  const res = await fetchJSON('/api/admin/orders?status=completed&limit=200', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  // Every returned order has status=completed
  assert.ok(res.body.orders.length > 0)
  for (const o of res.body.orders) {
    assert.equal(o.status, 'completed', `unexpected status ${o.status}`)
  }
  // At least our two completed orders show up
  const ourCompleted = res.body.orders.filter((o) => o.vendor.id === v.vendorId)
  assert.equal(ourCompleted.length, 2, `expected 2 completed, got ${ourCompleted.length}`)
})

test('3. vendorId filter', async () => {
  const v1 = await seedVendorWithSeller()
  const v2 = await seedVendorWithSeller()
  const b = await seedBuyer()
  await seedOrder(b.profileId, v1.vendorId, 'pending', 5000)
  await seedOrder(b.profileId, v2.vendorId, 'pending', 6000)

  const res = await fetchJSON(`/api/admin/orders?vendorId=${v1.vendorId}&limit=200`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    assert.equal(o.vendor.id, v1.vendorId, `vendor leak: ${o.vendor.id}`)
  }
})

test('4. buyerId filter', async () => {
  const v = await seedVendorWithSeller()
  const b1 = await seedBuyer()
  const b2 = await seedBuyer()
  await seedOrder(b1.profileId, v.vendorId, 'pending', 5000)
  await seedOrder(b2.profileId, v.vendorId, 'pending', 6000)

  const res = await fetchJSON(`/api/admin/orders?buyerId=${b1.profileId}&limit=200`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    assert.equal(o.buyer.id, b1.profileId, `buyer leak: ${o.buyer.id}`)
  }
})

test('5. minTotal + maxTotal filter', async () => {
  const v = await seedVendorWithSeller()
  const b = await seedBuyer()
  await seedOrder(b.profileId, v.vendorId, 'pending', 10000)
  await seedOrder(b.profileId, v.vendorId, 'pending', 30000)
  await seedOrder(b.profileId, v.vendorId, 'pending', 80000)

  const res = await fetchJSON('/api/admin/orders?minTotal=20000&maxTotal=50000&limit=200', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  for (const o of res.body.orders) {
    assert.ok(o.total >= 20000 && o.total <= 50000,
      `out of range: total=${o.total}`)
  }
})

test('6. q search (buyer/vendor)', async () => {
  const v = await seedVendorWithSeller()
  const b = await seedBuyer()
  const orderId = await seedOrder(b.profileId, v.vendorId, 'pending', 9000)

  // Vendor name has "Orders" in it; buyer name is random from setupTestUser.
  // Try a substring of the city we used (bogota setup typically yields
  // names with timestamp/random suffix). Use a unique suffix from the
  // vendor slug instead.
  const c = await dbClient()
  let vendorSlug
  try {
    const r = await c.query(`SELECT slug FROM vendors WHERE id = $1`, [v.vendorId])
    vendorSlug = r.rows[0]?.slug
  } finally { await c.end() }

  // Search by a unique vendor-name token — 'Orders' is generic; use
  // a substring of the slug (it contains 'ci-orders') so we test the
  // vendor.slug LIKE branch.
  const res = await fetchJSON('/api/admin/orders?q=ci-orders&limit=200', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  assert.ok(res.body.orders.length > 0, `expected at least one match, got ${res.body.orders.length}`)

  // Every matched vendor slug contains 'ci-orders'
  for (const o of res.body.orders) {
    assert.ok(o.vendor.slug.includes('ci-orders') ||
              (o.buyer.name && o.buyer.name.toLowerCase().includes('ci-orders')) ||
              (o.buyer.email && o.buyer.email.toLowerCase().includes('ci-orders')),
      `q='ci-orders' matched unrelated order: ${o.vendor.slug} / ${o.buyer.email}`)
  }
})

test('7. GET /api/admin/orders/[id] returns detail', async () => {
  const v = await seedVendorWithSeller()
  const b = await seedBuyer()
  const orderId = await seedOrder(b.profileId, v.vendorId, 'completed', 42000)

  const res = await fetchJSON(`/api/admin/orders/${orderId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200, `status=${res.status} body=${JSON.stringify(res.body)}`)

  assert.equal(res.body.order.id, orderId)
  assert.equal(res.body.order.status, 'completed')
  assert.equal(res.body.order.total, 42000)
  assert.equal(typeof res.body.order.createdAt, 'string')

  assert.equal(res.body.buyer.id, b.profileId)
  assert.equal(typeof res.body.buyer.name, 'string')
  assert.equal(typeof res.body.buyer.email, 'string')

  assert.equal(res.body.vendor.id, v.vendorId)
  assert.equal(typeof res.body.vendor.name, 'string')
  assert.equal(typeof res.body.vendor.slug, 'string')
  assert.equal(typeof res.body.vendor.ownerName, 'string')

  assert.ok(Array.isArray(res.body.items))
  assert.ok(Array.isArray(res.body.related.notes))
})

test('8. GET /api/admin/orders/[id] surfaces related admin notes', async () => {
  const v = await seedVendorWithSeller()
  const b = await seedBuyer()
  const orderId = await seedOrder(b.profileId, v.vendorId, 'pending', 15000)

  // Write a vendor note (target_type='vendor', target_id=vendorId)
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      targetType: 'vendor',
      targetId: v.vendorId,
      body: 'Vendor escaló queja sobre este pedido ' + SUFFIX,
    }),
  })
  // And a buyer note (target_type='user', target_id=userId — admin_notes
  // stores users.id for user-type notes, not profiles.id)
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      targetType: 'user',
      targetId: b.buyer.userId,
      body: 'Cliente reincidente — verificar ' + SUFFIX,
    }),
  })

  const res = await fetchJSON(`/api/admin/orders/${orderId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  assert.ok(res.body.related.notes.length >= 2,
    `expected ≥2 related notes, got ${res.body.related.notes.length}`)
  for (const n of res.body.related.notes) {
    assert.ok(['user', 'vendor'].includes(n.targetType))
    assert.equal(typeof n.body, 'string')
    assert.equal(typeof n.authorName, 'string')
  }
})

test('9. invalid status → 400', async () => {
  const res = await fetchJSON('/api/admin/orders?status=foo', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 400)
})

test('10. invalid uuid (list & detail) → 400', async () => {
  const list = await fetchJSON('/api/admin/orders?vendorId=not-a-uuid', {
    headers: authHeaders(adminToken),
  })
  assert.equal(list.status, 400)

  const detail = await fetchJSON('/api/admin/orders/not-a-uuid', {
    headers: authHeaders(adminToken),
  })
  assert.equal(detail.status, 400)
})

test('11. detail 404 on non-existent uuid', async () => {
  const res = await fetchJSON(
    '/api/admin/orders/00000000-0000-0000-0000-000000000000',
    { headers: authHeaders(adminToken) }
  )
  assert.equal(res.status, 404)
})

test('12. auth — no cookie → 401, buyer → 403', async () => {
  const noAuth = await fetchJSON('/api/admin/orders')
  assert.equal(noAuth.status, 401)

  const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
  const buyerAttempt = await fetchJSON('/api/admin/orders', {
    headers: authHeaders(buyer.token),
  })
  assert.equal(buyerAttempt.status, 403, `expected 403, got ${buyerAttempt.status}`)
})