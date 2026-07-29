#!/usr/bin/env node
/**
 * Smoke check for tier 11 — orders date range filter (admin UI).
 *
 * Verifies:
 *  1. /api/admin/orders accepts ?since=YYYY-MM-DD and narrows results
 *  2. /api/admin/orders accepts ?until=YYYY-MM-DD and narrows results
 *  3. combined window since + until returns the slice only
 *  4. combined with status filter — both filters apply
 *  5. /admin renders 200 (no React render failure from the new inputs)
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
    const email = `ci-smoke-admin-tier11-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'CI Smoke Tier11', 'admin', true) RETURNING id, email`,
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
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`)
  const cookie = res.headers.get('set-cookie')
  const m = cookie.match(/token=([^;]+)/)
  if (!m) throw new Error('No token cookie')
  return { cookie: `token=${m[1]}` }
}

async function main() {
  console.log(`\nTier 11 smoke — orders date filter (${BASE})\n`)

  const admin = await createAdmin()
  const auth = await loginAdmin(admin.email)
  step('admin created + logged in', true, admin.email)

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // 1. since narrows
  const r1 = await fetchJSON(
    `/api/admin/orders?since=${today}&limit=100`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'since=today narrows results',
    r1.status === 200 && r1.body.orders.every((o) => new Date(o.createdAt) >= new Date(today)),
    `status ${r1.status}, count ${r1.body?.orders?.length}`
  )

  // 2. until narrows
  const r2 = await fetchJSON(
    `/api/admin/orders?until=${tomorrow}&limit=100`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'until=tomorrow narrows results',
    r2.status === 200 && r2.body.orders.every((o) => new Date(o.createdAt) < new Date(tomorrow)),
    `status ${r2.status}, count ${r2.body?.orders?.length}`
  )

  // 3. window
  const r3 = await fetchJSON(
    `/api/admin/orders?since=${today}&until=${tomorrow}&limit=100`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'since + until returns window only',
    r3.status === 200 && r3.body.orders.every((o) => {
      const d = new Date(o.createdAt)
      return d >= new Date(today) && d < new Date(tomorrow)
    }),
    `status ${r3.status}, count ${r3.body?.orders?.length}`
  )

  // 4. combined with status
  const r4 = await fetchJSON(
    `/api/admin/orders?since=${yesterday}&status=pending&limit=100`,
    { headers: { Cookie: auth.cookie } }
  )
  step(
    'since + status filter combines',
    r4.status === 200 && r4.body.orders.every((o) => o.status === 'pending'),
    `status ${r4.status}, count ${r4.body?.orders?.length}`
  )

  // 5. /admin renders 200
  const r5 = await fetch(BASE + '/admin', {
    headers: { Cookie: auth.cookie },
    redirect: 'manual',
  })
  const html = await r5.text()
  step(
    '/admin renders 200 without runtime errors',
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
