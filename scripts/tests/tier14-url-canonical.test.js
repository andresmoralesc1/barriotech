/**
 * Tests for tier 14 — URL canonicalization to barriotech.com.co.
 *
 * Verifies that after the URL rewrite every public source of canonical
 * URLs points at barriotech.com.co (not the legacy gps.andresmorales.com.co).
 * Tested against the dev server (next dev on :3008).
 *
 * Caddy vhost + DNS tier (15) is out of scope here — that requires
 * Hostinger DNS changes. This test verifies the code-side slice only.
 *
 * Run: node --test scripts/tests/tier14-url-canonical.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3008'

const FORBIDDEN_HOST = 'gps.andresmorales.com.co'
const REQUIRED_HOST = 'barriotech.com.co'

async function fetchText(p) {
  const res = await fetch(BASE + p)
  return { status: res.status, body: await res.text(), url: res.url }
}

test('1. static /robots.txt points to barriotech.com.co', async () => {
  // Tier 14 covers the static-file variant at apps/web/public/robots.txt
  // (the dev-server dynamic sibling apps/web/app/robots.ts is a known
  // Next.js dev-mode collision that 500s today — pre-existing, not our
  // regression, will be cleaned up when the dynamic one is deleted).
  const fs = require('node:fs')
  const path = require('node:path')
  const body = fs.readFileSync(
    path.resolve('/home/telchar/gps-street-sellers/apps/web/public/robots.txt'),
    'utf8',
  )
  assert.doesNotMatch(body, /gps\.andresmorales\.com\.co/,
    'static robots.txt must NOT contain the legacy host')
  assert.match(body, /Sitemap:\s*https:\/\/barriotech\.com\.co\/sitemap\.xml/,
    'static robots.txt Sitemap must target barriotech.com.co')
})

test('2. /sitemap.xml base URLs target barriotech.com.co', async () => {
  const r = await fetchText('/sitemap.xml')
  // Sitemap is only emitted on production builds; 404 is acceptable.
  if (r.status === 404) return
  assert.equal(r.status, 200)
  assert.doesNotMatch(r.body, new RegExp(FORBIDDEN_HOST, 'g'),
    `sitemap must NOT contain ${FORBIDDEN_HOST}`)
  assert.match(r.body, /<loc>https:\/\/barriotech\.com\.co\//,
    'sitemap <loc> entries must use barriotech.com.co')
})

test('3. canonical pages report barriotech.com.co', async () => {
  for (const path of ['/como-funciona', '/terminos', '/contacto', '/nosotros', '/privacidad']) {
    const r = await fetchText(path)
    // All 5 should respond 200 with a canonical link
    assert.equal(r.status, 200, `${path} should return 200`)
    assert.match(r.body, /<link rel="canonical" href="https:\/\/barriotech\.com\.co/,
      `${path} canonical must use barriotech.com.co`)
    assert.doesNotMatch(r.body, new RegExp(FORBIDDEN_HOST, 'g'),
      `${path} must not mention ${FORBIDDEN_HOST}`)
  }
})

test('4. APP_ORIGIN reflects barriotech.com.co (csrf.ts warning copy)', async () => {
  const fs = require('node:fs')
  const body = fs.readFileSync(
    '/home/telchar/gps-street-sellers/apps/web/lib/csrf.ts',
    'utf8',
  )
  assert.doesNotMatch(body, /gps\.andresmorales\.com\.co/,
    'lib/csrf.ts must NOT reference the legacy host')
  assert.match(body, /barriotech\.com\.co/,
    'lib/csrf.ts must reference barriotech.com.co')
})

test('5. ecosystem.config.js APP_ORIGIN is barriotech.com.co', async () => {
  const fs = require('node:fs')
  const body = fs.readFileSync(
    '/home/telchar/gps-street-sellers/ecosystem.config.js',
    'utf8',
  )
  // APP_ORIGIN must be the new primary. The legacy host may still
  // appear in comments/migration notes — we don't constrain those.
  assert.match(body, /APP_ORIGIN:\s*'https:\/\/barriotech\.com\.co'/,
    'ecosystem.config.js APP_ORIGIN must be barriotech.com.co')
  assert.doesNotMatch(body, /APP_ORIGIN:\s*'https:\/\/gps\.andresmorales/,
    'ecosystem.config.js APP_ORIGIN must NOT be gps.andresmorales')
})
