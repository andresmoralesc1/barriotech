/**
 * Tests for POST /api/admin/clients/batch — tier 3 deliverable.
 *
 * Symmetric counterpart to /api/admin/vendors/batch. Clients = users
 * WHERE role='buyer'. Coverage:
 *
 *  1. Happy path: deactivate 3 buyers → 200, changed=3, audit log rows
 *  2. Idempotent re-run: same action → 200, skipped=3, changed=0
 *  3. Missing id (404): one bogus uuid in the array → 404, no rows
 *     mutated (validates the BEGIN/ROLLBACK contract)
 *  4. Sibling-role id (404): a seller's id sent in clientIds → 404,
 *     because the row lock is filtered to role='buyer'
 *  5. Auth: no cookie → 401
 *  6. Auth: buyer role → 403
 *  7. Rate limit: 11 quick requests → 11th gets 429
 *
 * Each test bootstraps a fresh admin via DB-direct insert so the suite
 * is independent of the production admin user. Buyers are created via
 * the public register endpoint so the full triggers fire (profile row,
 * etc.). Cleanup deletes only ci-test-* tagged rows.
 *
 * Run: node --test scripts/tests/admin-batch-clients.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const crypto = require('node:crypto')
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
// dotenv directly (vs loadEnv) — the env-loader's path is rooted at
// /scripts/_lib/..  which resolves to /scripts/apps/web/.env (typo),
// so we point dotenv at the right file ourselves. Same pattern as the
// tier-2 smoke test.
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/barriotech/apps/web/.env'),
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
    // pg requires password be a string; the dev DB is the default postgres/postgres.
    password: typeof DB_PASSWORD === 'string' ? DB_PASSWORD : 'postgres',
  })
  await c.connect()
  return c
}

// Create a fresh admin via DB (mirrors the smoke test pattern).
async function createAdmin() {
  const c = await dbClient()
  try {
    const email = `ci-test-admin-${SUFFIX}@ci.local`
    const hash = await bcrypt.hash(PASSWORD, 13)
    const r = await c.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id, email`,
      [email, hash, 'CI Admin ' + SUFFIX]
    )
    return { id: r.rows[0].id, email }
  } finally {
    await c.end()
  }
}

async function loginAdmin(email) {
  // Reset login rate limit so this isn't blocked by a prior run.
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'login_account', 'register')`)
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

// Always wipe the admin_client_batch rate limit bucket and audit log
// rows tagged to our admin so each test runs against a fresh slate.
async function resetBatchState(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_client_batch'`)
    await c.query(
      `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
  } finally { await c.end() }
}

async function createBuyer() {
  return setupTestUser({ role: 'buyer', cityId: 'bogota' })
}

async function createSeller() {
  return setupTestUser({ role: 'seller', cityId: 'bogota' })
}

async function buyerRow(userId) {
  const c = await dbClient()
  try {
    const r = await c.query(
      `SELECT id, is_active, email_verified, role FROM users WHERE id = $1`,
      [userId]
    )
    return r.rows[0]
  } finally { await c.end() }
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
            `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
            [adminEmail]
          )
          await c.query(
            `DELETE FROM rate_limit_attempts WHERE bucket = 'admin_client_batch'`
          )
          await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
        } catch {} finally {
          try { await c.end() } catch {}
        }
      }).catch(() => {})
    } catch {}
  })
})

test('1. happy path: deactivate 3 buyers → 200, changed=3', async () => {
  await resetBatchState(adminEmail)
  const a = await createBuyer()
  const b = await createBuyer()
  const c = await createBuyer()

  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      clientIds: [a.userId, b.userId, c.userId],
      action: 'deactivate',
    }),
  })
  assert.equal(res.status, 200, `status ${res.status} body=${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.action, 'deactivate')
  assert.equal(res.body.requested, 3)
  assert.equal(res.body.changed, 3)
  assert.equal(res.body.skipped, 0)

  // DB should reflect the change
  for (const id of [a.userId, b.userId, c.userId]) {
    const row = await buyerRow(id)
    assert.equal(row.is_active, false, `buyer ${id} expected is_active=false, got ${row.is_active}`)
  }

  // Audit log should have 3 rows
  const db = await dbClient()
  try {
    const r = await db.query(
      `SELECT action, COUNT(*)::int AS n
       FROM admin_audit_log
       WHERE admin_id = (SELECT id FROM users WHERE email = $1)
         AND action = 'batch_deactivate_client'
         AND target_id = ANY($2::uuid[])
       GROUP BY action`,
      [adminEmail, [a.userId, b.userId, c.userId]]
    )
    const n = r.rows.reduce((s, x) => s + x.n, 0)
    assert.equal(n, 3, `audit rows expected 3, got ${n}: ${JSON.stringify(r.rows)}`)
  } finally { await db.end() }
})

test('2. idempotent: same action re-run → 200, skipped=3', async () => {
  await resetBatchState(adminEmail)
  const a = await createBuyer()
  const b = await createBuyer()
  const c = await createBuyer()

  // First call: deactivate
  const first = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      clientIds: [a.userId, b.userId, c.userId],
      action: 'deactivate',
    }),
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.changed, 3)

  // Second call: already deactivated → skipped
  const second = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      clientIds: [a.userId, b.userId, c.userId],
      action: 'deactivate',
    }),
  })
  assert.equal(second.status, 200)
  assert.equal(second.body.changed, 0)
  assert.equal(second.body.skipped, 3)
})

test('3. missing id (404) + ROLLBACK: bogus uuid in array → 404, no rows mutated', async () => {
  await resetBatchState(adminEmail)
  const a = await createBuyer()
  const b = await createBuyer()
  const bogus = '00000000-0000-0000-0000-000000000123'

  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      clientIds: [a.userId, b.userId, bogus],
      action: 'verify_email',
    }),
  })
  assert.equal(res.status, 404, `expected 404, got ${res.status}`)
  assert.match(res.body.error, /no encontrados|Clientes/i, `error msg: ${res.body.error}`)

  // The valid buyers should NOT have been mutated (rollback).
  for (const id of [a.userId, b.userId]) {
    const row = await buyerRow(id)
    assert.equal(row.email_verified, false, `buyer ${id} should NOT be verified (rollback failed), got ${row}`)
  }
})

test('4. sibling role (404): a seller id in clientIds → 404', async () => {
  await resetBatchState(adminEmail)
  const buyer = await createBuyer()
  const seller = await createSeller()

  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      clientIds: [buyer.userId, seller.userId],
      action: 'activate',
    }),
  })
  assert.equal(res.status, 404, `expected 404 because seller ≠ buyer, got ${res.status}`)
})

test('5. no auth → 401', async () => {
  await resetBatchState(adminEmail)
  const a = await createBuyer()
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientIds: [a.userId], action: 'activate' }),
  })
  assert.equal(res.status, 401, `expected 401, got ${res.status}`)
})

test('6. buyer role → 403', async () => {
  await resetBatchState(adminEmail)
  const buyer = await createBuyer()
  const res = await fetchJSON('/api/admin/clients/batch', {
    method: 'POST',
    headers: authHeaders(buyer.token),
    body: JSON.stringify({ clientIds: [buyer.userId], action: 'activate' }),
  })
  assert.equal(res.status, 403, `expected 403, got ${res.status}`)
})

test('7. rate limit: 11 quick requests → 11th gets 429', async () => {
  await resetBatchState(adminEmail)
  const a = await createBuyer()
  let lastStatus = 0
  let lastBody = null
  for (let i = 0; i < 11; i++) {
    const res = await fetchJSON('/api/admin/clients/batch', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ clientIds: [a.userId], action: 'activate' }),
    })
    lastStatus = res.status
    lastBody = res.body
    if (res.status === 429) break
  }
  assert.equal(lastStatus, 429, `expected 429 after 11 requests, got ${lastStatus} body=${JSON.stringify(lastBody)}`)
})
