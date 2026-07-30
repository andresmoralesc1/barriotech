import type { Metadata } from 'next'
import Script from 'next/script'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import pool from '@/lib/db'
import { COLOMBIA_CITIES, getCityById } from '@/lib/core/constants/cities'
import { getCategoryInfo } from '@/lib/core/constants/categories'

/**
 * Per-city landing page at /ciudades/[slug].
 *
 * Tier 22 (SEO): generates one prerendered page per city in
 * COLOMBIA_CITIES so every supported city has a unique indexable
 * landing page with:
 *   1. unique <title> / <meta description> / og:image per city
 *   2. LocalBusiness JSON-LD per visible vendor (ItemList of LocalBusiness)
 *   3. BreadcrumbList to tie /ciudades/[slug] to /ciudades and /
 *   4. canonical pointing to the city page (not /map)
 *
 * Vendor data is filtered to exclude the same test fixtures the
 * sitemap excludes, so the count here matches what shows in the index.
 */

type CityVendor = {
  id: string
  slug: string
  name: string
  description: string | null
  category: string | null
  photo_url: string | null
  rating: number | string | null
  review_count: number | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  is_verified: boolean
}

const BASE_URL = 'https://barriotech.com.co'

export function generateStaticParams() {
  return COLOMBIA_CITIES.map((c) => ({ slug: c.id }))
}

async function fetchVendorsForCity(cityId: string): Promise<CityVendor[]> {
  const { rows } = await pool.query<CityVendor>(
    `SELECT id, slug, name, description, category, photo_url, phone,
            rating, review_count, latitude, longitude, is_verified
     FROM vendors
     WHERE city_id = $1
       AND is_active = true
       AND deleted_at IS NULL
       AND slug IS NOT NULL
       AND slug NOT LIKE 'ci-%'
       AND slug NOT LIKE 'mi-negocio-de-test-%'
       AND slug != 'mi-negocio-de-carlos-bogota'
     ORDER BY is_verified DESC, rating DESC NULLS LAST, created_at DESC
     LIMIT 50`,
    [cityId],
  )
  return rows
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const city = getCityById(slug)
  if (!city) return { title: 'Ciudad no encontrada' }

  const vendors = await fetchVendorsForCity(city.id)
  const count = vendors.length
  const title = `Vendedores en ${city.name} — Comida, frutas y más | BarrioTech`
  const description =
    count > 0
      ? `${count} vendedor${count === 1 ? '' : 'es'} informal${count === 1 ? '' : 'es'} activo${count === 1 ? '' : 's'} en ${city.name}, ${city.department}. Comida callejera, frutas, artesanías — mapa en vivo y contacto por WhatsApp.`
      : `Vendedores informales en ${city.name}, ${city.department}. BarrioTech conecta compradores con vendedores callejeros de la ciudad.`

  return {
    title,
    description,
    alternates: { canonical: `/ciudades/${city.id}` },
    openGraph: {
      title,
      description,
      url: `/ciudades/${city.id}`,
      type: 'website',
      locale: 'es_CO',
      siteName: 'BarrioTech',
      images: [{ url: '/hero.jpg', width: 1200, height: 630, alt: `Vendedores en ${city.name} — BarrioTech` }],
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

function buildItemListJsonLd(cityName: string, vendors: CityVendor[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Vendedores informales en ${cityName}`,
    itemListElement: vendors.map((v, idx) => {
      const category = v.category ? getCategoryInfo(v.category as Parameters<typeof getCategoryInfo>[0]) : null
      const ratingNum = v.rating == null ? null : Number(v.rating)
      const item: Record<string, unknown> = {
        '@type': 'LocalBusiness',
        '@id': `${BASE_URL}/vendedor/${v.slug}`,
        name: v.name,
        url: `${BASE_URL}/vendedor/${v.slug}`,
        image: v.photo_url ? `${BASE_URL}${v.photo_url}` : `${BASE_URL}/hero.jpg`,
        description: v.description ?? undefined,
        telephone: v.phone ?? undefined,
        address: { '@type': 'PostalAddress', addressCountry: 'CO' },
        priceRange: '$$',
        additionalType: category?.label ?? undefined,
      }
      if (v.latitude != null && v.longitude != null) {
        item.geo = {
          '@type': 'GeoCoordinates',
          latitude: v.latitude,
          longitude: v.longitude,
        }
      }
      if (ratingNum && ratingNum > 0 && v.review_count && v.review_count > 0) {
        item.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: ratingNum.toFixed(1),
          reviewCount: v.review_count,
          bestRating: 5,
          worstRating: 1,
        }
      }
      return {
        '@type': 'ListItem',
        position: idx + 1,
        item,
      }
    }),
  }
}

function buildBreadcrumbJsonLd(cityName: string, slug: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Ciudades', item: `${BASE_URL}/ciudades` },
      { '@type': 'ListItem', position: 3, name: cityName, item: `${BASE_URL}/ciudades/${slug}` },
    ],
  }
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const city = getCityById(slug)
  if (!city) notFound()

  const vendors = await fetchVendorsForCity(city.id)
  const itemListJsonLd = buildItemListJsonLd(city.name, vendors)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(city.name, city.id)

  return (
    <>
      <Script
        id={`city-${city.id}-items`}
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <Script
        id={`city-${city.id}-breadcrumb`}
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
            <li><Link href="/ciudades" className="hover:text-orange-600">Ciudades</Link></li>
            <li>/</li>
            <li className="text-gray-900">{city.name}</li>
          </ol>
        </nav>

        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">
            Vendedores en {city.name}
          </h1>
          <p className="mt-2 text-gray-600">
            {city.department}, Colombia ·{' '}
            {vendors.length > 0
              ? `${vendors.length} vendedor${vendors.length === 1 ? '' : 'es'} activo${vendors.length === 1 ? '' : 's'}`
              : 'Próximamente'}
          </p>
          <Link
            href={`/map?city=${city.id}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-orange-600"
          >
            Ver en mapa en vivo
          </Link>
        </header>

        {vendors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-lg font-medium text-gray-900">
              Aún no hay vendedores activos en {city.name}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              ¿Vendes comida, frutas o artesanías en la calle?{' '}
              <Link href="/register" className="text-orange-600 underline">
                Regístrate gratis
              </Link>{' '}
              y sé el primero.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => {
              const category = v.category
                ? getCategoryInfo(v.category as Parameters<typeof getCategoryInfo>[0])
                : null
              const ratingNum = v.rating == null ? null : Number(v.rating)
              return (
                <li key={v.id}>
                  <Link
                    href={`/vendedor/${v.slug}`}
                    className="block rounded-lg border border-gray-200 p-5 transition hover:border-orange-300 hover:shadow-sm"
                  >
                    <h2 className="font-semibold text-gray-900">{v.name}</h2>
                    {category && (
                      <p className="mt-1 text-sm text-gray-500">{category.label}</p>
                    )}
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
