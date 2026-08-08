/**
 * Tier 5 smoke test — end-to-end against a running `next dev`.
 *
 * Walks the operator flow on the vendor detail drawer:
 *   1. Login as admin (cookie-based auth)
 *   2. Load /admin/vendors, find a vendor that has seeded reviews
 *      and an active sponsorship
 *   3. GET /api/admin/vendors/[id] returns the enriched payload
 *      (reviewStats.distribution matches, activeSponsorship is set,
 *      orderStats.total > 0)
 *   4. POST a vendor note → 201, then list it
 *   5. DELETE the note → 200, then list to confirm it soft-deletes
 *   6. Write a second note + log in audit_log as add_admin_note
 *   7. GET /admin/vendors as the same admin → 200 (regression on
 *      tier-1 route)
 *   8. Negative: buyer cookie on /api/admin/vendors/[id] → 403
 *   9. Negative: no cookie on /api/admin/vendors/[id] → 401
 *
 * Run: node scripts/tests/_smoke-tier5.js http://localhost:3008
 */

const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/barriotech/apps/web/.env'),
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
  return {
    'Content-Type': 'application/json',
    Cookie: `token=${token}`,
  }
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

async function setupAdmin() {
  const c = await dbClient()
  try {
    const email = `ci-smoke5-admin-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true) RETURNING id, email`,
      [email, hash, 'CI Smoke5 Admin ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

async function setupBuyer() {
  const c = await dbClient()
  try {
    const email = `ci-smoke5-buyer-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'buyer', true) RETURNING id, email`,
      [email, hash, 'CI Smoke5 Buyer ' + SUFFIX]
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
  if (res.status !== 200) throw new Error(`admin login ${res.status}: ${JSON.stringify(res.body)}`)
  const m = (res.headers.get('set-cookie') || '').match(/token=([^;]+)/)
  if (!m) throw new Error('admin login: no token cookie')
  return m[1]
}

async function loginBuyer(email) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`)
  } finally { await c.end() }

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

async function setupVendorWithData() {
  // Mirrors the test file helper — register a seller via the public
  // flow (using setupTestUser so acceptTerms/privacy plumbing is
  // handled for us), then attach a vendor + reviews + orders +
  // sponsorship directly via DB.
  const seller = await setupTestUser({ role: 'seller', cityId: 'bogota' })
  const c = await dbClient()
  let vendorId
  let profileId
  try {
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [seller.email]
    )
    profileId = profileRes.rows[0]?.id
    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
       RETURNING id`,
      [profileId, 'CI Smoke5 Vendor ' + SUFFIX,
       `ci-smoke5-${SUFFIX}`.toLowerCase(), 'bogota']
    )
    vendorId = v.rows[0].id
    for (const r of [5, 5, 4, 4, 3, 2, 1]) {
      await c.query(
        `INSERT INTO reviews (vendor_id, author_name, rating, comment, created_at)
         VALUES ($1, $2, $3, $4, NOW() - ($5 || ' minutes')::interval)`,
        [vendorId, `Reviewer ${r}`, r, `Smoke5 comment rating ${r}`, String(Math.floor(Math.random() * 60))]
      )
    }
    for (let i = 0; i < 5; i++) {
      const ageDays = i < 3 ? i + 1 : 60 + i
      await c.query(
        `INSERT INTO orders (buyer_id, vendor_id, total, status, created_at)
         VALUES ($1, $2, $3, 'completed', NOW() - ($4 || ' days')::interval)`,
        [profileId, vendorId, 15000 + i * 1000, String(ageDays)]
      )
    }
    await c.query(
      `INSERT INTO sponsorships (vendor_id, plan, amount_cents, starts_at, ends_at, status)
       VALUES ($1, 'semanal', 5000000, NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', 'active')`,
      [vendorId]
    )
  } finally { await c.end() }
  return { vendorId, sellerEmail: seller.email }
}

async function cleanup(adminEmail, buyerEmail, sellerEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
    await c.query(`DELETE FROM admin_notes WHERE author_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM reviews WHERE author_name LIKE 'Reviewer %'`)
    // The seller registration auto-bootstraps a vendor via geo-bootstrap
    // (slug `mi-negocio-de-test-bogota-*`), which also FKs to the same
    // profile. We must wipe every vendor tied to that profile, not just
    // our `ci-smoke5-%` test vendor — otherwise the profile DELETE below
    // is blocked by vendors_profile_id_fkey.
    await c.query(
      `DELETE FROM sponsorships WHERE vendor_id IN (
         SELECT id FROM vendors WHERE profile_id IN (
           SELECT id FROM profiles WHERE email = $1
         )
       )`,
      [sellerEmail]
    )
    await c.query(
      `DELETE FROM orders WHERE vendor_id IN (
         SELECT id FROM vendors WHERE profile_id IN (
           SELECT id FROM profiles WHERE email = $1
         )
       )`,
      [sellerEmail]
    )
    await c.query(
      `DELETE FROM vendors WHERE profile_id IN (SELECT id FROM profiles WHERE email = $1)`,
      [sellerEmail]
    )
    // Delete profiles BEFORE users because users DELETE cascades to
    // profiles, but a leftover vendor.profile_id would block it.
    await c.query(`DELETE FROM profiles WHERE email = ANY($1::text[])`, [[adminEmail, buyerEmail, sellerEmail]])
    await c.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[adminEmail, buyerEmail, sellerEmail]])
  } finally { await c.end() }
}

async function main() {
  console.log(`\nsmoke-tier5 @ ${BASE}\n`)

  // 0. setup
  console.log('[0] setup')
  const admin = await setupAdmin()
  const buyer = await setupBuyer()
  const adminToken = await loginAdmin(admin.email)
  const buyerToken = await loginBuyer(buyer.email)
  const { vendorId, sellerEmail } = await setupVendorWithData()
  assert('admin created + logged in', adminToken.length > 10)
  assert('buyer created + logged in', buyerToken.length > 10)
  assert('seeded vendor exists', typeof vendorId === 'string')

  // 1. admin GET enriched payload
  console.log('\n[1] GET /api/admin/vendors/[id] enriched payload')
  const detail = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert('GET vendor detail returns 200', detail.status === 200, `status=${detail.status}`)
  const v = detail.body.vendor
  assert('recentReviews is non-empty array', Array.isArray(v.recentReviews) && v.recentReviews.length > 0)
  assert('recentReviews length <= 5', v.recentReviews.length <= 5)
  assert('reviewStats.total matches seeded reviews', v.reviewStats.total === 7, `total=${v.reviewStats.total}`)
  assert('reviewStats.distribution[5] === 2', v.reviewStats.distribution[5] === 2, `d5=${v.reviewStats.distribution[5]}`)
  assert('reviewStats.distribution[1] === 1', v.reviewStats.distribution[1] === 1)
  assert('reviewStats.averageRating ≈ 3.43', Math.abs(v.reviewStats.averageRating - 3.43) < 0.01,
    `avg=${v.reviewStats.averageRating}`)
  assert('activeSponsorship set', v.activeSponsorship && typeof v.activeSponsorship === 'object')
  assert('activeSponsorship.plan === semanal', v.activeSponsorship?.plan === 'semanal')
  assert('activeSponsorship.daysRemaining in [0..5]',
    v.activeSponsorship?.daysRemaining >= 0 && v.activeSponsorship?.daysRemaining <= 5,
    `daysRemaining=${v.activeSponsorship?.daysRemaining}`)
  assert('orderStats.total === 5', v.orderStats.total === 5)
  assert('orderStats.last30Days === 3', v.orderStats.last30Days === 3)

  // 2. POST vendor note
  console.log('\n[2] POST vendor note')
  const noteBody1 = `Smoke5 vendor note ${SUFFIX}`
  const create = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: noteBody1 }),
  })
  assert('POST note returns 201', create.status === 201, `status=${create.status} body=${JSON.stringify(create.body)}`)
  assert('note target_type=vendor', create.body.note?.target_type === 'vendor')
  assert('note target_id matches', create.body.note?.target_id === vendorId)
  const noteId1 = create.body.note?.id

  // 3. list vendor notes
  console.log('\n[3] GET vendor notes list')
  const list1 = await fetchJSON(`/api/admin/notes?targetType=vendor&targetId=${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert('GET notes returns 200', list1.status === 200)
  assert('newest note appears first', list1.body.notes[0]?.body === noteBody1)

  // 4. DELETE note
  console.log('\n[4] DELETE note')
  const del = await fetchJSON(`/api/admin/notes/${noteId1}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  })
  assert('DELETE note returns 200', del.status === 200)
  const list2 = await fetchJSON(`/api/admin/notes?targetType=vendor&targetId=${vendorId}`, {
    headers: authHeaders(adminToken),
  })
  assert('list no longer contains deleted note', !list2.body.notes.some(n => n.id === noteId1))

  // 5. second note + audit log
  console.log('\n[5] second note + audit log')
  const noteBody2 = `Smoke5 vendor audit note ${SUFFIX}`
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'vendor', targetId: vendorId, body: noteBody2 }),
  })
  const c = await dbClient()
  let auditCount
  try {
    const r = await c.query(
      `SELECT COUNT(*)::int AS c FROM admin_audit_log
       WHERE admin_id = (SELECT id FROM users WHERE email = $1)
         AND action = 'add_admin_note'`,
      [admin.email]
    )
    auditCount = r.rows[0].c
  } finally { await c.end() }
  assert('admin_audit_log has add_admin_note entry', auditCount >= 2, `count=${auditCount}`)

  // 6. /admin page (regression on tier-1)
  console.log('\n[6] /admin page reachable')
  const page = await fetch(`${BASE}/admin`, {
    headers: { Cookie: `token=${adminToken}` },
    redirect: 'manual',
  })
  assert('/admin returns 200', page.status === 200, `status=${page.status}`)

  // 7. negative: buyer on admin route
  console.log('\n[7] buyer → 403')
  const buyerAttempt = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    headers: authHeaders(buyerToken),
  })
  assert('buyer cookie → 403', buyerAttempt.status === 403, `status=${buyerAttempt.status}`)

  // 8. negative: no cookie
  console.log('\n[8] no auth → 401')
  const noAuth = await fetchJSON(`/api/admin/vendors/${vendorId}`)
  assert('no cookie → 401', noAuth.status === 401, `status=${noAuth.status}`)

  // cleanup
  await cleanup(admin.email, buyer.email, sellerEmail)

  console.log(`\n${passed} passed, ${failed} failed of ${passed + failed} assertions`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('smoke-tier5 crashed:', e.message)
  console.error(e.stack)
  process.exit(2)
})