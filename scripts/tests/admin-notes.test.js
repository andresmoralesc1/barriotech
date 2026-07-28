/**
 * Tests for /api/admin/notes — tier 4 deliverable.
 *
 * Coverage:
 *   1. POST happy path: create note → 201, body returned
 *   2. POST validation: empty / whitespace-only body → 400
 *   3. POST validation: body > 2000 chars → 400
 *   4. POST target missing: bogus uuid → 404
 *   5. POST no auth → 401
 *   6. POST buyer role → 403
 *   7. GET list: returns notes, newest first
 *   8. GET list: not-found target → 200 with empty array (no FK on
 *      admin_notes.target_id, so we don't 404 — caller can decide)
 *   9. DELETE happy path: → 200, soft-deleted (subsequent GET hides it)
 *  10. DELETE no auth → 401
 *  11. DELETE already-deleted → 404
 *  12. Rate limit: 31 quick POSTs → 31st gets 429
 *
 * Setup: bootstrap a fresh admin via DB-direct insert so the suite
 * is independent of any production admin. Cleanup deletes only
 * ci-test-* tagged rows.
 *
 * Run: node --test scripts/tests/admin-notes.test.js
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
      [email, hash, 'CI Admin Notes ' + SUFFIX]
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

async function resetNotesState(adminEmail) {
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
    await c.query(
      `DELETE FROM admin_audit_log WHERE admin_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
    // Delete any notes written by this admin (so test 1's "list empty for new buyer" check holds).
    await c.query(
      `DELETE FROM admin_notes WHERE author_id = (SELECT id FROM users WHERE email = $1)`,
      [adminEmail]
    )
  } finally { await c.end() }
}

async function createBuyer() {
  return setupTestUser({ role: 'buyer', cityId: 'bogota' })
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
          await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
          await c.query(`DELETE FROM users WHERE email = $1`, [adminEmail])
        } catch {} finally {
          try { await c.end() } catch {}
        }
      }).catch(() => {})
    } catch {}
  })
})

test('1. POST happy path: create note → 201', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const body = `Cliente escaló queja por cobro duplicado. ${SUFFIX}`

  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body }),
  })
  assert.equal(res.status, 201, `status ${res.status} body=${JSON.stringify(res.body)}`)
  assert.equal(res.body.note.target_type, 'user')
  assert.equal(res.body.note.target_id, buyer.userId)
  assert.equal(res.body.note.body, body)
  assert.equal(res.body.note.author_id.length > 0, true)

  // Audit log should have one row
  const db = await dbClient()
  try {
    const r = await db.query(
      `SELECT action FROM admin_audit_log
        WHERE admin_id = (SELECT id FROM users WHERE email = $1)
          AND action = 'add_admin_note'
          AND target_id = $2`,
      [adminEmail, buyer.userId]
    )
    assert.equal(r.rows.length, 1, `audit rows expected 1, got ${r.rows.length}`)
  } finally { await db.end() }
})

test('2. POST empty body → 400', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: '   ' }),
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.match(res.body.error, /vacía/i)
})

test('3. POST body > 2000 chars → 400', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      targetType: 'user',
      targetId: buyer.userId,
      body: 'x'.repeat(2001),
    }),
  })
  assert.equal(res.status, 400, `expected 400, got ${res.status}`)
  assert.match(res.body.error, /2000/i)
})

test('4. POST target missing → 404', async () => {
  await resetNotesState(adminEmail)
  const bogus = '00000000-0000-0000-0000-000000000999'
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: bogus, body: 'hola' }),
  })
  assert.equal(res.status, 404, `expected 404, got ${res.status}`)
  assert.match(res.body.error, /no encontrad/i)
})

test('5. POST no auth → 401', async () => {
  const buyer = await createBuyer()
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: 'no auth' }),
  })
  assert.equal(res.status, 401, `expected 401, got ${res.status}`)
})

test('6. POST buyer role → 403', async () => {
  const buyer = await createBuyer()
  // Target a different buyer's id so we exercise the role check, not target existence.
  const target = await createBuyer()
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(buyer.token),
    body: JSON.stringify({ targetType: 'user', targetId: target.userId, body: 'forbidden' }),
  })
  assert.equal(res.status, 403, `expected 403, got ${res.status}`)
})

test('7. GET list: returns notes, newest first', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: 'primera' }),
  })
  // Tiny delay so created_at differs.
  await new Promise((r) => setTimeout(r, 50))
  await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: 'segunda' }),
  })
  const res = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyer.userId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.notes.length, 2)
  assert.equal(res.body.notes[0].body, 'segunda', 'newest should be first')
  assert.equal(res.body.notes[1].body, 'primera')
})

test('8. GET list: empty for fresh target → 200 []', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const res = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyer.userId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.notes, [])
})

test('9. DELETE: soft-deletes, subsequent GET hides it', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const create = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: 'borrame' }),
  })
  assert.equal(create.status, 201)
  const noteId = create.body.note.id

  const del = await fetchJSON(`/api/admin/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  })
  assert.equal(del.status, 200)
  assert.equal(del.body.ok, true)

  // The list should now be empty (soft-deleted).
  const list = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyer.userId}`, {
    headers: authHeaders(adminToken),
  })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.notes, [])

  // But the row exists in DB with deleted_at set.
  const db = await dbClient()
  try {
    const r = await db.query(
      `SELECT deleted_at FROM admin_notes WHERE id = $1`,
      [noteId]
    )
    assert.equal(r.rows.length, 1)
    assert.notEqual(r.rows[0].deleted_at, null, 'deleted_at should be set')
  } finally { await db.end() }
})

test('10. DELETE no auth → 401', async () => {
  const fakeUuid = '00000000-0000-0000-0000-000000000111'
  const res = await fetchJSON(`/api/admin/notes/${fakeUuid}`, {
    method: 'DELETE',
  })
  assert.equal(res.status, 401, `expected 401, got ${res.status}`)
})

test('11. DELETE already-deleted → 404', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  const create = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: 'x' }),
  })
  const noteId = create.body.note.id
  const first = await fetchJSON(`/api/admin/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  })
  assert.equal(first.status, 200)
  const second = await fetchJSON(`/api/admin/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(adminToken),
  })
  assert.equal(second.status, 404, `expected 404 on second delete, got ${second.status}`)
})

test('12. rate limit: 31 quick POSTs → 31st gets 429', async () => {
  await resetNotesState(adminEmail)
  const buyer = await createBuyer()
  let lastStatus = 0
  let lastBody = null
  for (let i = 0; i < 31; i++) {
    const res = await fetchJSON('/api/admin/notes', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ targetType: 'user', targetId: buyer.userId, body: `n${i}` }),
    })
    lastStatus = res.status
    lastBody = res.body
    if (res.status === 429) break
  }
  assert.equal(lastStatus, 429, `expected 429 after 31 requests, got ${lastStatus} body=${JSON.stringify(lastBody)}`)
})
