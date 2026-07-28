/**
 * Tests for /api/admin/audit/export — tier 7 deliverable.
 *
 * Coverage:
 *   1. GET happy path → 200, Content-Type csv, Content-Disposition
 *      attachment, UTF-8 BOM at start, header row, body rows reflect
 *      inserted audit rows.
 *   2. GET filters: action substring narrows the export.
 *   3. GET filters: targetType=user narrows the export.
 *   4. GET filters: date range (since/until) narrows the export.
 *   5. GET filters: adminId narrows the export.
 *   6. GET metadata column: metadata JSON is serialized into the row.
 *   7. Audit row written: export_audit_csv appears in admin_audit_log
 *      with filter snapshot in metadata.
 *   8. No auth → 401.
 *   9. Buyer role → 403.
 *  10. Rate limit: 6th call → 429 (bucket is 5/min).
 *
 * Setup: bootstrap a fresh admin via DB-direct insert so the suite is
 * independent of any production admin. Insert three audit rows tagged
 * with this admin's id (different actions, different targetTypes) so
 * filter assertions are deterministic.
 *
 * Run: node --test scripts/tests/admin-audit-export.test.js
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

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3005'
const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const PASSWORD = 'TestPassword123'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

async function fetchJSON(p, options = {}) {
  const res = await fetch(BASE + p, options)
  let body = null
  let text = null
  try {
    text = await res.text()
  } catch {}
  if (text) {
    try { body = JSON.parse(text) } catch { /* CSV body — keep text */ }
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
    const email = `ci-test-admin-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id, email`,
      [email, hash, 'CI Admin Audit ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally {
    await c.end()
  }
}

async function loginAdmin(email) {
  const c = await dbClient()
  try {
    await c.query(
      `DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register', 'admin_export_audit')`
    )
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
  return { Cookie: `token=${token}` }
}

async function resetAuditState(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_export_audit'`)
    await c.query(
      `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
  } finally { await c.end() }
}

/**
 * Insert a single audit row directly into admin_audit_log. We don't go
 * through logAdminAction because we want full control over action,
 * target_type, and metadata so filter assertions are deterministic.
 */
async function seedAuditRow(adminId, { action, targetType, targetId, metadata, ageSeconds = 0 }) {
  const c = await dbClient()
  try {
    await c.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata, ip, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, '127.0.0.1', NOW() - ($6::int * INTERVAL '1 second'))`,
      [adminId, action, targetType ?? null, targetId ?? null, metadata ? JSON.stringify(metadata) : null, ageSeconds]
    )
  } finally { await c.end() }
}

/** Strip UTF-8 BOM (if present) and return plain text. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

let adminEmail = null
let adminId = null
let adminToken = null
let cleanupDone = false

test('setup: create admin + login', async () => {
  const admin = await createAdmin()
  adminEmail = admin.email
  adminId = admin.id
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
            `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
            [adminEmail]
          )
          await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_export_audit'`)
          await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
        } catch {} finally {
          try { await c.end() } catch {}
        }
      }).catch(() => {})
    } catch {}
  })
})

test('1. GET happy path: returns CSV with headers + rows', async () => {
  await resetAuditState(adminEmail)
  await seedAuditRow(adminId, { action: 'activate_client', targetType: 'user', targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  await seedAuditRow(adminId, { action: 'batch_activate_vendor', targetType: 'vendor', targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })

  const res = await fetchJSON(`/api/admin/audit/export?adminId=${adminId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200, `expected 200, got ${res.status}`)
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"/)

  const text = stripBom(res.text)
  const lines = text.split(/\r\n/).filter(Boolean)
  assert.equal(lines[0], 'id,created_at,admin_id,admin_email,action,target_type,target_id,ip,metadata', 'header row mismatch')
  assert.equal(lines.length, 3, `expected 3 lines (header + 2 rows), got ${lines.length}`)

  // Both rows present
  assert.match(text, /activate_client/)
  assert.match(text, /batch_activate_vendor/)

  // Audit row written for the export itself
  const c = await dbClient()
  try {
    const r = await c.query(
      `SELECT metadata FROM admin_audit_log
       WHERE admin_id = $1 AND action = 'export_audit_csv'`,
      [adminId]
    )
    assert.equal(r.rows.length, 1, 'expected 1 export_audit_csv audit row')
    const meta = r.rows[0].metadata
    assert.equal(meta.rows, 2, 'audit metadata should record row count')
    assert.equal(meta.capped, false)
  } finally { await c.end() }
})

test('2. filter action: narrows to matching substring', async () => {
  await resetAuditState(adminEmail)
  await seedAuditRow(adminId, { action: 'activate_client', targetType: 'user', targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  await seedAuditRow(adminId, { action: 'batch_activate_vendor', targetType: 'vendor', targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })
  await seedAuditRow(adminId, { action: 'soft_delete_vendor', targetType: 'vendor', targetId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })

  const res = await fetchJSON(`/api/admin/audit/export?adminId=${adminId}&action=batch`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const text = stripBom(res.text)
  const lines = text.split(/\r\n/).filter(Boolean)
  assert.equal(lines.length, 2, 'header + 1 matching row')
  assert.match(text, /batch_activate_vendor/)
  assert.doesNotMatch(text, /soft_delete_vendor/)
})

test('3. filter targetType=user: narrows to user rows', async () => {
  await resetAuditState(adminEmail)
  await seedAuditRow(adminId, { action: 'activate_client', targetType: 'user', targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  await seedAuditRow(adminId, { action: 'batch_activate_vendor', targetType: 'vendor', targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })

  const res = await fetchJSON('/api/admin/audit/export?targetType=user', {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const text = stripBom(res.text)
  assert.match(text, /activate_client/)
  assert.doesNotMatch(text, /batch_activate_vendor/)
})

test('4. filter date range: since excludes older rows', async () => {
  await resetAuditState(adminEmail)
  // Two recent rows
  await seedAuditRow(adminId, { action: 'activate_client', targetType: 'user', targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ageSeconds: 0 })
  await seedAuditRow(adminId, { action: 'batch_activate_vendor', targetType: 'vendor', targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ageSeconds: 0 })
  // One old row (10 minutes ago)
  await seedAuditRow(adminId, { action: 'soft_delete_vendor', targetType: 'vendor', targetId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', ageSeconds: 600 })

  // since = 1 minute ago — should exclude the 10-min-old row but include the two recent
  const since = new Date(Date.now() - 60 * 1000).toISOString()
  const res = await fetchJSON(`/api/admin/audit/export?since=${encodeURIComponent(since)}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const text = stripBom(res.text)
  assert.match(text, /activate_client/)
  assert.match(text, /batch_activate_vendor/)
  assert.doesNotMatch(text, /soft_delete_vendor/)
})

test('5. filter adminId: narrows to this admin only', async () => {
  await resetAuditState(adminEmail)
  await seedAuditRow(adminId, { action: 'activate_client', targetType: 'user', targetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })

  // Bogus admin uuid (well-formed) → no rows for that admin
  const res = await fetchJSON(`/api/admin/audit/export?adminId=00000000-0000-0000-0000-000000000000`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const text = stripBom(res.text)
  const lines = text.split(/\r\n/).filter(Boolean)
  assert.equal(lines.length, 1, 'header only — no matching rows for that admin')
})

test('6. metadata column: JSON serialized into CSV cell', async () => {
  await resetAuditState(adminEmail)
  const meta = { filters: { active: 'true' }, rows: 3 }
  await seedAuditRow(adminId, {
    action: 'export_clients_csv',
    targetType: null,
    targetId: null,
    metadata: meta,
  })

  const res = await fetchJSON(`/api/admin/audit/export?adminId=${adminId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  const text = stripBom(res.text)
  // Metadata JSON appears in the row, including the nested filter snapshot.
  // csvEscape doubles inner quotes, so the CSV cell ends up looking like
  // ""filters"":{""active"":""true""} — every `"` from the JSON becomes `""`.
  // jsonb normalizes key order, so we don't pin which comes first.
  assert.match(text, /export_clients_csv/)
  assert.match(text, /""filters"":\{""active"":""true""\}/)
  assert.match(text, /""rows"":3/)
})

test('7. no auth → 401', async () => {
  const res = await fetchJSON('/api/admin/audit/export')
  assert.equal(res.status, 401, `expected 401, got ${res.status}`)
})

test('8. buyer role → 403', async () => {
  // Setup a buyer just for this test
  const { setupTestUser } = require('./_lib/seed')
  const buyer = await setupTestUser({ role: 'buyer', cityId: 'bogota' })
  const res = await fetchJSON('/api/admin/audit/export', {
    headers: { Cookie: `token=${buyer.token}` },
  })
  assert.equal(res.status, 403, `expected 403, got ${res.status}`)
})

test('9. rate limit: 6th call → 429', async () => {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_export_audit'`)
  } finally { await c.end() }

  let lastStatus = 0
  for (let i = 0; i < 6; i++) {
    const res = await fetchJSON('/api/admin/audit/export', {
      headers: authHeaders(adminToken),
    })
    lastStatus = res.status
    if (res.status === 429) break
  }
  assert.equal(lastStatus, 429, `expected 429 on 6th call, got ${lastStatus}`)
})
