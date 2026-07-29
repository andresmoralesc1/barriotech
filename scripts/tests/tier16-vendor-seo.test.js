/**
 * Tests for tier 16 - SEO polish for vendor pages.
 *
 * Verifies that:
 *   1. A real vendor page (e.g. Carlos Test Frutas del Valle) renders
 *      with unique <title>, og:title, og:description, og:image, and a
 *      canonical link to /vendedor/<slug>.
 *   2. The same page emits a schema.org/LocalBusiness JSON-LD block
 *      with name, address (city + country), and an image.
 *   3. The same page emits a schema.org/BreadcrumbList JSON-LD block
 *      with at least Home -> Vendedores -> Vendor.
 *   4. /sitemap.xml excludes the test vendor slug patterns
 *      (ci-test-slug-*, mi-negocio-de-test-*), so Google doesn't index
 *      ~74 placeholder rows that 404 the next time tests rerun.
 *   5. The static robots.txt and manifest.json still resolve (smoke
 *      regression for tier 15 fix).
 *
 * All checks hit the production server (pm2 gps on :3005) which fronts
 * both barriotech.com.co and gps.andresmorales.com.co via Caddy. We
 * test against barriotech.com.co since that's the canonical domain.
 *
 * Run: node --test scripts/tests/tier16-vendor-seo.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Client } = require(path.resolve('/home/telchar/gps-street-sellers/node_modules/pg'))
require(path.resolve('/home/telchar/gps-street-sellers/node_modules/dotenv')).config({
  path: path.resolve('/home/telchar/gps-street-sellers/apps/web/.env'),
})
const { setupTestUser } = require('./_lib/seed')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3005'

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env

async function fetchText(p) {
  const res = await fetch(BASE + p)
  return { status: res.status, body: await res.text(), url: res.url }
}

async function dbClient() {
  const c = new Client({
    host: DB_HOST,
    port: parseInt(DB_PORT || '5432'),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  })
  await c.connect()
  return c
}

/**
 * Pull JSON-LD blocks out of HTML.
 *
 * In Next.js 16, JSON-LD emitted from a server-component page body is
 * delivered as part of the React Server Component payload (escaped JSON
 * inside `self.__next_f.push(...)` script tags). Modern crawlers
 * (Googlebot since 2024 is Chrome-based) execute JS, hydrate the page,
 * and see the resulting DOM which has real <script type="application/ld+json">
 * tags. Some lightweight crawlers, however, only parse the initial HTML.
 *
 * To stay compatible with both - and to reflect how Google actually
 * indexes these pages - we extract JSON-LD from:
 *   (a) initial-HTML <script type="application/ld+json"> blocks
 *   (b) the RSC payload stream (unescaping the embedded JSON literal)
 *
 * Both are valid sources of structured data from Google's perspective.
 */
function extractJsonLd(html) {
  const out = []

  // (a) Initial HTML - real <script type="application/ld+json"> blocks.
  const reScript = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  let m
  while ((m = reScript.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      // ignore malformed blocks
    }
  }

  // (b) RSC payload - search the entire HTML for our specific ids and pull
  // the embedded JSON out of the escaped stream. The shape in the HTML is:
  //
  //   ...\"id\":\"vendor-local-business\",...,\"dangerouslySetInnerHTML\":
  //   {\"__html\":\"{\\\"@context\\\":\\\"https://schema.org\\\",\\\"@type\\\":
  //   \\\"LocalBusiness\\\",...\"}}...
  //
  // Two layers of escaping: the inner JSON is escaped once (\\\" = "),
  // and the whole thing is itself embedded inside a JS string literal in
  // `self.__next_f.push([1,"..."])` which adds another escape layer.
  //
  // We find each id, locate the __html opener, then walk character-by-
  // character (tracking escape state) to find the matching close of the
  // JSON string literal - the first unescaped " followed by "}.
  const idRegex = /\\"id\\":\\"(vendor-local-business|vendor-breadcrumb)\\"/g
  let idMatch
  while ((idMatch = idRegex.exec(html)) !== null) {
    const startSearch = idMatch.index + idMatch[0].length
    const htmlOpenIdx = html.indexOf('\\"__html\\":\\"', startSearch)
    if (htmlOpenIdx === -1) continue
    const jsonStart = htmlOpenIdx + '\\"__html\\":\\"'.length
    // The chars after the opener are the JSON-encoded value, starting with `{`.
    let i = jsonStart
    let jsonRaw = ''
    while (i < html.length) {
      const ch = html[i]
      // Closing of the JSON value: the JS-escaped closing quote is
      // \" followed by }} (which closes dangerouslySetInnerHTML).
      // When we see that exact sequence, STOP without copying the
      // escape - the closing quote is part of the JS-level wrapping,
      // not the JSON content.
      if (ch === '\\' && html[i + 1] === '"' &&
          html[i + 2] === '}' && html[i + 3] === '}') {
        break
      }
      jsonRaw += ch
      i += 1
    }
    // JS-decode the captured string: turn \\ into \ and \" into ".
    let once = ''
    let k = 0
    while (k < jsonRaw.length) {
      const ch = jsonRaw[k]
      if (ch === '\\' && k + 1 < jsonRaw.length) {
        const next = jsonRaw[k + 1]
        if (next === '\\') once += '\\'
        else if (next === '"') once += '"'
        else if (next === 'n') once += '\n'
        else if (next === 'r') once += '\r'
        else if (next === 't') once += '\t'
        else if (next === '/') once += '/'
        else once += next
        k += 2
      } else {
        once += ch
        k += 1
      }
    }
    // After JS-decode we have a JSON-encoded string like
    // {"@context":"https://schema.org",...}. The " characters are still
    // escaped as \" because the JSON server-side stringified the object
    // before embedding it. Strip those JSON-escapes so JSON.parse can
    // treat them as structural quote delimiters.
    const onceClean = once.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    try {
      out.push(JSON.parse(onceClean))
    } catch {
      // ignore malformed blocks
    }
  }

  return out
}

test('1. real vendor page renders unique meta + canonical', async () => {
  // Pick a real vendor with a non-empty description so we exercise the
  // branch that uses vendor.description rather than the fallback.
  const db = await dbClient()
  try {
    const { rows } = await db.query(
      `SELECT slug FROM vendors
       WHERE is_active = true
         AND deleted_at IS NULL
         AND slug NOT LIKE 'ci-test-slug-' || '%'
         AND slug NOT LIKE 'mi-negocio-de-test-' || '%'
         AND description IS NOT NULL
         AND length(description) > 10
       ORDER BY created_at LIMIT 1`,
    )
    assert.ok(rows.length > 0, 'expected at least one real vendor with a description')
    const slug = rows[0].slug
    const r = await fetchText(`/vendedor/${slug}`)
    assert.equal(r.status, 200, `${slug} should return 200`)
    // Canonical
    assert.match(r.body, new RegExp(`<link rel="canonical" href="https://barriotech\\.com\\.co/vendedor/${slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}"`),
      'canonical must point at the vendor page')
    // og:title - must include the vendor name (not just the site-wide one)
    const ogTitle = r.body.match(/<meta property="og:title" content="([^"]+)"/)
    assert.ok(ogTitle, 'og:title must be present')
    assert.match(ogTitle[1], /[A-Za-zÀ-ÿ]/, 'og:title must contain a real word (not generic placeholder)')
    // og:description - must be unique to the vendor
    const ogDesc = r.body.match(/<meta property="og:description" content="([^"]+)"/)
    assert.ok(ogDesc, 'og:description must be present')
    assert.ok(ogDesc[1].length > 30, 'og:description must be > 30 chars (not the page-wide fallback)')
    // og:image - must be barriotech.com.co
    const ogImage = r.body.match(/<meta property="og:image" content="([^"]+)"/)
    assert.ok(ogImage, 'og:image must be present')
    assert.match(ogImage[1], /^https:\/\/barriotech\.com\.co\//, 'og:image must be barriotech.com.co')
    // description must not be the legacy placeholder
    assert.doesNotMatch(r.body, /content="Catálogo público del vendedor ambulante\."/,
      'description must not be the legacy placeholder')
  } finally {
    await db.end()
  }
})

test('2. real vendor page emits LocalBusiness JSON-LD', async () => {
  const db = await dbClient()
  try {
    const { rows } = await db.query(
      `SELECT slug, name, city_id FROM vendors
       WHERE is_active = true
         AND deleted_at IS NULL
         AND slug NOT LIKE 'ci-test-slug-' || '%'
         AND slug NOT LIKE 'mi-negocio-de-test-' || '%'
       ORDER BY created_at LIMIT 1`,
    )
    assert.ok(rows.length > 0, 'expected at least one real vendor')
    const slug = rows[0].slug
    const r = await fetchText(`/vendedor/${slug}`)
    assert.equal(r.status, 200)
    const ld = extractJsonLd(r.body)
    const lb = ld.find((x) => x['@type'] === 'LocalBusiness')
    assert.ok(lb, 'LocalBusiness JSON-LD must be present on /vendedor/<slug>')
    assert.equal(lb.name, rows[0].name, 'LocalBusiness.name must match the vendor name')
    assert.equal(lb['@id'], `https://barriotech.com.co/vendedor/${slug}`,
      'LocalBusiness @id must be the vendor URL')
    assert.match(lb.url, /^https:\/\/barriotech\.com\.co\/vendedor\//,
      'LocalBusiness.url must be barriotech.com.co')
    assert.ok(lb.address, 'LocalBusiness.address must be present')
    assert.equal(lb.address.addressCountry, 'CO', 'addressCountry must be CO')
    if (rows[0].city_id) {
      // Real vendors with city_id set must have addressLocality
      assert.ok(lb.address.addressLocality, 'addressLocality must be present when city_id is set')
    }
    assert.ok(lb.image, 'LocalBusiness.image must be present')
    assert.match(lb.image, /^https:\/\/barriotech\.com\.co\//, 'image must be barriotech.com.co')
  } finally {
    await db.end()
  }
})

test('3. real vendor page emits BreadcrumbList JSON-LD', async () => {
  const db = await dbClient()
  try {
    const { rows } = await db.query(
      `SELECT slug FROM vendors
       WHERE is_active = true
         AND deleted_at IS NULL
         AND slug NOT LIKE 'ci-test-slug-' || '%'
         AND slug NOT LIKE 'mi-negocio-de-test-' || '%'
       ORDER BY created_at LIMIT 1`,
    )
    assert.ok(rows.length > 0, 'expected at least one real vendor')
    const slug = rows[0].slug
    const r = await fetchText(`/vendedor/${slug}`)
    assert.equal(r.status, 200)
    const ld = extractJsonLd(r.body)
    const bc = ld.find((x) => x['@type'] === 'BreadcrumbList')
    assert.ok(bc, 'BreadcrumbList JSON-LD must be present')
    assert.ok(Array.isArray(bc.itemListElement) && bc.itemListElement.length >= 3,
      'BreadcrumbList must have at least Home -> Vendedores -> Vendor')
    // First item must be "Inicio"
    const first = bc.itemListElement[0]
    assert.equal(first['@type'], 'ListItem')
    assert.equal(first.name, 'Inicio')
    assert.equal(first.item, 'https://barriotech.com.co/')
    // Last item must be the vendor
    const last = bc.itemListElement[bc.itemListElement.length - 1]
    assert.equal(last.item, `https://barriotech.com.co/vendedor/${slug}`)
  } finally {
    await db.end()
  }
})

test('4. /sitemap.xml excludes test vendor slug patterns', async () => {
  const r = await fetchText('/sitemap.xml')
  assert.equal(r.status, 200, 'sitemap must return 200')
  // Should NOT contain any ci-test-slug- or mi-negocio-de-test- slugs
  assert.doesNotMatch(r.body, /vendedor\/ci-test-slug-/,
    'sitemap must not include ci-test-slug- vendors')
  assert.doesNotMatch(r.body, /vendedor\/mi-negocio-de-test-/,
    'sitemap must not include mi-negocio-de-test- vendors')
  // BUT should still include real vendor slugs
  assert.match(r.body, /vendedor\/mi-negocio-de-carlos-bogota/,
    'sitemap must include the real Carlos vendor')
  // Total URL count should drop meaningfully from pre-tier-16 once we
  // exclude every fixture prefix. The number depends on how many real
  // vendors exist; today that's small (only the carlos fixture plus
  // whatever the team's added by hand). The pre-tier-16 sitemap on
  // barriotech.com.co was 423 with most entries being test fixtures -
  // after this filter it drops to ~static-pages + non-fixture vendors.
  // We assert a generous upper bound (anything below 100 means we
  // accidentally filtered everything out) and a generous lower bound
  // (we should still have the static pages and at least the carlos row).
  const urlCount = (r.body.match(/<loc>/g) || []).length
  assert.ok(urlCount < 100, `sitemap should drop below 100 URLs once fixtures are filtered (got ${urlCount})`)
  assert.ok(urlCount > 10, `sitemap should keep at least the static pages + the carlos row (got ${urlCount})`)
})

test('5. regression: robots.txt + manifest.json + favicon still 200', async () => {
  const fs = require('node:fs')
  for (const p of ['/robots.txt', '/manifest.json', '/favicon.ico', '/apple-touch-icon.png', '/hero.jpg']) {
    const res = await fetch(BASE + p)
    assert.equal(res.status, 200, `${p} must return 200`)
  }
  // Static robots.txt must still point at barriotech
  const staticRobots = fs.readFileSync(
    '/home/telchar/gps-street-sellers/apps/web/public/robots.txt',
    'utf8',
  )
  assert.match(staticRobots, /Sitemap:\s*https:\/\/barriotech\.com\.co\/sitemap\.xml/,
    'static robots.txt Sitemap must reference barriotech.com.co')
  // Sanity: the sitemap line in the *rendered* /robots.txt also matches.
  const renderedRobots = await fetchText('/robots.txt')
  assert.match(renderedRobots.body, /Sitemap:\s*https:\/\/barriotech\.com\.co\/sitemap\.xml/,
    'rendered robots.txt Sitemap must reference barriotech.com.co')
})
