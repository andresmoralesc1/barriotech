#!/usr/bin/env node
/**
 * Tier 2 smoke test — end-to-end verification of vendor soft-delete + restore
 * against a freshly-spun `next dev` server (separate from PM2 prod on 3005).
 *
 * What this exercises:
 *  1. Create a fresh admin (create-admin.js) + login → get token
 *  2. Create a vendor (DB-direct) with a known slug
 *  3. DELETE /api/admin/vendors/[id] → 200, deletedAt set
 *  4. GET /api/admin/vendors  → vendor NOT in default list
 *  5. GET /api/admin/vendors?includeDeleted=true → vendor IS in list
 *  6. DELETE again → 200 alreadyDeleted=true (idempotent)
 *  7. PATCH /api/admin/vendors/[id] {isActive:false} → 404 (forces restore)
 *  8. POST /api/admin/vendors/[id]/restore → 200
 *  9. POST again → 200 alreadyActive=true (idempotent)
 * 10. Public /api/vendors/[slug] → 200 (vendor back in catalog)
 * 11. Audit log: 2 rows (soft_delete_vendor + restore_soft_deleted_vendor)
 * 12. Cleanup: delete audit + vendor + user rows (no leak)
 *
 * Run: BASE=http://localhost:3008 node scripts/tests/_smoke-tier2.js
 */
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/gps-street-sellers/node_modules/dotenv')).config({
  path: '/home/telchar/gps-street-sellers/apps/web/.env',
})

const BASE = process.env.BASE || 'http://localhost:3008'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const ADMIN_EMAIL = `ci-test-admin-${SUFFIX}@ci.local`
const VENDOR_OWNER_EMAIL = `ci-test-vendor-owner-${SUFFIX}@ci.local`
const VENDOR_SLUG = `ci-test-slug-${SUFFIX}`
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

let pass = 0
let fail = 0
const failures = []

function check(label, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    failures.push({ label, detail })
    console.log(`  ✗ ${label}  ${detail ? '→ ' + detail : ''}`)
  }
}

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  try { body = await res.json() } catch {}
  // For login we need the cookie. Return headers too.
  return { status: res.status, body, headers: res.headers }
}

let adminToken = null
let vendorId = null
let auditRows = 0

async function dbClient() {
  const c = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT, 10),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  })
  await c.connect()
  return c
}

async function step1_createAdmin() {
  console.log('\n[1] Create admin')
  const c = await dbClient()
  try {
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id`,
      [ADMIN_EMAIL, hash, 'CI Admin ' + SUFFIX]
    )
    check('admin row created', r.rows.length === 1, `id=${r.rows[0]?.id}`)
    return r.rows[0].id
  } finally {
    await c.end()
  }
}

async function step2_loginAdmin() {
  console.log('\n[2] Login as admin')
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: ADMIN_EMAIL, password: PASSWORD }),
  })
  check('login 200', res.status === 200, `got ${res.status}`)
  const setCookie = res.headers.get('set-cookie') || ''
  const m = setCookie.match(/token=([^;]+)/)
  adminToken = m ? m[1] : null
  check('token extracted', !!adminToken, m ? 'ok' : 'no token cookie')
  check('login body has user.role===admin', res.body?.user?.role === 'admin', `role=${res.body?.user?.role}`)
}

async function step3_createVendor() {
  console.log('\n[3] Create vendor (DB-direct)')
  const c = await dbClient()
  try {
    // Register the owner seller first via the public API so the full
    // triggers fire (profile row, etc.). Use setupTestUser pattern.
    const reg = await fetchJSON('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: VENDOR_OWNER_EMAIL,
        password: PASSWORD,
        name: 'CI Vendor Owner ' + SUFFIX,
        phone: `3${String(Date.now() % 700_000_000).padStart(9, '0')}`,
        cityId: 'bogota',
        role: 'seller',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    })
    check('register seller 200', reg.status === 200, `got ${reg.status} ${JSON.stringify(reg.body)}`)

    // Reset rate limit so login doesn't 429
    await c.query("DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register')")

    const profileRes = await c.query(`SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [VENDOR_OWNER_EMAIL])
    const profileId = profileRes.rows[0]?.id
    check('profile row exists', !!profileId, `profileId=${profileId}`)

    const v = await c.query(
      `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
       VALUES ($1, $2, $3, 'comida', 4.65, -74.05, 'bogota', true, true)
       RETURNING id`,
      [profileId, `CI Vendor ${SUFFIX}`, VENDOR_SLUG]
    )
    vendorId = v.rows[0].id
    check('vendor row created', !!vendorId, `vendorId=${vendorId}`)
  } finally {
    await c.end()
  }
}

function authHeaders() {
  // Cookie auth (not Authorization header) so the server reads the token
  // from the same cookie Set-Cookie on login. We also deliberately do NOT
  // send an Origin header — the dev server enforces CSRF by Origin match,
  // and cross-host Origin (localhost:3008 vs APP_ORIGIN prod URL) would
  // 403 us. CSRF_ALLOW_MISSING_ORIGIN=1 is set in .env so this is fine.
  return {
    'Content-Type': 'application/json',
    'Cookie': `token=${adminToken}`,
  }
}

async function step4_softDelete() {
  console.log('\n[4] DELETE /api/admin/vendors/[id]')
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  check('200 OK', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('body.deletedAt not null', !!res.body?.deletedAt, `deletedAt=${res.body?.deletedAt}`)
  check('body.ok===true', res.body?.ok === true, `ok=${res.body?.ok}`)

  // verify DB
  const c = await dbClient()
  try {
    const r = await c.query(`SELECT deleted_at FROM vendors WHERE id = $1`, [vendorId])
    check('vendors.deleted_at populated', r.rows[0]?.deleted_at !== null, `db got ${r.rows[0]?.deleted_at}`)
  } finally { await c.end() }
}

async function step5_listDefaults() {
  console.log('\n[5] GET /api/admin/vendors (default — excludes deleted)')
  const res = await fetchJSON('/api/admin/vendors', { headers: authHeaders() })
  check('200 OK', res.status === 200, `got ${res.status}`)
  const found = (res.body?.vendors || []).find(v => v.id === vendorId)
  check('soft-deleted vendor NOT in default list', !found, `found=${!!found}`)
}

async function step6_listIncludeDeleted() {
  console.log('\n[6] GET /api/admin/vendors?includeDeleted=true')
  const res = await fetchJSON('/api/admin/vendors?includeDeleted=true', { headers: authHeaders() })
  check('200 OK', res.status === 200, `got ${res.status}`)
  const found = (res.body?.vendors || []).find(v => v.id === vendorId)
  check('soft-deleted vendor IS in includeDeleted list', !!found, `found=${!!found}`)
  if (found) {
    check('found vendor has deletedAt set', !!found.deletedAt, `deletedAt=${found.deletedAt}`)
  }
}

async function step7_idempotentDelete() {
  console.log('\n[7] DELETE again (idempotent)')
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  check('200 OK on repeat', res.status === 200, `got ${res.status}`)
  check('alreadyDeleted===true', res.body?.alreadyDeleted === true, `body=${JSON.stringify(res.body)}`)
}

async function step8_patchBlocksDeleted() {
  console.log('\n[8] PATCH on deleted vendor → 404')
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ isActive: false }),
  })
  check('404 on deleted-vendor PATCH', res.status === 404, `got ${res.status} ${JSON.stringify(res.body)}`)
}

async function step9_restore() {
  console.log('\n[9] POST /api/admin/vendors/[id]/restore')
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  })
  check('200 OK', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('body.ok===true', res.body?.ok === true, `ok=${res.body?.ok}`)
  check('body.restoredAt set', !!res.body?.restoredAt, `restoredAt=${res.body?.restoredAt}`)

  const c = await dbClient()
  try {
    const r = await c.query(`SELECT deleted_at FROM vendors WHERE id = $1`, [vendorId])
    check('vendors.deleted_at cleared', r.rows[0]?.deleted_at === null, `db got ${r.rows[0]?.deleted_at}`)
  } finally { await c.end() }
}

async function step10_idempotentRestore() {
  console.log('\n[10] POST restore again (idempotent)')
  const res = await fetchJSON(`/api/admin/vendors/${vendorId}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  })
  check('200 OK on repeat', res.status === 200, `got ${res.status}`)
  check('alreadyActive===true', res.body?.alreadyActive === true, `body=${JSON.stringify(res.body)}`)
}

async function step11_publicCatalog() {
  console.log('\n[11] Public /api/vendors/[slug] (restored → visible)')
  const res = await fetchJSON(`/api/vendors/${VENDOR_SLUG}`)
  check('200 OK', res.status === 200, `got ${res.status}`)
  const v = res.body?.vendor || res.body
  check('vendor public row visible', v?.slug === VENDOR_SLUG, `slug=${v?.slug}`)
}

async function step12_auditLog() {
  console.log('\n[12] Audit log entries')
  const c = await dbClient()
  try {
    const r = await c.query(
      `SELECT action, COUNT(*)::int AS n
       FROM admin_audit_log
       WHERE admin_id = (SELECT id FROM users WHERE email = $1)
         AND action IN ('soft_delete_vendor', 'restore_soft_deleted_vendor')
       GROUP BY action
       ORDER BY action`,
      [ADMIN_EMAIL]
    )
    auditRows = r.rows.reduce((sum, row) => sum + row.n, 0)
    check('2 audit entries (soft_delete + restore)', auditRows === 2, `got ${auditRows} rows: ${JSON.stringify(r.rows)}`)

    const actions = r.rows.map(x => x.action)
    check('soft_delete_vendor captured', actions.includes('soft_delete_vendor'), `actions=${actions}`)
    check('restore_soft_deleted_vendor captured', actions.includes('restore_soft_deleted_vendor'), `actions=${actions}`)
  } finally { await c.end() }
}

async function step13_cleanup() {
  console.log('\n[13] Cleanup')
  const c = await dbClient()
  try {
    // Audit log first (FK may not cascade).
    await c.query(
      `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
      [ADMIN_EMAIL]
    )
    // Cascade-safe cleanup: delete ALL vendors tied to the test
    // profiles (the seller auto-bootstrap creates a placeholder vendor
    // that also references the profile), then users (cascade to
    // profiles), then sweep any orphan profiles.
    await c.query(
      `DELETE FROM vendors WHERE profile_id IN
         (SELECT id FROM profiles WHERE email IN ($1, $2))`,
      [ADMIN_EMAIL, VENDOR_OWNER_EMAIL]
    )
    await c.query(`DELETE FROM users WHERE email IN ($1, $2)`,
      [ADMIN_EMAIL, VENDOR_OWNER_EMAIL])
    await c.query(`DELETE FROM profiles WHERE email IN ($1, $2)`,
      [ADMIN_EMAIL, VENDOR_OWNER_EMAIL])
    console.log('  ✓ cleanup queries executed')
  } finally { await c.end() }
}

async function main() {
  console.log(`Tier 2 smoke against ${BASE}\n`)
  await step1_createAdmin()
  await step2_loginAdmin()
  await step3_createVendor()
  await step4_softDelete()
  await step5_listDefaults()
  await step6_listIncludeDeleted()
  await step7_idempotentDelete()
  await step8_patchBlocksDeleted()
  await step9_restore()
  await step10_idempotentRestore()
  await step11_publicCatalog()
  await step12_auditLog()
  await step13_cleanup()

  console.log('\n────────────────────────────')
  console.log(`PASS: ${pass}    FAIL: ${fail}`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  - ${f.label}${f.detail ? '  → ' + f.detail : ''}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  // Best-effort cleanup even on failure
  step13_cleanup().catch(() => {}).finally(() => process.exit(2))
})
