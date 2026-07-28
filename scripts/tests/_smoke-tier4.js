#!/usr/bin/env node
/**
 * Tier 4 smoke test — end-to-end verification of /api/admin/notes
 * (GET / POST / DELETE) against a freshly-spun `next dev` server
 * (separate from PM2 prod on 3005).
 *
 * What this exercises:
 *  1. Create a fresh admin (DB-direct) + login → get token
 *  2. Register 2 buyers (public endpoint) → get their ids
 *  3. POST /api/admin/notes {user, buyer1, "cliente escaló queja"} → 201
 *  4. DB confirms admin_notes row exists for buyer1
 *  5. GET /api/admin/notes?targetType=user&targetId=buyer1 → 1 note
 *  6. POST another note for buyer1 → 201, list now has 2 (newest first)
 *  7. POST validation: empty body → 400
 *  8. POST validation: > 2000 chars → 400
 *  9. POST validation: bogus target uuid → 404
 *  10. POST no auth → 401
 *  11. POST as buyer → 403
 *  12. POST again to ensure rate limit doesn't trip (we're well under 30/min)
 *  13. DELETE note[0] → 200, list now shows 1
 *  14. DELETE same note again → 404
 *  15. DELETE bogus uuid → 404
 *  16. DELETE no auth → 401
 *  17. Audit log: add_admin_note + delete_admin_note rows match
 *  18. Cleanup
 *
 * Run: BASE=http://localhost:3008 node scripts/tests/_smoke-tier4.js
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
let createdNoteIds = []

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
      [ADMIN_EMAIL, hash, 'CI Admin Notes ' + SUFFIX]
    )
    adminUserId = r.rows[0].id
    check('admin row created', !!adminUserId, `id=${adminUserId}`)
  } finally { await c.end() }
}

async function step2_loginAdmin() {
  console.log('\n[2] Login as admin')
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register')`)
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
  console.log('\n[3] Register 2 buyers (public endpoint)')
  for (let i = 0; i < 2; i++) {
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
  // Reset rate limit + note-action bucket
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register', 'admin_note_action')`)
  } finally { await c.end() }
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Cookie: `token=${adminToken}`,
  }
}

async function step4_postNote() {
  console.log('\n[4] POST /api/admin/notes (happy path)')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      targetType: 'user',
      targetId: buyerIds[0],
      body: 'Cliente escaló queja por cobro duplicado. ' + SUFFIX,
    }),
  })
  check('201', res.status === 201, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('body.note.body returned', res.body?.note?.body?.includes('cobro duplicado'), `body=${res.body?.note?.body}`)
  check('body.note.target_id===buyer1', res.body?.note?.target_id === buyerIds[0], `target_id=${res.body?.note?.target_id}`)
  check('body.note.author_id===admin', res.body?.note?.author_id === adminUserId, `author_id=${res.body?.note?.author_id}`)
  createdNoteIds.push(res.body?.note?.id)

  // DB confirm
  const c = await dbClient()
  try {
    const r = await c.query(
      `SELECT body FROM admin_notes WHERE target_type='user' AND target_id=$1 AND deleted_at IS NULL`,
      [buyerIds[0]]
    )
    check('exactly 1 note for buyer1 in DB', r.rows.length === 1, `got ${r.rows.length}`)
  } finally { await c.end() }
}

async function step5_getList() {
  console.log('\n[5] GET /api/admin/notes?targetType=user&targetId=buyer1')
  const res = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyerIds[0]}`, {
    headers: authHeaders(),
  })
  check('200', res.status === 200, `got ${res.status}`)
  check('notes.length===1', res.body?.notes?.length === 1, `got ${res.body?.notes?.length}`)
  check('note.body matches', res.body?.notes?.[0]?.body?.includes('cobro duplicado'), `body=${res.body?.notes?.[0]?.body}`)
  check('note.author_email===admin', res.body?.notes?.[0]?.author_email === ADMIN_EMAIL, `email=${res.body?.notes?.[0]?.author_email}`)
}

async function step6_postSecond() {
  console.log('\n[6] POST a second note (newest first check)')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      targetType: 'user',
      targetId: buyerIds[0],
      body: 'Llamar el lunes para resolver. ' + SUFFIX,
    }),
  })
  check('201', res.status === 201, `got ${res.status}`)
  createdNoteIds.push(res.body?.note?.id)

  // List now has 2, newest first
  const list = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyerIds[0]}`, {
    headers: authHeaders(),
  })
  check('list has 2 notes', list.body?.notes?.length === 2, `got ${list.body?.notes?.length}`)
  check('notes[0] is the second (newest)', list.body?.notes?.[0]?.body?.startsWith('Llamar el lunes'), `body=${list.body?.notes?.[0]?.body}`)
  check('notes[1] is the first (oldest)', list.body?.notes?.[1]?.body?.includes('cobro duplicado'), `body=${list.body?.notes?.[1]?.body}`)
}

async function step7_validationEmpty() {
  console.log('\n[7] POST validation: empty body → 400')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ targetType: 'user', targetId: buyerIds[0], body: '   ' }),
  })
  check('400', res.status === 400, `got ${res.status}`)
  check('error mentions vacía', /vacía/i.test(res.body?.error ?? ''), `error=${res.body?.error}`)
}

async function step8_validationTooLong() {
  console.log('\n[8] POST validation: 2001 chars → 400')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      targetType: 'user',
      targetId: buyerIds[0],
      body: 'x'.repeat(2001),
    }),
  })
  check('400', res.status === 400, `got ${res.status}`)
  check('error mentions 2000', /2000/i.test(res.body?.error ?? ''), `error=${res.body?.error}`)
}

async function step9_validationMissingTarget() {
  console.log('\n[9] POST validation: bogus target uuid → 404')
  const bogus = '00000000-0000-0000-0000-000000000999'
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ targetType: 'user', targetId: bogus, body: 'hola' }),
  })
  check('404', res.status === 404, `got ${res.status}`)
  check('error mentions no encontrad', /no encontrad/i.test(res.body?.error ?? ''), `error=${res.body?.error}`)
}

async function step10_noAuth() {
  console.log('\n[10] POST without auth → 401')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType: 'user', targetId: buyerIds[0], body: 'no auth' }),
  })
  check('401', res.status === 401, `got ${res.status}`)
}

async function step11_buyerForbidden() {
  console.log('\n[11] POST as buyer → 403')
  // Login as buyer[0]
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket IN ('login', 'register')`)
  } finally { await c.end() }
  const login = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: buyerEmails[0], password: PASSWORD }),
  })
  const sc = login.headers.get('set-cookie') || ''
  const buyerToken = sc.match(/token=([^;]+)/)?.[1]
  check('buyer login ok', login.status === 200 && !!buyerToken, `status=${login.status}`)

  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `token=${buyerToken}` },
    body: JSON.stringify({ targetType: 'user', targetId: buyerIds[1], body: 'as buyer' }),
  })
  check('403', res.status === 403, `got ${res.status}`)
}

async function step12_extraPost() {
  console.log('\n[12] Extra POST for buyer2 (sanity, hit rate limit counter once more)')
  const res = await fetchJSON('/api/admin/notes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      targetType: 'user',
      targetId: buyerIds[1],
      body: 'Reclamo por demora en envío. ' + SUFFIX,
    }),
  })
  check('201', res.status === 201, `got ${res.status}`)
  createdNoteIds.push(res.body?.note?.id)
}

async function step13_deleteNote() {
  console.log('\n[13] DELETE the first note (oldest)')
  const noteId = createdNoteIds[0]
  const res = await fetchJSON(`/api/admin/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  check('200', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`)
  check('ok===true', res.body?.ok === true, `ok=${res.body?.ok}`)

  // List for buyer1 should now have 1 note (the second one)
  const list = await fetchJSON(`/api/admin/notes?targetType=user&targetId=${buyerIds[0]}`, {
    headers: authHeaders(),
  })
  check('list has 1 note after delete', list.body?.notes?.length === 1, `got ${list.body?.notes?.length}`)

  // But DB row still exists with deleted_at set
  const c = await dbClient()
  try {
    const r = await c.query(`SELECT deleted_at FROM admin_notes WHERE id = $1`, [noteId])
    check('row exists in DB', r.rows.length === 1, `got ${r.rows.length}`)
    check('deleted_at is set', r.rows[0]?.deleted_at !== null, `deleted_at=${r.rows[0]?.deleted_at}`)
  } finally { await c.end() }
}

async function step14_doubleDelete() {
  console.log('\n[14] DELETE the same note again → 404')
  const res = await fetchJSON(`/api/admin/notes/${createdNoteIds[0]}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  check('404', res.status === 404, `got ${res.status}`)
}

async function step15_deleteBogus() {
  console.log('\n[15] DELETE bogus uuid → 404')
  const res = await fetchJSON('/api/admin/notes/00000000-0000-0000-0000-000000000aaa', {
    method: 'DELETE',
    headers: authHeaders(),
  })
  check('404', res.status === 404, `got ${res.status}`)
}

async function step16_deleteNoAuth() {
  console.log('\n[16] DELETE without auth → 401')
  const res = await fetchJSON(`/api/admin/notes/${createdNoteIds[1]}`, {
    method: 'DELETE',
  })
  check('401', res.status === 401, `got ${res.status}`)
}

async function step17_auditLog() {
  console.log('\n[17] Audit log')
  const c = await dbClient()
  try {
    const r = await c.query(
      `SELECT action, COUNT(*)::int AS n
         FROM admin_audit_log
        WHERE admin_id = $1
          AND action IN ('add_admin_note', 'delete_admin_note')
        GROUP BY action
        ORDER BY action`,
      [adminUserId]
    )
    const total = r.rows.reduce((s, x) => s + x.n, 0)
    const byAction = Object.fromEntries(r.rows.map(x => [x.action, x.n]))
    // 4 successful POSTs (steps 4, 6, 12 + 1 from rate-limit-exempt extras = 3) + 1 DELETE
    // Failed validations (400/404/401/403) and 404 deletes don't audit
    check('add_admin_note >= 3', (byAction['add_admin_note'] || 0) >= 3, `got ${byAction['add_admin_note']}`)
    check('delete_admin_note === 1', byAction['delete_admin_note'] === 1, `got ${byAction['delete_admin_note']}`)
    check(`total >= 4 (got ${total})`, total >= 4, `total=${total}`)
  } finally { await c.end() }
}

async function step18_cleanup() {
  console.log('\n[18] Cleanup')
  const c = await dbClient()
  try {
    await c.query(`DELETE FROM admin_notes WHERE author_id = $1`, [adminUserId])
    await c.query(`DELETE FROM admin_audit_log WHERE admin_id = $1`, [adminUserId])
    await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [buyerIds])
    await c.query(`DELETE FROM users WHERE id = $1`, [adminUserId])
    const allEmails = [ADMIN_EMAIL, ...buyerEmails]
    await c.query(`DELETE FROM profiles WHERE email = ANY($1::text[])`, [allEmails])
    await c.query(`DELETE FROM rate_limit_attempts WHERE bucket = 'admin_note_action'`)
    console.log('  ✓ cleanup queries executed')
  } finally { await c.end() }
}

async function main() {
  console.log(`Tier 4 smoke against ${BASE}\n`)
  await step1_createAdmin()
  await step2_loginAdmin()
  await step3_registerBuyers()
  await step4_postNote()
  await step5_getList()
  await step6_postSecond()
  await step7_validationEmpty()
  await step8_validationTooLong()
  await step9_validationMissingTarget()
  await step10_noAuth()
  await step11_buyerForbidden()
  await step12_extraPost()
  await step13_deleteNote()
  await step14_doubleDelete()
  await step15_deleteBogus()
  await step16_deleteNoAuth()
  await step17_auditLog()
  await step18_cleanup()

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
  step18_cleanup().catch(() => {}).finally(() => process.exit(2))
})
