/**
 * Smoke test for tier 7 — admin audit CSV export.
 *
 * Runs against a live next dev on :3008. Walks the entire surface:
 *   - happy path: returns CSV with the right headers
 *   - filters: action / targetType / date range / adminId all narrow
 *   - audit row written for each export (export_audit_csv)
 *   - export AFTER view: the view's audit log row should appear in the CSV
 *   - auth gates: no cookie → 401, buyer role → 403
 *   - rate limit: 6th call → 429
 *
 * Self-contained: bootstraps a fresh admin via DB, logs in via the
 * public endpoint, exercises the route, then cleans up.
 */

const crypto = require('node:crypto')
const path = require('node:path')
const { Client } = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/bcryptjs'))
require(path.resolve('/home/telchar/gps-street-sellers/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/gps-street-sellers/apps/web/.env'),
})

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3008'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

let pass = 0
let fail = 0
const fails = []

function ok(label) {
  pass++
  console.log(`  ok ${label}`)
}
function bad(label, detail) {
  fail++
  fails.push(`${label} :: ${detail}`)
  console.log(`  not ok ${label} :: ${detail}`)
}

function dbClient() {
  const c = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT || '5432', 10),
    database: DB_NAME,
    user: DB_USER,
    password: typeof DB_PASSWORD === 'string' ? DB_PASSWORD : 'postgres',
  })
  return c.connect().then(() => c)
}

async function fetchText(p, options = {}) {
  const res = await fetch(BASE + p, options)
  const text = await res.text()
  return { status: res.status, text, headers: res.headers }
}

async function fetchRaw(p, options = {}) {
  // Fetch the body as bytes so we can inspect the UTF-8 BOM, which
  // WHATWG's text() decoder strips on its own.
  const res = await fetch(BASE + p, options)
  const buf = new Uint8Array(await res.arrayBuffer())
  let text = ''
  try { text = new TextDecoder('utf-8').decode(buf) } catch {}
  return { status: res.status, text, raw: buf, headers: res.headers }
}

function stripBom(t) {
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

async function main() {
  console.log(`smoke-tier7: audit CSV export against ${BASE}`)
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
        [adminEmail, hash, 'CI Admin Audit Smoke ' + SUFFIX]
      )
      adminId = r.rows[0].id
    } finally { await c.end() }
    ok('1. admin bootstrapped')
  }

  // 2. Clear rate limit + audit log for this admin
  {
    const c = await dbClient()
    try {
      await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register', 'admin_export_audit')`)
      await c.query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminId])
    } finally { await c.end() }
    ok('2. rate limit + audit log cleared')
  }

  // 3. Login as admin
  let token
  {
    const res = await fetchText('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminEmail, password: PASSWORD }),
    })
    if (res.status !== 200) {
      bad('3. admin login', `status=${res.status}`)
      await cleanup(adminEmail)
      return summary()
    }
    const setCookie = res.headers.get('set-cookie') || ''
    const m = setCookie.match(/token=([^;]+)/)
    if (!m) {
      bad('3. admin login', 'no token cookie')
      await cleanup(adminEmail)
      return summary()
    }
    token = m[1]
    ok('3. admin login → token')
  }

  // 4. Happy path: GET /api/admin/audit/export returns CSV
  let csvText
  {
    const res = await fetchRaw('/api/admin/audit/export', {
      headers: { Cookie: `token=${token}` },
    })
    if (res.status !== 200) bad('4. happy path status', `expected 200, got ${res.status}`)
    else ok('4a. happy path status = 200')

    if (res.headers.get('content-type') === 'text/csv; charset=utf-8') ok('4b. content-type = text/csv')
    else bad('4b. content-type', res.headers.get('content-type'))

    const cd = res.headers.get('content-disposition') || ''
    if (/attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"/.test(cd)) ok('4c. content-disposition attachment + dated filename')
    else bad('4c. content-disposition', cd)

    csvText = stripBom(res.text)
    const lines = csvText.split(/\r\n/).filter(Boolean)
    if (lines[0] === 'id,created_at,admin_id,admin_email,action,target_type,target_id,ip,metadata') ok('4d. header row matches expected columns')
    else bad('4d. header row', lines[0])

    // BOM is byte 0xEF 0xBB 0xBF — fetchRaw above gave us raw bytes
    // so we can check it before any decoder strips it.
    if (res.raw[0] === 0xef && res.raw[1] === 0xbb && res.raw[2] === 0xbf) ok('4e. UTF-8 BOM at start')
    else bad('4e. UTF-8 BOM', `first bytes = [${res.raw[0]}, ${res.raw[1]}, ${res.raw[2]}]`)
  }

  // 5. Audit row written for the export itself
  {
    const c = await dbClient()
    try {
      const r = await c.query(
        `SELECT metadata FROM admin_audit_log
         WHERE admin_id = $1 AND action = 'export_audit_csv'`,
        [adminId]
      )
      if (r.rows.length === 1) ok('5. export_audit_csv audit row written')
      else bad('5. audit row', `expected 1, got ${r.rows.length}`)
      if (r.rows[0] && r.rows[0].metadata && typeof r.rows[0].metadata.rows === 'number') ok('5a. audit metadata has rows field')
      else bad('5a. metadata', JSON.stringify(r.rows[0]?.metadata))
    } finally { await c.end() }
  }

  // 6. Seed a tagged audit row, then verify it appears in the export
  {
    const c = await dbClient()
    try {
      await c.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata, ip, created_at)
         VALUES ($1, 'view_vendor_list', 'vendor', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '{"sentinel":"smoke-tier7-marker"}'::jsonb, '127.0.0.1', NOW())`,
        [adminId]
      )
    } finally { await c.end() }

    const res = await fetchText(`/api/admin/audit/export?adminId=${adminId}`, {
      headers: { Cookie: `token=${token}` },
    })
    if (res.status !== 200) bad('6. seeded row fetch', `status=${res.status}`)
    else if (res.text.includes('smoke-tier7-marker')) ok('6. seeded audit row appears in CSV')
    else bad('6. seeded audit row', 'marker not found in CSV body')
  }

  // 7. Filter by action narrows the export
  {
    const res = await fetchText(`/api/admin/audit/export?adminId=${adminId}&action=view_vendor_list`, {
      headers: { Cookie: `token=${token}` },
    })
    if (res.status !== 200) bad('7a. action filter status', res.status)
    else if (res.text.includes('view_vendor_list')) ok('7a. action filter returns matching rows')
    else bad('7a. action filter', 'no view_vendor_list in body')

    // Negative: only this admin's rows (smoke-tier7-marker seeded) + export_audit_csv audits
    const lines = stripBom(res.text).split(/\r\n/).filter(Boolean)
    const bodyLines = lines.length - 1
    if (bodyLines >= 1) ok(`7b. action filter returned ${bodyLines} data row(s)`)
    else bad('7b. action filter rows', `expected ≥1, got ${bodyLines}`)
  }

  // 8. Filter by targetType narrows the export
  {
    const res = await fetchText(`/api/admin/audit/export?adminId=${adminId}&targetType=vendor`, {
      headers: { Cookie: `token=${token}` },
    })
    if (res.status !== 200) bad('8a. targetType filter status', res.status)
    else if (res.text.includes('view_vendor_list')) ok('8a. targetType=vendor returns vendor rows')
    else bad('8a. targetType filter', 'no vendor row in body')
  }

  // 9. Filter by date range excludes old rows
  {
    // Insert one old row (10 minutes ago)
    const c = await dbClient()
    try {
      await c.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, metadata, ip, created_at)
         VALUES ($1, 'old_marker', null, '{"sentinel":"smoke-tier7-old"}'::jsonb, '127.0.0.1', NOW() - INTERVAL '10 minutes')`,
        [adminId]
      )
    } finally { await c.end() }

    // since = 1 minute ago — old row should be excluded
    const since = new Date(Date.now() - 60 * 1000).toISOString()
    const res = await fetchText(`/api/admin/audit/export?adminId=${adminId}&since=${encodeURIComponent(since)}`, {
      headers: { Cookie: `token=${token}` },
    })
    if (res.status !== 200) bad('9a. date range filter status', res.status)
    else if (!res.text.includes('smoke-tier7-old')) ok('9a. since excludes 10-min-old row')
    else bad('9a. date range', 'old row still present in body')

    if (res.text.includes('smoke-tier7-marker')) ok('9b. recent row still present with since filter')
    else bad('9b. recent row', 'recent marker missing from filtered body')
  }

  // 10. No auth → 401
  {
    const res = await fetchText('/api/admin/audit/export')
    if (res.status === 401) ok('10. no auth → 401')
    else bad('10. no auth', `expected 401, got ${res.status}`)
  }

  // 11. Buyer role → 403
  {
    // Bootstrap a buyer just for this test
    const { setupTestUser } = require(path.resolve('/home/telchar/gps-street-sellers/scripts/tests/_lib/seed.js'))
    const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
    const res = await fetchText('/api/admin/audit/export', {
      headers: { Cookie: `token=${buyer.token}` },
    })
    if (res.status === 403) ok('11. buyer role → 403')
    else bad('11. buyer role', `expected 403, got ${res.status}`)
  }

  // 12. Rate limit: 6th call → 429
  {
    const c = await dbClient()
    try {
      await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_export_audit'`)
    } finally { await c.end() }

    let last = 0
    for (let i = 0; i < 6; i++) {
      const res = await fetchText('/api/admin/audit/export', {
        headers: { Cookie: `token=${token}` },
      })
      last = res.status
      if (res.status === 429) break
    }
    if (last === 429) ok('12. rate limit (6th call → 429)')
    else bad('12. rate limit', `expected 429 on 6th, last was ${last}`)
  }

  await cleanup(adminEmail)
  summary()
}

async function cleanup(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`, [adminEmail])
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_export_audit'`)
    await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
  } catch {} finally {
    try { await c.end() } catch {}
  }
}

function summary() {
  console.log('')
  console.log(`# smoke-tier7: ${pass} pass, ${fail} fail`)
  if (fail > 0) {
    console.log('')
    console.log('FAILURES:')
    for (const f of fails) console.log('  - ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('smoke-tier7: uncaught error:', err)
  process.exit(2)
})
