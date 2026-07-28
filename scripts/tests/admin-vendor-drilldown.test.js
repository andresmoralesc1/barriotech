/**
 * Tests for tier 5: vendor drill-down — recent reviews, review stats,
 * active sponsorship, order stats, admin notes (target_type='vendor').
 *
 * Coverage:
 *   1. GET /api/admin/vendors/[id] returns new fields with a real review
 *      and an active sponsorship
 *   2. GET returns zero-state when vendor has no reviews/sponsorship/orders
 *   3. GET excludes soft-deleted vendors by default; ?includeDeleted=true
 *      surfaces them (regression on tier-2 contract)
 *   4. POST /api/admin/notes with target_type='vendor' works
 *   5. GET /api/admin/notes?targetType=vendor&targetId=... returns those notes
 *   6. DELETE /api/admin/notes/[id] soft-deletes a vendor note
 *   7. Auth: no cookie on /api/admin/vendors/[id] → 401
 *   8. Auth: buyer role → 403
 *   9. invalid uuid on /api/admin/vendors/[id] → 400
 *
 * Setup: a fresh admin + a fresh seller/vendor. We seed reviews,
 * orders, and a sponsorship directly via DB so the test is
 * deterministic and independent of public endpoints that the
 * vendor-side UI doesn't expose.
 *
 * Run: node --test scripts/tests/admin-vendor-drilldown.test.js
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
    const email = `ci-test-admin-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id, email`,
      [email, hash, 'CI Admin Drilldown ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally {
    await c.end()
  }
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
  const setCookie = res.headers.get('set-cookie') || ''
  const m = setCookie.match(/token=([^;]+)/)
  if (!m) throw new Error('loginAdmin: no token cookie')
  return m[1]
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Cookie: `token=${token}`,
  }
}

async function resetDrilldownState(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
    await c.query(
      `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
    await c.query(
      `DELETE FROM admin_notes WHERE author_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
  } finally { await c.end() }
}

async function createVendorWithData() {
  // Build a fresh seller+profile+vendor with seeded reviews, orders,
  // and an active sponsorship. We bypass the public register/vendor
  // endpoints because the public flow doesn't expose seeding these
  // rows. Direct DB insert is fine — the same pattern as the
  // setupTestVendor helper in seed.js, plus reviews/orders/sponsorships.
  const seller = await setupTestUser({ role: 'seller', cityId: 'bogota' })
  // Slug must be unique per test call (not per file run), since each
  // test creates its own vendor and re-runs would collide on
  // idx_vendors_slug_unique.
  const callSuffix = crypto.randomBytes(3).toString('hex')
  const c = await dbClient()
  let vendorId
  let profileId
  try {
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`,
      [seller.email]
    )
    profileId = profileRes.rows[0]?.id
    if (!profileId) throw new Error('profile missing after seller register')

    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
       RETURNING id`,
      [profileId, 'CI Drilldown Vendor ' + callSuffix,
       `ci-drilldown-${SUFFIX}-${callSuffix}`.toLowerCase(), 'bogota']
    )
    vendorId = v.rows[0].id

    // Seed 7 reviews with mixed ratings so distribution & average have signal
    for (const r of [5, 5, 4, 4, 3, 2, 1]) {
      await c.query(
        `INSERT INTO reviews (vendor_id, author_name, rating, comment, created_at)
         VALUES ($1, $2, $3, $4, NOW() - ($5 || ' minutes')::interval)`,
        [vendorId, `Reviewer ${r}`, r, `Test comment rating ${r}`, String(Math.floor(Math.random() * 60))]
      )
    }

    // Seed 5 orders (3 in the last 30 days, 2 older)
    for (let i = 0; i < 5; i++) {
      const ageDays = i < 3 ? i + 1 : 60 + i
      await c.query(
        `INSERT INTO orders (buyer_id, vendor_id, total, status, created_at)
         VALUES ($1, $2, $3, 'completed', NOW() - ($4 || ' days')::interval)`,
        [profileId, vendorId, 15000 + i * 1000, String(ageDays)]
      )
    }

    // Seed an active sponsorship (semanal, ends in 5 days)
    await c.query(
      `INSERT INTO sponsorships (vendor_id, plan, amount_cents, starts_at, ends_at, status)
       VALUES ($1, 'semanal', 5000000, NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', 'active')`,
      [vendorId]
    )
  } finally {
    await c.end()
  }
  return { vendorId, sellerEmail: seller.email, profileId }
}

let adminEmail = null
let adminToken = null
let cleanupDone = false

test('setup: create admin + login', async () => {
  const admin = await createAdmin()
  adminEmail = admin.email
  adminToken = await loginAdmin(adminEmail)
  process.on('exit', () => {
    if (cleanupDone) return
    cleanupDone = true
    try {
      const c = new Client({
        host: DB_HOST,
        port: parseInt(DB_PORT || '5432', 10),
        database: DB_NAME,
        user: DB_USER,
        password: DB_PASSWORD,
      })
      c.connect().then(async () => {
        try {
          await c.query(
            `DELETE FROM admin_notes WHERE author_id = (SELECT id FROM users WHERE email = $1)`,
            [adminEmail]
          )
          await c.query(
            `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
            [adminEmail]
          )
          await c.query(
            `DELETE FROM reviews WHERE author_name LIKE 'Reviewer %'`
          )
          await c.query(
            `DELETE FROM sponsorships WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-drilldown-%')`
          )
          await c.query(
            `DELETE FROM orders WHERE vendor_id IN (SELECT id FROM vendors WHERE slug LIKE 'ci-drilldown-%')`
          )
          await c.query(
            `DELETE FROM vendors WHERE slug LIKE 'ci-drilldown-%'`
          )
          await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
          await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
        } catch {} finally {
          try { await c.end() } catch {}
        }
      }).catch(() => {})
    } catch {}
  })
})

test('1. GET vendor detail: enriched payload (reviews + sponsorship + orders)', async () => {
  await resetDrilldownState(adminEmail)
  const { vendorId } = await createVendorWithData()

  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200, `status ${res.status} body=${JSON.stringify(res.body)}`)
  const v = res.body.vendor

  // Base fields still present
  assert.equal(v.id, vendorId)
  assert.equal(typeof v.productCount, 'number')

  // recentReviews: array, length up to 5
  assert.ok(Array.isArray(v.recentReviews), 'recentReviews should be array')
  assert.ok(v.recentReviews.length > 0, 'recentReviews should be > 0')
  assert.ok(v.recentReviews.length <= 5, 'recentReviews should be <= 5')
  for (const rv of v.recentReviews) {
    assert.equal(typeof rv.id, 'string')
    assert.equal(typeof rv.rating, 'number')
    assert.equal(typeof rv.authorName, 'string')
    assert.equal(typeof rv.createdAt, 'string')
  }

  // reviewStats: 7 total, distribution matches seeded ratings
  assert.equal(v.reviewStats.total, 7, `total expected 7, got ${v.reviewStats.total}`)
  // seeded [5, 5, 4, 4, 3, 2, 1] → distribution {1:1, 2:1, 3:1, 4:2, 5:2}
  assert.equal(v.reviewStats.distribution[1], 1, `r1=${v.reviewStats.distribution[1]}`)
  assert.equal(v.reviewStats.distribution[2], 1)
  assert.equal(v.reviewStats.distribution[3], 1)
  assert.equal(v.reviewStats.distribution[4], 2)
  assert.equal(v.reviewStats.distribution[5], 2)
  // average: (5+5+4+4+3+2+1)/7 = 24/7 ≈ 3.43
  assert.ok(Math.abs(v.reviewStats.averageRating - 3.43) < 0.01,
    `avg expected ~3.43, got ${v.reviewStats.averageRating}`)

  // activeSponsorship
  assert.ok(v.activeSponsorship, 'activeSponsorship should be set')
  assert.equal(v.activeSponsorship.plan, 'semanal')
  assert.equal(v.activeSponsorship.amountCents, 5000000)
  assert.equal(v.activeSponsorship.status, 'active')
  // daysRemaining should be between 0 and 5 inclusive (we set ends_at = NOW() + 5d)
  assert.ok(v.activeSponsorship.daysRemaining >= 0 && v.activeSponsorship.daysRemaining <= 5,
    `daysRemaining=${v.activeSponsorship.daysRemaining}`)

  // orderStats: 5 total, 3 in last 30 days
  assert.equal(v.orderStats.total, 5, `total=${v.orderStats.total}`)
  assert.equal(v.orderStats.last30Days, 3, `last30Days=${v.orderStats.last30Days}`)
})

test('2. GET vendor detail: zero-state when vendor has no reviews/sponsorships/orders', async () => {
  await resetDrilldownState(adminEmail)
  // Create a bare vendor via the public seller flow (no reviews/orders/sponsorships)
  const seller = await setupTestUser({ role: 'seller', cityId: 'bogota' })
  const c = await dbClient()
  let vendorId
  try {
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`,
      [seller.email]
    )
    const profileId = profileRes.rows[0]?.id
    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
       RETURNING id`,
      [profileId, 'CI Bare Vendor ' + crypto.randomBytes(3).toString('hex'),
       `ci-bare-${SUFFIX}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase(), 'bogota']
    )
    vendorId = v.rows[0].id
  } finally { await c.end() }

  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const v = res.body.vendor
  assert.equal(v.recentReviews.length, 0)
  assert.equal(v.reviewStats.total, 0)
  assert.equal(v.reviewStats.averageRating, 0)
  assert.equal(v.reviewStats.distribution[1], 0)
  assert.equal(v.reviewStats.distribution[5], 0)
  assert.equal(v.activeSponsorship, null)
  assert.equal(v.orderStats.total, 0)
  assert.equal(v.orderStats.last30Days, 0)
})

test('3. soft-deleted vendor is hidden by default, ?includeDeleted=true surfaces it', async () => {
  const { vendorId } = await createVendorWithData()
  // Soft-delete via DB
  const c = await dbClient()
  try {
    await c.query(`UPDATE vendors SET deleted_at = NOW() WHERE id = $1`, [vendorId])
  } finally { await c.end() }

  const hidden = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(hidden.status, 404, `expected 404 for soft-deleted, got ${hidden.status}`)

  const visible = await fetchJSON(`/api/admin/vendors/${vendorId}?includeDeleted=true`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(visible.status, 200, `expected 200 with includeDeleted, got ${visible.status}`)
  assert.equal(visible.body.vendor.deletedAt !== null, true)
})

test('4. POST note with target_type=vendor → 201', async () => {
  await resetDrilldownState(adminEmail)
  const { vendorId } = await createVendorWithData()
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      targetType: 'vendor',
      targetId: vendorId,
      body: 'Vendor escaló queja de cliente. ' + SUFFIX,
    }),
  })
  assert.equal(res.status, 201, `status ${res.status} body=${JSON.stringify(res.body)}`)
  assert.equal(res.body.note.target_type, 'vendor')
  assert.equal(res.body.note.target_id, vendorId)
})

test('5. GET notes?targetType=vendor returns vendor notes', async () => {
  await resetDrilldownState(adminEmail)
  const { vendorId } = await createVendorWithData()
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: 'primera vendor' }),
  })
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: 'segunda vendor' }),
  })
  const res = await fetchJSON(`/api/admin/notes?targetType=vendor&targetId=${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.notes.length, 2)
  assert.equal(res.body.notes[0].body, 'segunda vendor', 'newest first')
})

test('6. DELETE soft-deletes a vendor note', async () => {
  await resetDrilldownState(adminEmail)
  const { vendorId } = await createVendorWithData()
  const create = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: 'borrame vendor' }),
  })
  const noteId = create.body.note.id
  const del = await fetchJSON(`/api/admin/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  })
  assert.equal(del.status, 200)
  const list = await fetchJSON(`/api/admin/notes?targetType=vendor&targetId=${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(list.body.notes.length, 0)
})

test('7. no auth → 401', async () => {
  const { vendorId } = await createVendorWithData()
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`)
  assert.equal(res.status, 401)
})

test('8. buyer role → 403', async () => {
  const { vendorId } = await createVendorWithData()
  const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(buyer.token),
  })
  assert.equal(res.status, 403, `expected 403, got ${res.status}`)
})

test('9. invalid uuid → 400', async () => {
  const res = await fetchJSON('/api/admin/vendors/not-a-uuid', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 400)
})
