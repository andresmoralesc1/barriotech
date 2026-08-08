#!/usr/bin/env node
/**
 * Tier 3 smoke test — end-to-end verification of POST /api/admin/clients/batch
 * against a freshly-spun `next dev` server (separate from PM2 prod on 3005).
 *
 * What this exercises:
 *  1. Create a fresh admin (DB-direct) + login → get token
 *  2. Register 3 buyers (public endpoint) → get their ids
 *  3. POST /api/admin/clients/batch {deactivate} → 200, changed=3
 *  4. DB confirms users.is_active = false for all 3
 *  5. POST again (idempotent) → 200, skipped=3
 *  6. POST with a bogus uuid mixed in → 404 + ROLLBACK (still 3 active)
 *  7. POST {activate} → 200, changed=3
 *  8. POST {verify_email} → 200, changed=3
 *  9. Audit log: exactly 9 rows (3 per action) for the admin
 * 10. Cleanup: audit + users + profiles (cascade-safe)
 *
 * Run: BASE=http://localhost:3008 node scripts/tests/_smoke-tier3.js
 */
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: '/home/telchar/barriotech/apps/web/.env',
})

const BASE = process.env.BASE || 'http://localhost:3008'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const ADMIN_EMAIL = `ci-test-admin-${SUFFIX}@ci.local`
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
  return { status: res.status, body, headers: res.headers }
}

let adminToken = null
const buyerIds = []
const buyerEmails = []
let adminUserId = null

async function dbClient() {
  const c = new Client({
    host: DB_HOST || 'localhost',
    port: parseInt(DB_PORT || '5432', 10),
    database: DB_NAME || 'gps_street_sellers',
    user: DB_USER || 'postgres',
    password: DB_PASSWORD || 'postgres',
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
    adminUserId = r.rows[0].id
    check('admin row created', !!adminUserId, `id=${adminUserId}`)
  } finally { await c.end() }
}

async function step2_loginAdmin() {
  console.log('\n[2] Login as admin')
  // Reset login rate limit (no shared state with the test, but cheap).
  // Note: include 'login_account' — the per-identifier bucket added in
  // the S1-SEC-1 audit. Without it, a smoke run after multiple failed
  // admin logins returns 429 instead of the expected 401.
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`)
  } finally { await c.end() }

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

async function step3_registerBuyers() {
  console.log('\n[3] Register 3 buyers (public endpoint)')
  for (let i = 0; i < 3; i++) {
    const email = `ci-test-buyer-${SUFFIX}-${i}@ci.local`
    buyerEmails.push(email)
    const reg = await fetchJSON('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `CI Buyer ${SUFFIX} #${i}`,
        phone: `3${String((Date.now() + i) % 700_000_000).padStart(9, '0')}`,
        cityId: 'bogota',
        role: 'buyer',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    })
    check(`register buyer #${i} 200`, reg.status === 200, `got ${reg.status} ${JSON.stringify(reg.body)}`)
    buyerIds.push(reg.body?.user?.id)
  }
  // Reset rate limit so the login calls (none here, but defensive) don't 429.
  // Include 'login_account' — see step2_loginAdmin.
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`)
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_client_batch'`)
  } finally { await c.end() }
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Cookie: `token=${adminToken}`,
  }
}

async function step4_deactivate() {
  console.log('\n[4] POST /api/admin/clients/batch {deactivate}')
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientIds: buyerIds, action: 'deactivate' }),
  })
  check('200 OK', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('body.ok===true', res.body?.ok === true, `ok=${res.body?.ok}`)
  check('body.requested===3', res.body?.requested === 3, `requested=${res.body?.requested}`)
  check('body.changed===3', res.body?.changed === 3, `changed=${res.body?.changed}`)
  check('body.skipped===0', res.body?.skipped === 0, `skipped=${res.body?.skipped}`)
  check('body.action===deactivate', res.body?.action === 'deactivate', `action=${res.body?.action}`)

  // DB verify
  const c = await dbClient()
  try {
    for (const id of buyerIds) {
      const r = await c.query(`SELECT is_active FROM users WHERE id = $1`, [id])
      check(`buyer ${id.slice(0, 8)} is_active=false`, r.rows[0]?.is_active === false, `got ${r.rows[0]?.is_active}`)
    }
  } finally { await c.end() }
}

async function step5_idempotentDeactivate() {
  console.log('\n[5] POST deactivate again (idempotent)')
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientIds: buyerIds, action: 'deactivate' }),
  })
  check('200 OK on repeat', res.status === 200, `got ${res.status}`)
  check('body.changed===0', res.body?.changed === 0, `changed=${res.body?.changed}`)
  check('body.skipped===3', res.body?.skipped === 3, `skipped=${res.body?.skipped}`)
}

async function step6_rollbackOnMissing() {
  console.log('\n[6] POST with bogus uuid mixed in → 404 + ROLLBACK')
  const bogus = '00000000-0000-0000-0000-000000000123'
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientIds: [buyerIds[0], bogus, buyerIds[1]], action: 'activate' }),
  })
  check('404', res.status === 404, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('error mentions clientes no encontrados', /no encontrados|Clientes/i.test(res.body?.error ?? ''), `error=${res.body?.error}`)

  // DB verify the valid buyers are STILL inactive (the activate was rolled back)
  const c = await dbClient()
  try {
    for (let i = 0; i < 2; i++) {
      const r = await c.query(`SELECT is_active FROM users WHERE id = $1`, [buyerIds[i]])
      check(`buyer #${i} still is_active=false (rollback worked)`, r.rows[0]?.is_active === false, `got ${r.rows[0]?.is_active}`)
    }
  } finally { await c.end() }
}

async function step7_activate() {
  console.log('\n[7] POST {activate} → 200, changed=3')
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientIds: buyerIds, action: 'activate' }),
  })
  check('200 OK', res.status === 200, `got ${res.status}`)
  check('body.changed===3', res.body?.changed === 3, `changed=${res.body?.changed}`)

  const c = await dbClient()
  try {
    for (const id of buyerIds) {
      const r = await c.query(`SELECT is_active FROM users WHERE id = $1`, [id])
      check(`buyer ${id.slice(0, 8)} is_active=true`, r.rows[0]?.is_active === true, `got ${r.rows[0]?.is_active}`)
    }
  } finally { await c.end() }
}

async function step8_verifyEmail() {
  console.log('\n[8] POST {verify_email} → 200, changed=3')
  // First, set all 3 to email_verified=false so the change is observable
  // (the buyers were created with auto-verified email? No — register
  // leaves email_verified=false until the user clicks the link. Verify
  // in DB before the call to make this test deterministic.)
  const c = await dbClient()
  try {
    await c.query(`UPDATE users SET email_verified = false WHERE id = ANY($1::uuid[])`, [buyerIds])
  } finally { await c.end() }

  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientIds: buyerIds, action: 'verify_email' }),
  })
  check('200 OK', res.status === 200, `got ${res.status}`)
  check('body.changed===3', res.body?.changed === 3, `changed=${res.body?.changed}`)

  const c2 = await dbClient()
  try {
    for (const id of buyerIds) {
      const r = await c2.query(`SELECT email_verified FROM users WHERE id = $1`, [id])
      check(`buyer ${id.slice(0, 8)} email_verified=true`, r.rows[0]?.email_verified === true, `got ${r.rows[0]?.email_verified}`)
    }
  } finally { await c2.end() }
}

async function step9_auditLog() {
  console.log('\n[9] Audit log entries')
  const c = await dbClient()
  try {
    // 3 actions × 3 buyers = 9 audit rows (the rollback in step 6 must have written 0)
    const r = await c.query(
      `SELECT action, COUNT(*)::int AS n
       FROM admin_audit_log
       WHERE admin_id = $1
         AND action IN ('batch_activate_client', 'batch_deactivate_client', 'batch_verify_email_client')
       GROUP BY action
       ORDER BY action`,
      [adminUserId]
    )
    const total = r.rows.reduce((s, x) => s + x.n, 0)
    check('9 audit rows total (3 actions × 3 buyers)', total === 9, `got ${total}: ${JSON.stringify(r.rows)}`)

    const byAction = Object.fromEntries(r.rows.map(x => [x.action, x.n]))
    check('batch_deactivate_client × 3 (from step 4)', byAction['batch_deactivate_client'] === 3, `got ${byAction['batch_deactivate_client']}`)
    check('batch_activate_client × 3 (from step 7)', byAction['batch_activate_client'] === 3, `got ${byAction['batch_activate_client']}`)
    check('batch_verify_email_client × 3 (from step 8)', byAction['batch_verify_email_client'] === 3, `got ${byAction['batch_verify_email_client']}`)
  } finally { await c.end() }
}

async function step10_cleanup() {
  console.log('\n[10] Cleanup')
  const c = await dbClient()
  try {
    // Audit log first
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminUserId])
    // Buyers (cascade to profiles if FK is set)
    await c.query(
      `DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [buyerIds]
    )
    // Admin
    await c.query(`DELETE FROM users WHERE id = $1`, [adminUserId])
    // Sweep any orphan profiles (text[] in a single placeholder, not IN spread)
    const allEmails = [ADMIN_EMAIL, ...buyerEmails]
    await c.query(
      `DELETE FROM profiles WHERE email = ANY($1::text[])`,
      [allEmails]
    )
    // Clear batch rate-limit bucket so subsequent runs start clean
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_client_batch'`)
    console.log('  ✓ cleanup queries executed')
  } finally { await c.end() }
}

async function main() {
  console.log(`Tier 3 smoke against ${BASE}\n`)
  await step1_createAdmin()
  await step2_loginAdmin()
  await step3_registerBuyers()
  await step4_deactivate()
  await step5_idempotentDeactivate()
  await step6_rollbackOnMissing()
  await step7_activate()
  await step8_verifyEmail()
  await step9_auditLog()
  await step10_cleanup()

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
  step10_cleanup().catch(() => {}).finally(() => process.exit(2))
})
