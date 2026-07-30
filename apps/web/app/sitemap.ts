import type { MetadataRoute } from 'next'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'

/**
 * Dynamic sitemap — pulled at build time / on ISR.
 * Includes all active vendor URLs (for SEO indexing) plus static marketing pages.
 *
 * i18n:
 *   The site is currently ES-only. Earlier we emitted hreflang for /es/ /pt/
 *   /en/ — but those URL prefixes don't exist yet (no [locale] segment in
 *   app/). Search engines flagged every entry with three 404 alternates. We
 *   now emit ONLY `x-default` (canonical Spanish URL) until a locale segment
 *   is added. When translation lands, swap `LOCALES_ENABLED` to true and
 *   every URL will start emitting 3 hreflangs automatically — assuming the
 *   corresponding routes exist.
 */

const BASE = 'https://barriotech.com.co'

// Flip to true the day [locale] routing lands. Until then, emitting hreflang
// for non-existent URLs is an SEO sin (Search Console "alternates have errors").
const LOCALES_ENABLED = false
const LOCALES = ['es', 'pt', 'en'] as const

type LocalizedEntry = { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }

const STATIC_PAGES: LocalizedEntry[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/map', priority: 0.9, changeFrequency: 'weekly' },
  // Buyer-facing discovery pages.
  { path: '/products', priority: 0.8, changeFrequency: 'daily' },
  // Vendor onboarding entry point; helps long-tail "vender en BarrioTech" traffic.
  { path: '/inversionistas', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/como-funciona', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/nosotros', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/contacto', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/preguntas-frecuentes', priority: 0.6, changeFrequency: 'monthly' },
  // Legal
  { path: '/privacidad', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terminos', priority: 0.3, changeFrequency: 'yearly' },
  // NOTE: /login and /register are intentionally omitted — robots.txt
  // already Disallows them. Listing them in the sitemap would contradict
  // the robots policy and waste crawl budget.
]

function buildAlternates(esPath: string) {
  // x-default → Spanish URL (no prefix). Always emit.
  const languages: Record<string, string> = {
    'x-default': `${BASE}${esPath}`,
  }
  if (LOCALES_ENABLED) {
    for (const loc of LOCALES) {
      languages[loc] = `${BASE}/${loc}${esPath}`
    }
  }
  return languages
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${BASE}${page.path}`,
    lastModified: new Date(),
    priority: page.priority,
    changeFrequency: page.changeFrequency,
    alternates: { languages: buildAlternates(page.path) },
  }))

  let vendorPages: MetadataRoute.Sitemap = []
  try {
    // Tier 16: exclude every fixture prefix the test suites use, so
    // Google Search Console doesn't index the placeholder pages they
    // create. We currently whitelist exactly one row that the tier 16
    // test relies on (mi-negocio-de-carlos-bogota) - when real vendors
    // start showing up they'll use natural slugs (no ci-/mi-negocio-de-
    // prefix) and won't be filtered.
    //
    // The prefixes below cover every fixture flavour observed in the DB
    // (scripts/tests/_lib/seed.js creates the `ci-` rows; the explorer's
    // "create vendor" form creates the `mi-negocio-de-*` ones).
    //
    // Tier 19-prep: ci-tier11-/ci-tier12- were leaking. The vendors
    // smoke + seo suites (Tier 11 + 12) generate these slugs without
    // is_active=false cleanup, so they showed up live in the sitemap
    // and would have been indexed by GSC. Adding the exclusion now so
    // GSC stops seeing fixture URLs.
    const result = await pool.query(
      `SELECT slug, GREATEST(
         COALESCE(created_at, NOW()),
         COALESCE(location_updated_at, '1970-01-01'::timestamptz)
       ) AS last_modified
       FROM vendors
       WHERE is_active = true
         AND slug IS NOT NULL
         AND deleted_at IS NULL
         AND slug NOT LIKE 'ci-test-slug-' || '%'
         AND slug NOT LIKE 'ci-orders-' || '%'
         AND slug NOT LIKE 'ci-drilldown-' || '%'
         AND slug NOT LIKE 'ci-bare-' || '%'
         AND slug NOT LIKE 'ci-other-' || '%'
         AND slug NOT LIKE 'ci-tier' || '%'
         AND slug NOT LIKE 'mi-negocio-de-test-' || '%'
         AND (
           slug NOT LIKE 'mi-negocio-de-' || '%'
           OR slug = 'mi-negocio-de-carlos-bogota'
         )`
    )
    vendorPages = result.rows.map((row) => {
      const esPath = `/vendedor/${row.slug}`
      return {
        url: `${BASE}${esPath}`,
        lastModified: new Date(row.last_modified ?? Date.now()),
        priority: 0.8,
        changeFrequency: 'weekly' as const,
        alternates: { languages: buildAlternates(esPath) },
      }
    })
  } catch (err) {
    logger.error(serializeErr(err), 'Sitemap: failed to fetch vendors')
  }

  return [...staticPages, ...vendorPages]
}