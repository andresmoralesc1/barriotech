#!/usr/bin/env node
/**
 * Smoke check for tier 10 — dashboard recent-activity admin email →
 * audit-log filtered by admin uuid.
 *
 * Verifies:
 *  1. /api/admin/audit accepts ?adminId=<uuid> and narrows results
 *  2. /api/admin/audit/export accepts ?adminId=<uuid> and filters CSV
 *  3. /api/admin/stats/summary returns recentActivity rows that contain
 *     adminId (the dashboard uses it for the deep-link click target)
 *  4. Invalid uuid is silently ignored (no crash, full audit log returned)
 *  5. /admin renders 200 (no React render failure from the new prop)
 */

const path = require('node:path')
const crypto = require('node:crypto')
require(path.resolve(__dirname, '../../node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../apps/web/.env'),
})

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3008'
const PASSWORD = 'TestPassword123'

const { Client } = require(path.resolve(__dirname, '../../node_modules/pg'))
const bcrypt = require(path.resolve(__dirname, '../../node_modules/bcryptjs'))

const SUFFIX = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
const STEPS = []
let stepCount = 0
function step(label, ok, detail) {
  stepCount++
  const tag = ok ? '✓' : '✗'
  console.log(`  ${tag} ${stepCount}. ${label}${detail ? ' — ' + detail : ''}`)
  STEPS.push({ label, ok, detail })
  if (!ok) process.exitCode = 1
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
    const email = `ci-smoke-admin-tier10-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'CI Smoke Tier10', 'admin', true) RETURNING id, email`,
      [email, hash]
    )
    return { id: r.rows[0].id, email }
  } finally { await c.end() }
}

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

async function fetchRaw(p, options = {}) {
  const res = await fetch(BASE + p, options)
  const buf = await res.arrayBuffer()
  return { status: res.status, buffer: Buffer.from(buf), headers: res.headers }
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
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`)
  const cookie = res.headers.get('set-cookie')
  const m = cookie.match(/token=([^;]+)/)
  if (!m) throw new Error('No token cookie')
  return { cookie: `token=${m[1]}` }
}

async function seedAudit(adminId, action, targetType, targetId) {
  const c = await dbClient()
  try {
    await c.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id)
       VALUES ($1, $2, $3, $4)`,
      [adminId, action, targetType, targetId]
    )
  } finally { await c.end() }
}

async function main() {
  console.log(`\nTier 10 smoke — admin deep-link (${BASE})\n`)

  const admin = await createAdmin()
  const auth = await loginAdmin(admin.email)
  step('admin created + logged in', true, admin.email)

  // Seed 2 rows with a unique marker so we can verify the filter
  // narrows correctly even if other rows from other tests exist.
  const marker = `tier10_smoke_${SUFFIX}`
  await seedAudit(admin.id, marker, 'user', admin.id)
  await seedAudit(admin.id, marker, 'vendor', admin.id)
  step('2 audit rows seeded with marker', true)

  // 1. audit list narrowed by adminId
  const r1 = await fetchJSON(
    `/api/admin/audit?adminId=${admin.id}&action=${marker}&limit=100`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'audit list narrows by adminId + action',
    r1.status === 200 && r1.body.entries.length === 2,
    `status ${r1.status}, entries ${r1.body?.entries?.length}`
  )
  for (const e of r1.body.entries) {
    if (e.adminId !== admin.id) {
      step('every entry from filtered admin', false, `got adminId ${e.adminId}`)
      break
    }
  }
  step('every entry from filtered admin', true)

  // 2. audit export narrowed by adminId
  const r2 = await fetchRaw(
    `/api/admin/audit/export?adminId=${admin.id}&action=${marker}`,
    { headers: { Cookie: auth.cookie } }
  )
  const text = r2.buffer.toString('utf8').replace(/^\ufeff/, '')
  const lines = text.split('\n').filter((l) => l.length > 0)
  step(
    'audit export narrows by adminId + action',
    r2.status === 200 && lines.length - 1 === 2,
    `status ${r2.status}, data rows ${lines.length - 1}`
  )

  // 3. dashboard summary provides adminId per recent-activity row
  const r3 = await fetchJSON('/api/admin/stats/summary', {
    headers: { Cookie: auth.cookie },
  })
  const hasAdminId = r3.body?.recentActivity?.length > 0
    ? r3.body.recentActivity.every((a) => typeof a.adminId === 'string' && a.adminId.length > 0)
    : true
  step(
    'dashboard summary exposes adminId on recent-activity rows',
    r3.status === 200 && hasAdminId,
    `status ${r3.status}, count ${r3.body?.recentActivity?.length ?? 0}`
  )

  // 4. invalid uuid is a no-op (no crash)
  const r4 = await fetchJSON(
    `/api/admin/audit?adminId=not-a-uuid`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'invalid adminId uuid is silently ignored',
    r4.status === 200 && Array.isArray(r4.body.entries),
    `status ${r4.status}`
  )

  // 5. /admin renders 200
  const r5 = await fetch(BASE + '/admin', {
    headers: { Cookie: auth.cookie },
    redirect: 'manual',
  })
  const html = await r5.text()
  step(
    '/admin renders without runtime errors',
    r5.status === 200 && !/Application error/.test(html),
    `status ${r5.status}`
  )

  // Summary
  const passed = STEPS.filter((s) => s.ok).length
  const total = STEPS.length
  console.log(`\n${passed}/${total} steps passed`)
  if (passed !== total) process.exitCode = 1
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
})
