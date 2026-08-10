import type { Metadata } from 'next'
import Link from 'next/link'
import pool from '@/lib/db'
import { getCategoryInfo } from '@/lib/core/constants/categories'
import { SERVICE_CATEGORIES } from '@/lib/core/types'
import { ServicesBrowse } from './ServicesBrowse'

/**
 * /servicios — service-categories index + browse by city.
 *
 * Phase pivot (2026-08-10): the previous design was a SEO
 * landing with 5 category cards linking to /servicios/[category].
 * Now that services are no longer on the map, this is the
 * primary discovery surface for services. The page has two
 * sections:
 *   1. Category cards (5) — quick entry to per-category SEO
 *      pages (/servicios/belleza, /servicios/clases, etc.)
 *   2. Browse by city — all active service vendors grouped
 *      by city, with a city dropdown filter and per-vendor
 *      "Reservar" WhatsApp CTA. The browse is a client
 *      component (ServicesBrowse) that handles the city
 *      filter + vendor card list.
 *
 * Why a client island for the list, not a pure server component:
 * the user wanted filtering by city without a full page
 * navigation, and the underlying /api/vendors endpoint does
 * not yet accept a "services only" filter. Fetching all
 * service vendors once on initial load + filtering
 * client-side is fast enough at the MVP scale (≤200 vendors
 * per city across the 18 Colombian cities).
 */

type ServiceListing = {
  id: string
  slug: string
  name: string
  category: string
  description: string | null
  city_id: string | null
  modality: 'on_site' | 'travels' | 'remote' | null
  duration_minutes: number | null
  pricing_unit: 'unit' | 'hour' | 'session' | 'class' | null
  price: string | number | null
  phone: string | null
  has_travels: boolean
}

async function fetchServiceVendors(): Promise<ServiceListing[]> {
  // Phase pivot (2026-08-10): services are no longer on the map
  // (filters.ts excludes service categories from withLocation=true).
  // This query is the canonical source for /servicios. It joins
  // vendors to a LATERAL product aggregate that pulls the first
  // active service offering per vendor — duration, modality,
  // pricing_unit, price. We pick the lowest-priced active
  // offering as a stable representative value (the buyer sees
  // ONE "starting from" hint per vendor, not a list).
  const { rows } = await pool.query<ServiceListing>(
    `SELECT v.id, v.slug, v.name, v.category, v.description, v.city_id,
            v.phone,
            p.modality, p.duration_minutes, p.pricing_unit, p.price,
            COALESCE(svc.has_travels, false) AS has_travels
     FROM vendors v
     LEFT JOIN LATERAL (
       SELECT bool_or(p.modality = 'travels' AND p.is_active AND p.kind = 'service') AS has_travels
       FROM products p
       WHERE p.vendor_id = v.id
     ) svc ON true
     LEFT JOIN LATERAL (
       SELECT p.modality, p.duration_minutes, p.pricing_unit, p.price
       FROM products p
       WHERE p.vendor_id = v.id
         AND p.is_active = true
         AND p.kind = 'service'
       ORDER BY p.price ASC NULLS LAST, p.created_at ASC
       LIMIT 1
     ) p ON true
     WHERE v.is_active = true
       AND v.deleted_at IS NULL
       AND v.slug IS NOT NULL
       AND v.category = ANY($1::text[])
     ORDER BY v.is_verified DESC, v.name ASC
     LIMIT 200`,
    [SERVICE_CATEGORIES as readonly string[]],
  )
  return rows
}

export const metadata: Metadata = {
  title: 'Servicios cerca de ti | BarrioTech',
  description:
    'Encuentra clases, bienestar, belleza, hogar y eventos cerca de ti en Colombia. Filtra por ciudad y categoría. Contacta directo por WhatsApp.',
  alternates: { canonical: '/servicios' },
  openGraph: {
    title: 'Servicios cerca de ti | BarrioTech',
    description:
      'Encuentra clases, bienestar, belleza, hogar y eventos cerca de ti en Colombia.',
    url: '/servicios',
    type: 'website',
    locale: 'es_CO',
    siteName: 'BarrioTech',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Servicios cerca de ti | BarrioTech',
    description:
      'Encuentra clases, bienestar, belleza, hogar y eventos cerca de ti en Colombia.',
  },
  robots: { index: true, follow: true },
}

export default async function ServicesIndexPage() {
  // Phase pivot: services are no longer on the map. This page is
  // the primary discovery surface for them. We fetch the active
  // service vendors server-side (the table is small — even with
  // thousands of vendors the join is fast) and pass the array to
  // the client island for the city filter.
  const vendors = await fetchServiceVendors()

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <nav className="mb-6 text-sm text-stone-500" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><Link href="/" className="hover:text-primary-700">Inicio</Link></li>
          <li>/</li>
          <li className="text-stone-900">Servicios</li>
        </ol>
      </nav>

      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-stone-900">Servicios</h1>
        <p className="mt-2 text-stone-600">
          Encuentra vendedores de servicios informales cerca de ti.
        </p>
      </header>

      {/* Category cards — entry points to per-category SEO pages. */}
      <section aria-labelledby="cat-heading" className="mb-12">
        <h2 id="cat-heading" className="text-lg font-semibold text-stone-800 mb-3">
          Por categoría
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_CATEGORIES.map((cat) => {
            const info = getCategoryInfo(cat)
            return (
              <li key={cat}>
                <Link
                  href={`/servicios/${cat}`}
                  className="block rounded-lg border border-stone-200 p-5 transition hover:border-primary-300 hover:shadow-sm bg-white"
                >
                  <h3
                    className="font-semibold"
                    style={{ color: info.color }}
                  >
                    {info.label}
                  </h3>
                  <p className="mt-1 text-sm text-stone-500">
                    Ver vendedores de {info.label.toLowerCase()} cerca de ti
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Browse by city — client component with the vendor list. */}
      <ServicesBrowse vendors={vendors} />
    </main>
  )
}
