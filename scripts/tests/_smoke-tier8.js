/**
 * Smoke test for tier 8 — dashboard recent-activity deep-link to
 * the audit log filtered by action.
 *
 * Walks the wiring end-to-end:
 *   1. /admin page reachable for admin
 *   2. /api/admin/stats/summary returns recentActivity (the source of
 *      the dashboard's deep-link buttons)
 *   3. Each recent activity row's action, when used as a filter on
 *      /api/admin/audit, returns at least one row (round-trip sanity)
 *   4. The audit endpoint returns the expected columns
 *
 * Note: the dashboard component is client-rendered, so SSR HTML
 * doesn't include the recent activity tail (it hydrates client-side
 * via the useEffect fetch). The smoke verifies the data path that
 * feeds those buttons, not the click handler itself — that's covered
 * by unit-level reasoning (AuditLog accepts initialAction prop) and
 * the TypeScript compiler check.
 */

const crypto = require('node:crypto')
const path = require('node:path')
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/barriotech/apps/web/.env'),
})

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3008'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

let pass = 0
let fail = 0
const fails = []
function ok(label) { pass++; console.log(`  ok ${label}`) }
function bad(label, detail) { fail++; fails.push(`${label} :: ${detail}`); console.log(`  not ok ${label} :: ${detail}`) }

async function dbClient() {
  const c = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT || '5432', 10),
    database: DB_NAME,
    user: DB_USER,
    password: typeof DB_PASSWORD === 'string' ? DB_PASSWORD : 'postgres',
  })
  await c.connect()
  return c
}

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  let text = null
  try { text = await res.text() } catch {}
  if (text) {
    try { body = JSON.parse(text) } catch {}
  }
  return { status: res.status, body, text, headers: res.headers }
}

async function main() {
  console.log(`smoke-tier8: dashboard deep-link against ${BASE}`)
  console.log('SUFFIX=' + SUFFIX)

  // 1. Bootstrap admin
  let adminId, adminEmail
  {
    const c = await dbClient()
    try {
      adminEmail = `ci-test-admin-${SUFFIX}@ci.local`
      const hash = await bcrypt.hash(PASSWORD, 13)
      const r = await c.query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, 'admin', true)
         RETURNING id`,
        [adminEmail, hash, 'CI Admin Tier8 Smoke ' + SUFFIX]
      )
      adminId = r.rows[0].id
    } finally { await c.end() }
    ok('1. admin bootstrapped')
  }

  // 2. Seed three audit rows with distinct actions
  {
    const c = await dbClient()
    try {
      await c.query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminId])
      await c.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, ip, created_at)
         VALUES ($1, 'tier8_smoke_activate', 'user', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '127.0.0.1', NOW())`,
        [adminId]
      )
      await c.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, ip, created_at)
         VALUES ($1, 'tier8_smoke_deactivate', 'vendor', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '127.0.0.1', NOW())`,
        [adminId]
      )
      await c.query(
        `INSERT INTO admin_audit_log (admin_id, action, ip, created_at)
         VALUES ($1, 'tier8_smoke_dashboard_view', '127.0.0.1', NOW())`,
        [adminId]
      )
    } finally { await c.end() }
    ok('2. three audit rows seeded')
  }

  // 3. Login
  let token
  {
    const c = await dbClient()
    try { await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`) } finally { await c.end() }
    const res = await fetchJSON('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminEmail, password: PASSWORD }),
    })
    if (res.status !== 200) { bad('3. login', res.status); return cleanup(adminEmail).then(summary) }
    const setCookie = res.headers.get('set-cookie') || ''
    const m = setCookie.match(/token=([^;]+)/)
    if (!m) { bad('3. login', 'no token cookie'); return cleanup(adminEmail).then(summary) }
    token = m[1]
    ok('3. admin login → token')
  }

  // 4. /admin reachable
  {
    const res = await fetchJSON('/admin', { headers: { Cookie: `token=${token}` } })
    if (res.status === 200) ok('4. /admin reachable for admin')
    else bad('4. /admin', `expected 200, got ${res.status}`)
  }

  // 5. stats/summary returns our seeded rows in recentActivity
  let recent
  {
    const res = await fetchJSON('/api/admin/stats/summary', { headers: { Cookie: `token=${token}` } })
    if (res.status !== 200) { bad('5. summary', res.status); return cleanup(adminEmail).then(summary) }
    recent = res.body.recentActivity || []
    const tier8Actions = recent.filter((a) => a.action.startsWith('tier8_smoke_'))
    if (tier8Actions.length === 3) ok('5. summary recentActivity contains 3 tier8_smoke_* rows')
    else bad('5. recentActivity', `expected 3 tier8 rows, got ${tier8Actions.length}`)
  }

  // 6. For each recent row, the action filter returns at least one row
  //    (this is the round-trip the dashboard's click handler triggers).
  {
    let allOk = true
    const details = []
    for (const a of recent.slice(0, 5)) {
      const res = await fetchJSON(`/api/admin/audit?adminId=${adminId}&action=${encodeURIComponent(a.action)}`, {
        headers: { Cookie: `token=${token}` },
      })
      if (res.status !== 200) {
        allOk = false
        details.push(`${a.action} → status ${res.status}`)
        continue
      }
      const matches = (res.body.entries || []).filter((e) => e.action === a.action)
      if (matches.length === 0) {
        allOk = false
        details.push(`${a.action} → 0 exact-match rows`)
      }
    }
    if (allOk) ok('6. each recent-action filter round-trips to ≥1 row')
    else bad('6. round-trip', details.join('; '))
  }

  // 7. The seeded tier8_smoke_* actions each narrow to exactly 1 row
  {
    for (const action of ['tier8_smoke_activate', 'tier8_smoke_deactivate', 'tier8_smoke_dashboard_view']) {
      const res = await fetchJSON(`/api/admin/audit?adminId=${adminId}&action=${encodeURIComponent(action)}`, {
        headers: { Cookie: `token=${token}` },
      })
      if (res.status !== 200) { bad(`7. ${action}`, res.status); continue }
      const exact = (res.body.entries || []).filter((e) => e.action === action)
      if (exact.length === 1) ok(`7a. ${action} → 1 row`)
      else bad(`7a. ${action}`, `expected 1, got ${exact.length}`)
    }
  }

  // 8. The audit endpoint returns the columns the deep-link expects
  {
    const res = await fetchJSON(`/api/admin/audit?adminId=${adminId}&action=tier8_smoke_activate`, {
      headers: { Cookie: `token=${token}` },
    })
    const e = (res.body.entries || [])[0]
    if (!e) { bad('8. row', 'no row returned'); return cleanup(adminEmail).then(summary) }
    const expected = ['id', 'adminId', 'adminEmail', 'action', 'targetType', 'targetId', 'metadata', 'ip', 'createdAt']
    const missing = expected.filter((k) => !(k in e))
    if (missing.length === 0) ok('8. audit row has all expected columns')
    else bad('8. columns', `missing ${missing.join(', ')}`)
  }

  await cleanup(adminEmail)
  summary()
}

async function cleanup(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
  } catch {} finally {
    try { await c.end() } catch {}
  }
}

function summary() {
  console.log('')
  console.log(`# smoke-tier8: ${pass} pass, ${fail} fail`)
  if (fail > 0) {
    console.log('')
    console.log('FAILURES:')
    for (const f of fails) console.log('  - ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => { console.error('smoke-tier8: uncaught:', err); process.exit(2) })
