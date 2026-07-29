/**
 * Seed helpers for integration tests (CRIT-CI 2026-07-23).
 *
 * Why this exists:
 *   - The previous auth tests assumed an existing user `test@hermes.local`
 *     was reachable. That's true for prod (we left a real one there), but
 *     CI runs against a fresh DB with schema only — no seed data.
 *   - Solution: every test that needs a user creates one via
 *     `/api/auth/register` with a run-unique email, then cleans up
 *     tagged rows at process exit.
 *   - Same pattern for vendor/product catalog tests — `setupTestVendor()`
 *     creates a user+profile+vendor with a known slug and a single
 *     product+photo so `/api/vendors/{slug}/catalog` has something to
 *     return in CI.
 *
 * Design choices:
 *   - Cleanup is registered with `process.on('exit')` so it runs even if
 *     tests throw. Cleanup is a best-effort single DELETE; if the DB
 *     connection is broken we just skip (the row stays, but tests passed).
 *   - Email format: `ci-test-{epoch}-{rand}@ci.local` — any row starting
 *     with `ci-test-` is fair game for cleanup. Fresh clones or other
 *     developers' data is never touched.
 *   - Phone + cityId provided so the register endpoint is happy and
 *     auto-bootstrap vendor (seller flow) doesn't error.
 */

const crypto = require('node:crypto')

const { getBase } = require('./env-loader')

// Track emails + slugs we created so cleanup can sweep them even if a
// single test crashes mid-register.
const trackedEmails = new Set()
const trackedSlugs = new Set()
let cleanupRegistered = false

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

async function fetchJSON(path, options = {}) {
  const res = await fetch(getBase() + path, options)
  let body = null
  try {
    body = await res.json()
  } catch {}
  return { status: res.status, body, headers: res.headers }
}

function dbClientConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'gps_street_sellers',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  }
}

async function withClient(fn) {
  const { Client } = require('pg')
  const c = new Client(dbClientConfig())
  try {
    await c.connect()
    return await fn(c)
  } catch (e) {
    // DB unreachable → caller decides whether to skip or throw.
    throw e
  } finally {
    try {
      await c.end()
    } catch {}
  }
}

// All auth-related rate-limit buckets used by /api/auth/* endpoints.
// Keep this list in sync with apps/web/lib/rate-limit and the bucket
// names referenced in apps/web/app/api/auth/*/route.ts.
//
// 2026-07-29: added 'login_account' — the per-identifier bucket added
// in the S1-SEC-1 audit. Tests that probe /api/auth/login with bad
// credentials (identifier='x', password='x') burn BOTH the IP bucket
// ('login', 10/15min) AND the per-identifier bucket ('login_account',
// 5/15min). Without clearing 'login_account' here, the second probe
// for the same identifier returns 429 instead of the expected 401/400.
// Live confirmation: SELECT bucket, ip, COUNT(*) FROM rate_limit_attempts
// WHERE bucket='login_account' GROUP BY 1,2 shows 'x' at 38 attempts
// after a few test runs.
const AUTH_RATE_LIMIT_BUCKETS = [
  'login',
  'login_account',
  'register',
  'forgot_password',
  'reset_password',
  'resend_verification',
  'resend_verification_email',
  'verify_email',
]

async function resetRateLimit(buckets = AUTH_RATE_LIMIT_BUCKETS) {
  try {
    await withClient(async (c) => {
      // Use = ANY($1) so the bucket list lives in one place and
      // we never duplicate the IN clause across files.
      await c.query(
        `DELETE FROM rate_limit_attempts WHERE bucket = ANY($1::text[])`,
        [buckets]
      )
    })
  } catch {
    // table might not exist yet — non-fatal
  }
}

function registerCleanup() {
  if (cleanupRegistered) return
  cleanupRegistered = true
  // `exit` is the safest hook — it runs no matter how we leave tests
  // (success, exception, process.exit). We swallow errors so cleanup
  // never masks the real test failure.
  process.on('exit', () => {
    try {
      require('pg')
    } catch {
      return
    }
    // Synchronous pg client connection (no async allowed in `exit`).
    const { Client } = require('pg')
    const c = new Client(dbClientConfig())
    c.connect().then(async () => {
      try {
        if (trackedEmails.size) {
          const emails = Array.from(trackedEmails)
          // Postgres parameterized IN (...)
          const placeholders = emails.map((_, i) => `$${i + 1}`).join(',')
          await c.query(
            `DELETE FROM users WHERE email IN (${placeholders})`,
            emails
          )
        }
        if (trackedSlugs.size) {
          const slugs = Array.from(trackedSlugs)
          const placeholders = slugs.map((_, i) => `$${i + 1}`).join(',')
          await c.query(
            `DELETE FROM vendors WHERE slug IN (${placeholders})`,
            slugs
          )
        }
      } catch {
        // best effort
      } finally {
        try {
          await c.end()
        } catch {}
      }
    }).catch(() => {
      // DB down at process exit — nothing we can do.
    })
  })
}

/**
 * Register a fresh test user via the public endpoint and log them in.
 * Returns `{ email, password, token, userId }`.
 *
 * @param {object} [opts]
 * @param {string} [opts.role='buyer']  'buyer' | 'seller'
 * @param {string} [opts.cityId='bogota']
 * @param {string} [opts.password='TestPassword123']
 */
async function setupTestUser({
  role = 'buyer',
  cityId = 'bogota',
  password = 'TestPassword123',
  name,
} = {}) {
  registerCleanup()
  const suffix = uniqueSuffix()
  const email = `ci-test-${suffix}@ci.local`
  // Sprint 8 D.2: phone generator used to be `3_100_000_000 + (Date.now() %
  // 1_000_000_000)`, but `3.1B + 900M = 4.0B`, which produces a 10-digit
  // phone starting with `4` — not a valid Colombian mobile (MinTIC plan:
  // mobile numbers start with `3`). Use `% 700_000_000` instead so the
  // sum stays under 3.8B and always starts with `3`.
  const phone = `3${String(Date.now() % 700_000_000).padStart(9, '0')}`

  const reg = await fetchJSON('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      name: name || `Test ${role} ${suffix}`,
      phone,
      cityId,
      role,
      acceptedTerms: true,
      acceptedPrivacy: true,
    }),
  })

  if (reg.status !== 200) {
    throw new Error(
      `setupTestUser: register failed (${reg.status}): ${JSON.stringify(reg.body)}`
    )
  }

  trackedEmails.add(email)

  // Reset rate limit so the immediately-following login doesn't hit
  // 429 — multi-test runs hammer the same IP/identifier rapidly.
  await resetRateLimit()

  const login = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  })

  if (login.status !== 200) {
    throw new Error(
      `setupTestUser: login failed (${login.status}): ${JSON.stringify(login.body)}`
    )
  }

  // Token is set via httpOnly cookies only (security fix). Extract from
  // Set-Cookie for tests that need to pass `Authorization: Bearer ...`.
  const setCookie = login.headers.get('set-cookie') || ''
  const tokenMatch = setCookie.match(/token=([^;]+)/)
  const token = tokenMatch ? tokenMatch[1] : null

  return {
    email,
    password,
    token,
    role,
    userId: login.body.user?.id,
    user: login.body.user,
  }
}

/**
 * Create a full vendor with profile + a published catalog item.
 * Used by catalog tests so they don't depend on whatever data lives
 * in the live DB. Returns `{ slug, vendorId, productId, ownerEmail, ownerToken }`.
 *
 * @param {object} [opts]
 * @param {string} [opts.name='CI Test Vendor']
 * @param {string} [opts.cityId='bogota']
 */
async function setupTestVendor({
  name = 'CI Test Vendor',
  cityId = 'bogota',
} = {}) {
  registerCleanup()
  // Reuse the user factory so cleanup is unified.
  const owner = await setupTestUser({ role: 'seller', cityId })

  const slug = `ci-test-slug-${Date.now().toString(36)}-${crypto
    .randomBytes(2)
    .toString('hex')}`.toLowerCase()
  trackedSlugs.add(slug)

  // Create vendor directly via DB (faster than spinning up vendor
  // creation UI). For tests that need to inspect the catalog response
  // shape, this is the minimal viable vendor.
  const ids = await withClient(async (c) => {
    // Profiles row (1:1 with users). Register endpoint already creates one,
    // so we reuse it via email lookup.
    const profileRes = await c.query(
      `SELECT id FROM profiles WHERE email = $1 LIMIT 1`,
      [owner.email]
    )
    const profileId = profileRes.rows[0]?.id
    if (!profileId) throw new Error('setupTestVendor: profile missing')
    let vendorId
    try {
      const v = await c.query(
        `INSERT INTO vendors (profile_id, name, slug, category, latitude, longitude, city_id, is_active, is_verified)
         VALUES ($1, $2, $3, 'comida', 4.65, -74.05, $4, true, true)
         RETURNING id`,
        [profileId, name, slug, cityId]
      )
      vendorId = v.rows[0].id
    } catch (e) {
      throw new Error(`vendor INSERT failed: ${e.message}`)
    }
    const p = await c.query(
      `INSERT INTO products (vendor_id, name, description, price)
       VALUES ($1, 'CI Empanada', 'CI test product', 2500)
       RETURNING id`,
      [vendorId]
    )
    const productId = p.rows[0].id
    await c.query(
      `INSERT INTO product_photos (product_id, url)
       VALUES ($1, 'https://example.test/ci-empanada.jpg')`,
      [productId]
    )
    return { vendorId, productId }
  })

  return { slug, vendorId: ids.vendorId, ownerEmail: owner.email, ownerToken: owner.token, owner }
}

/**
 * Best-effort wipe for CI tagged rows. Useful in `before()` hooks if
 * a previous run died before cleanup ran.
 */
async function wipeCiTestRows() {
  try {
    await withClient(async (c) => {
      await c.query(`DELETE FROM users WHERE email LIKE 'ci-test-%'`)
      await c.query(`DELETE FROM vendors WHERE slug LIKE 'ci-test-slug-%'`)
    })
  } catch {
    // ignore — DB unavailable
  }
}

module.exports = {
  setupTestUser,
  setupTestVendor,
  wipeCiTestRows,
  resetRateLimit,
  fetchJSON,
  withClient,
}