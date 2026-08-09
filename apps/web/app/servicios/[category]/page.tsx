import type { Metadata } from 'next'
import Script from 'next/script'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import pool from '@/lib/db'
import { getCategoryInfo, CATEGORIES } from '@/lib/core/constants/categories'
import { SERVICE_CATEGORIES, type ServiceCategory } from '@/lib/core/types'

/**
 * Per-service-category SEO landing page at /servicios/[category].
 *
 * Migration 102 (services) Phase D3: generates one prerendered
 * landing page per service category (clases, bienestar, belleza,
 * hogar, eventos) so each gets:
 *   1. unique <title> / <meta description> / og:image tailored to
 *      the service — e.g. "Clases de salsa en Bogotá | BarrioTech"
 *   2. ItemList JSON-LD with LocalBusiness per visible vendor
 *   3. BreadcrumbList (Inicio / Servicios / Clases)
 *   4. canonical pointing to the category page
 *
 * The page is reachable from:
 *   - The 11 category chips in /map's FilterBar (when user picks
 *     a service chip, the link is /servicios/<cat>)
 *   - Organic search ("clases de salsa bogotá" → /servicios/clases
 *     which lists all the city's clases vendors)
 *   - Direct share
 *
 * Why a separate route instead of expanding /ciudades/[slug]:
 * The city page is per-city × all-categories; the service page
 * is per-category × all-cities. Different dimensions, different
 * SEO value. We can later add /servicios/[category]/[city] for
 * the city×category combo (buyer explore report item #15).
 */

type ServiceVendor = {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  city_id: string | null
  photo_url: string | null
  rating: number | string | null
  review_count: number | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  is_verified: boolean
  has_travels: boolean
  service_count: number
}

const BASE_URL = 'https://barriotech.com.co'

// generateStaticParams only includes the 5 service categories. A
// product category (frutas/comida/etc) passed at this path
// 404s via the `notFound()` branch — the URL namespace
// /servicios/<x> is intentionally service-only.
export function generateStaticParams() {
  return SERVICE_CATEGORIES.map((category) => ({ category }))
}

async function fetchVendorsForCategory(category: ServiceCategory): Promise<ServiceVendor[]> {
  // Join on products to get service aggregates (count + has_travels)
  // — the same shape returned by /api/vendors for the LATERAL join.
  // We don't need a separate call because the SEO page is
  // prerendered (not realtime) — a single slow query is fine.
  const { rows } = await pool.query<ServiceVendor>(
    `SELECT v.id, v.slug, v.name, v.description, v.category, v.city_id,
            v.photo_url, v.phone, v.rating, v.review_count,
            v.latitude, v.longitude, v.is_verified,
            COALESCE(svc.has_travels, false) AS has_travels,
            COALESCE(svc.service_count, 0)::int AS service_count
     FROM vendors v
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE p.kind = 'service' AND p.is_active)::int AS service_count,
         bool_or(p.modality = 'travels' AND p.is_active AND p.kind = 'service') AS has_travels
       FROM products p
       WHERE p.vendor_id = v.id
     ) svc ON true
     WHERE v.category = $1
       AND v.is_active = true
       AND v.deleted_at IS NULL
       AND v.slug IS NOT NULL
       AND v.slug NOT LIKE 'ci-%'
       AND v.slug NOT LIKE 'mi-negocio-de-test-%'
     ORDER BY v.is_verified DESC, v.rating DESC NULLS LAST, v.created_at DESC
     LIMIT 50`,
    [category],
  )
  return rows
}

function isServiceCategory(value: string): value is ServiceCategory {
  return (SERVICE_CATEGORIES as string[]).includes(value)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  if (!isServiceCategory(category)) {
    return { title: 'Categoría no encontrada' }
  }
  const cat = getCategoryInfo(category)
  const vendors = await fetchVendorsForCategory(category)
  const count = vendors.length
  // Title is service-flavored, not product-flavored. "Clases de
  // <icon> en Colombia" reads more naturally than the original
  // "Comida callejera, frutas, artesanías" copy. Theog: og:image
  // pulls from /hero.jpg (TODO: per-category hero when design
  // budget allows).
  const title = `${cat.label} cerca de ti | BarrioTech`
  const description =
    count > 0
      ? `${count} vendedor${count === 1 ? '' : 'es'} de ${cat.label.toLowerCase()} activo${count === 1 ? '' : 's'} en Colombia. Conecta por WhatsApp, agenda por servicio a domicilio cuando esté disponible, y encuentra ${cat.label.toLowerCase()} cerca de ti en el mapa en vivo.`
      : `${cat.label} en BarrioTech — pronto. Regístrate como vendedor para aparecer aquí cuando lances en tu ciudad.`
  return {
    title,
    description,
    alternates: { canonical: `/servicios/${category}` },
    openGraph: {
      title,
      description,
      url: `/servicios/${category}`,
      type: 'website',
      locale: 'es_CO',
      siteName: 'BarrioTech',
      images: [{ url: '/hero.jpg', width: 1200, height: 630, alt: `${cat.label} en BarrioTech` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/hero.jpg'],
    },
    robots: { index: true, follow: true },
  }
}

function buildItemListJsonLd(category: ServiceCategory, vendors: ServiceVendor[]) {
  const cat = getCategoryInfo(category)
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${cat.label} en BarrioTech`,
    itemListElement: vendors.map((v, idx) => {
      const item: Record<string, unknown> = {
        '@type': 'LocalBusiness',
        // Service-flavored JSON-LD: @type=Service signals to search
        // engines that this LocalBusiness offers a service (not a
        // product). Additional `Service` field on each item would
        // be the canonical pattern; the LocalBusiness + geo +
        // aggregateRating triple is enough for now.
        '@id': `${BASE_URL}/vendedor/${v.slug}`,
        name: v.name,
        url: `${BASE_URL}/vendedor/${v.slug}`,
        image: v.photo_url ? `${BASE_URL}${v.photo_url}` : `${BASE_URL}/hero.jpg`,
        description: v.description ?? undefined,
        telephone: v.phone ?? undefined,
        address: { '@type': 'PostalAddress', addressCountry: 'CO' },
        priceRange: '$$',
        additionalType: cat.label,
      }
      if (v.latitude != null && v.longitude != null) {
        item.geo = {
          '@type': 'GeoCoordinates',
          latitude: v.latitude,
          longitude: v.longitude,
        }
      }
      const ratingNum = v.rating == null ? null : Number(v.rating)
      if (ratingNum && ratingNum > 0 && v.review_count && v.review_count > 0) {
        item.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: ratingNum.toFixed(1),
          reviewCount: v.review_count,
          bestRating: 5,
          worstRating: 1,
        }
      }
      return { '@type': 'ListItem', position: idx + 1, item }
    }),
  }
}

function buildBreadcrumbJsonLd(category: ServiceCategory) {
  const cat = getCategoryInfo(category)
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Servicios', item: `${BASE_URL}/servicios` },
      { '@type': 'ListItem', position: 3, name: cat.label, item: `${BASE_URL}/servicios/${category}` },
    ],
  }
}

export default async function ServiceCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  if (!isServiceCategory(category)) {
    notFound()
  }
  const cat = getCategoryInfo(category)
  const vendors = await fetchVendorsForCategory(category)
  const itemListJsonLd = buildItemListJsonLd(category, vendors)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(category)

  return (
    <>
      <Script
        id={`svc-${category}-items`}
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <Script
        id={`svc-${category}-breadcrumb`}
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <main className="mx-auto max-w-5xl px-4 py-12">
        <nav className="mb-6 text-sm text-gray-500" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-orange-600">Inicio</Link></li>
            <li>/</li>
            <li><Link href="/servicios" className="hover:text-orange-600">Servicios</Link></li>
            <li>/</li>
            <li className="text-gray-900">{cat.label}</li>
          </ol>
        </nav>

        <header className="mb-10">
          {/* The H1 color uses the category's own color so the page
              feels native to the category rather than generic. Falls
              back to a neutral orange if the constant is missing. */}
          <h1
            className="text-4xl font-bold tracking-tight"
            style={{ color: cat.color }}
          >
            {cat.label}
          </h1>
          <p className="mt-2 text-gray-600">
            {vendors.length > 0
              ? `${vendors.length} vendedor${vendors.length === 1 ? '' : 'es'} de ${cat.label.toLowerCase()} activo${vendors.length === 1 ? '' : 's'} en Colombia`
              : 'Próximamente en tu ciudad'}
          </p>
          <p className="mt-3 text-sm text-gray-500">
            ¿Vendes {cat.label.toLowerCase()}?{' '}
            <Link href="/register" className="text-orange-600 underline">
              Regístrate gratis
            </Link>{' '}
            y aparece en esta página.
          </p>
          <Link
            href={`/map?category=${category}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-orange-600"
          >
            Ver en mapa en vivo
          </Link>
        </header>

        {vendors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-lg font-medium text-gray-900">
              Aún no hay vendedores activos de {cat.label.toLowerCase()}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              ¿Ofreces {cat.label.toLowerCase()}?{' '}
              <Link href="/register" className="text-orange-600 underline">
                Regístrate
              </Link>{' '}
              para ser el primero en tu ciudad.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => {
              const ratingNum = v.rating == null ? null : Number(v.rating)
              return (
                <li key={v.id}>
                  <Link
                    href={`/vendedor/${v.slug}`}
                    className="block rounded-lg border border-gray-200 p-5 transition hover:border-orange-300 hover:shadow-sm"
                  >
                    <h2 className="font-semibold text-gray-900">{v.name}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {v.service_count}{' '}
                      {v.service_count === 1 ? 'servicio' : 'servicios'}
                      {v.has_travels && (
                        <span className="ml-2 inline-block text-[10px] font-semibold uppercase tracking-wide bg-secondary/10 text-secondary-700 px-1.5 py-0.5 rounded-full">
                          A domicilio
                        </span>
                      )}
                    </p>
                    {v.description && (
                      <p className="mt-3 line-clamp-2 text-sm text-gray-700">
                        {v.description}
                      </p>
                    )}
                    {ratingNum && ratingNum > 0 && v.review_count ? (
                      <p className="mt-3 text-sm text-gray-600">
                        ★ {ratingNum.toFixed(1)}{' '}
                        <span className="text-gray-400">
                          ({v.review_count})
                        </span>
                      </p>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}
