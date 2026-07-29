/**
 * Tier 6 smoke test — end-to-end against a running `next dev`.
 *
 * Walks the operator flow on the orders tab:
 *   1. Setup: admin + buyer + seller + 3 seeded orders
 *   2. Login admin → cookie
 *   3. GET /api/admin/orders?limit=200 → list with seeded orders
 *   4. Status filter → only pending orders
 *   5. vendorId filter → only our vendor's orders
 *   6. buyerId filter → only our buyer's orders
 *   7. minTotal + maxTotal range
 *   8. q search (vendor slug)
 *   9. GET /api/admin/orders/[id] → detail with items + buyer/vendor
 *  10. Related notes — POST 2 notes (1 buyer, 1 vendor) and confirm
 *      both surface in the order detail's related.notes
 *  11. Audit log — admin_audit_log has view_order_list + view_order_detail
 *  12. /admin page returns 200 with admin cookie (regression on tier 1)
 *  13. Negative: buyer cookie on /api/admin/orders → 403
 *  14. Negative: no cookie → 401
 *  15. Negative: invalid status → 400
 *
 * Run: node scripts/tests/_smoke-tier6.js http://localhost:3008
 */

const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/gps-street-sellers/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/gps-street-sellers/apps/web/.env'),
})
const { setupTestUser } = require('./_lib/seed')

const BASE = process.argv[2] || 'http://localhost:3008'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const PASSWORD = 'TestPassword123'

let passed = 0
let failed = 0
const assertions = []

function assert(label, cond, detail = '') {
  if (cond) {
    passed++
    assertions.push({ ok: true, label })
    console.log(`  ok  ${label}`)
  } else {
    failed++
    assertions.push({ ok: false, label, detail })
    console.log(`  FAIL ${label}  ${detail}`)
  }
}

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body, headers: res.headers }
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Cookie: `token=${token}` }
}

async function dbClient() {
  const c = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'gps_street_sellers',
    user: process.env.DB_USER || 'postgres',
    password: typeof process.env.DB_PASSWORD === 'string' ? process.env.DB_PASSWORD : 'postgres',
  })
  await c.connect()
  return c
}

async function createAdmin() {
  const c = await dbClient()
  try {
    const email = `ci-smoke6-admin-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true) RETURNING id, email`,
      [email, hash, 'CI Smoke6 Admin ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

async function createBuyer() {
  const c = await dbClient()
  try {
    const email = `ci-smoke6-buyer-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'buyer', true) RETURNING id, email`,
      [email, hash, 'CI Smoke6 Buyer ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

async function loginAdmin(email) {
  const c = await dbClient()
  // Include 'login_account' — the per-identifier bucket added in S1-SEC-1.
  try { await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`) } finally { await c.end() }
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`admin login ${res.status}: ${JSON.stringify(res.body)}`)
  const m = (res.headers.get('set-cookie') || '').match(/token=([^;]+)/)
  if (!m) throw new Error('admin login: no token cookie')
  return m[1]
}

async function loginBuyer(email) {
  const c = await dbClient()
  // Include 'login_account' — the per-identifier bucket added in S1-SEC-1.
  try { await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`) } finally { await c.end() }
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`buyer login ${res.status}: ${JSON.stringify(res.body)}`)
  const m = (res.headers.get('set-cookie') || '').match(/token=([^;]+)/)
  if (!m) throw new Error('buyer login: no token cookie')
  return m[1]
}

async function setupVendorWithBuyer() {
  const seller = await setupTestUser({ role: 'seller', cityId: 'bogota' })
  const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
  const c = await dbClient()
  let vendorId, profileId, buyerProfileId, buyerUserId
  try {
    const profileRes = await c.query(`SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [seller.email])
    profileId = profileRes.rows[0]?.id
    const buyerProfileRes = await c.query(`SELECT id, user_id FROM profiles WHERE email = $1 LIMIT 1`, [buyer.email])
    buyerProfileId = buyerProfileRes.rows[0]?.id
    buyerUserId = buyerProfileRes.rows[0]?.user_id

    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
       RETURNING id`,
      [profileId, 'CI Smoke6 Vendor ' + SUFFIX,
       `ci-smoke6-${SUFFIX}`.toLowerCase(), 'bogota']
    )
    vendorId = v.rows[0].id

    // 3 orders: 1 pending 12k, 1 accepted 25k, 1 cancelled 50k
    await c.query(`INSERT INTO orders (buyer_id, vendor_id, total, status) VALUES ($1, $2, 12000, 'pending')`, [buyerProfileId, vendorId])
    await c.query(`INSERT INTO orders (buyer_id, vendor_id, total, status) VALUES ($1, $2, 25000, 'accepted')`, [buyerProfileId, vendorId])
    const orderRes = await c.query(
      `INSERT INTO orders (buyer_id, vendor_id, total, status) VALUES ($1, $2, 50000, 'cancelled') RETURNING id`,
      [buyerProfileId, vendorId]
    )
    const orderId = orderRes.rows[0].id
    return { vendorId, profileId, buyerProfileId, buyerUserId, orderId, sellerEmail: seller.email, buyerEmail: buyer.email }
  } finally { await c.end() }
}

async function cleanup(adminEmail, buyerEmail, sellerEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('admin_note_action', 'admin_order_list', 'admin_order_detail')`)
    await c.query(`DELETE FROM admin_notes WHERE author_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-smoke6-%'))`)
    await c.query(`DELETE FROM orders WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-smoke6-%')`)
    await c.query(`DELETE FROM vendors WHERE profile_id IN (SELECT id FROM profiles WHERE email = $1)`, [sellerEmail])
    await c.query(`DELETE FROM profiles WHERE email = ANY($1::text[])`, [[adminEmail, buyerEmail, sellerEmail]])
    await c.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[adminEmail, buyerEmail, sellerEmail]])
  } finally { await c.end() }
}

async function main() {
  console.log(`\nsmoke-tier6 @ ${BASE}\n`)

  // 0. setup
  console.log('[0] setup')
  const admin = await createAdmin()
  const buyerU = await createBuyer()
  const adminToken = await loginAdmin(admin.email)
  const buyerToken = await loginBuyer(buyerU.email)
  const { vendorId, buyerProfileId, buyerUserId, orderId, sellerEmail, buyerEmail } = await setupVendorWithBuyer()
  assert('admin created + logged in', adminToken.length > 10)
  assert('buyer created + logged in', buyerToken.length > 10)
  assert('seeded vendor + 3 orders exist', typeof vendorId === 'string')

  // 1. list with full payload
  console.log('\n[1] GET /api/admin/orders (list)')
  const list = await fetchJSON('/api/admin/orders?limit=200', { headers: authHeaders(adminToken) })
  assert('GET list returns 200', list.status === 200)
  assert('list returns array', Array.isArray(list.body.orders))
  const ourOrders = list.body.orders.filter((o) => o.vendor.id === vendorId)
  assert('our 3 seeded orders present', ourOrders.length === 3, `got ${ourOrders.length}`)
  for (const o of ourOrders) {
    assert(`order ${o.status} has required shape`,
      typeof o.id === 'string' && typeof o.total === 'number' &&
      typeof o.createdAt === 'string' && typeof o.itemCount === 'number' &&
      o.buyer.id === buyerProfileId && o.vendor.id === vendorId)
  }

  // 2. status filter
  console.log('\n[2] status=pending filter')
  const pending = await fetchJSON('/api/admin/orders?status=pending&limit=200', { headers: authHeaders(adminToken) })
  assert('pending filter returns 200', pending.status === 200)
  for (const o of pending.body.orders) {
    assert(`only pending in filter (${o.status})`, o.status === 'pending')
  }
  const ourPending = pending.body.orders.filter((o) => o.vendor.id === vendorId)
  assert('our 1 pending order surfaces', ourPending.length === 1, `got ${ourPending.length}`)

  // 3. vendorId filter
  console.log('\n[3] vendorId filter')
  const byVendor = await fetchJSON(`/api/admin/orders?vendorId=${vendorId}&limit=200`, { headers: authHeaders(adminToken) })
  assert('vendorId filter returns 200', byVendor.status === 200)
  for (const o of byVendor.body.orders) {
    assert(`only our vendor (${o.vendor.id} vs ${vendorId})`, o.vendor.id === vendorId)
  }

  // 4. buyerId filter
  console.log('\n[4] buyerId filter')
  const byBuyer = await fetchJSON(`/api/admin/orders?buyerId=${buyerProfileId}&limit=200`, { headers: authHeaders(adminToken) })
  assert('buyerId filter returns 200', byBuyer.status === 200)
  for (const o of byBuyer.body.orders) {
    assert(`only our buyer (${o.buyer.id} vs ${buyerProfileId})`, o.buyer.id === buyerProfileId)
  }

  // 5. minTotal + maxTotal
  console.log('\n[5] minTotal + maxTotal range')
  const range = await fetchJSON('/api/admin/orders?minTotal=20000&maxTotal=30000&limit=200', { headers: authHeaders(adminToken) })
  assert('range filter returns 200', range.status === 200)
  for (const o of range.body.orders) {
    assert(`order total in range (${o.total})`, o.total >= 20000 && o.total <= 30000)
  }

  // 6. q search
  console.log('\n[6] q=ci-smoke6 search')
  const q = await fetchJSON('/api/admin/orders?q=ci-smoke6&limit=200', { headers: authHeaders(adminToken) })
  assert('q filter returns 200', q.status === 200)
  assert('q matches our vendor', q.body.orders.length > 0)
  for (const o of q.body.orders) {
    assert(`q match makes sense (${o.vendor.slug})`,
      o.vendor.slug.includes('ci-smoke6') ||
      (o.buyer.name || '').toLowerCase().includes('ci-smoke6') ||
      (o.buyer.email || '').toLowerCase().includes('ci-smoke6'))
  }

  // 7. detail
  console.log('\n[7] GET /api/admin/orders/[id]')
  const detail = await fetchJSON(`/api/admin/orders/${orderId}`, { headers: authHeaders(adminToken) })
  assert('GET detail returns 200', detail.status === 200)
  assert('detail.order.id matches', detail.body.order.id === orderId)
  assert('detail.order.status is cancelled', detail.body.order.status === 'cancelled')
  assert('detail.order.total is 50000', detail.body.order.total === 50000)
  assert('detail.buyer.id matches', detail.body.buyer.id === buyerProfileId)
  assert('detail.vendor.id matches', detail.body.vendor.id === vendorId)
  assert('detail.items is array', Array.isArray(detail.body.items))
  assert('detail.related.notes is array', Array.isArray(detail.body.related.notes))

  // 8. related notes (write 2 notes, expect 2 in detail)
  console.log('\n[8] related admin notes')
  await fetchJSON('/api/admin/notes', {
    method: 'POST', headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: `Vendor escaló queja ${SUFFIX}` }),
  })
  await fetchJSON('/api/admin/notes', {
    method: 'POST', headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyerUserId, body: `Cliente reincidente ${SUFFIX}` }),
  })
  const detail2 = await fetchJSON(`/api/admin/orders/${orderId}`, { headers: authHeaders(adminToken) })
  assert('2 related notes surface', detail2.body.related.notes.length === 2, `got ${detail2.body.related.notes.length}`)
  const types = new Set(detail2.body.related.notes.map((n) => n.targetType))
  assert('notes cover both target types', types.has('vendor') && types.has('user'),
    `types=${JSON.stringify([...types])}`)

  // 9. audit log entries
  console.log('\n[9] admin_audit_log entries')
  const c = await dbClient()
  let auditCounts
  try {
    const r = await c.query(
      `SELECT action, COUNT(*)::int AS c FROM admin_audit_log
       WHERE admin_id = (SELECT id FROM users WHERE email = $1)
         AND action IN ('view_order_list', 'view_order_detail')
       GROUP BY action`,
      [admin.email]
    )
    auditCounts = Object.fromEntries(r.rows.map((row) => [row.action, row.c]))
  } finally { await c.end() }
  assert('view_order_list audited', (auditCounts.view_order_list || 0) >= 1,
    `count=${auditCounts.view_order_list || 0}`)
  assert('view_order_detail audited', (auditCounts.view_order_detail || 0) >= 2,
    `count=${auditCounts.view_order_detail || 0}`)

  // 10. /admin page regression
  console.log('\n[10] /admin page reachable')
  const page = await fetch(`${BASE}/admin`, {
    headers: { Cookie: `token=${adminToken}` }, redirect: 'manual',
  })
  assert('/admin returns 200', page.status === 200, `status=${page.status}`)

  // 11. negatives
  console.log('\n[11] buyer → 403')
  const buyerAttempt = await fetchJSON('/api/admin/orders', { headers: authHeaders(buyerToken) })
  assert('buyer cookie → 403', buyerAttempt.status === 403, `status=${buyerAttempt.status}`)

  console.log('\n[12] no auth → 401')
  const noAuth = await fetchJSON('/api/admin/orders')
  assert('no cookie → 401', noAuth.status === 401, `status=${noAuth.status}`)

  console.log('\n[13] invalid status → 400')
  const invalid = await fetchJSON('/api/admin/orders?status=foo', { headers: authHeaders(adminToken) })
  assert('status=foo → 400', invalid.status === 400, `status=${invalid.status}`)

  // cleanup
  await cleanup(admin.email, buyerEmail, sellerEmail)

  console.log(`\n${passed} passed, ${failed} failed of ${passed + failed} assertions`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('smoke-tier6 crashed:', e.message)
  console.error(e.stack)
  process.exit(2)
})