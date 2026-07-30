import type { Metadata } from 'next'
import Script from 'next/script'
import Link from 'next/link'
import pool from '@/lib/db'
import { COLOMBIA_CITIES, getCityById } from '@/lib/core/constants/cities'

/**
 * City index at /ciudades.
 *
 * Lists every Colombian city we serve, grouped by department, with the
 * count of active vendors in each.  This page is the hub for the
 * long-tail "vendedores en <city>" search traffic that the per-city
 * /ciudades/[slug] pages capitalise on.
 *
 * Tier 22 (SEO): emits a CollectionPage JSON-LD so the index itself
 * is indexable as a coherent document, not just a list of links.
 */

export const metadata: Metadata = {
  title: 'Ciudades — Vendedores informales en toda Colombia | BarrioTech',
  description:
    'Explora vendedores informales por ciudad en Colombia. Comida callejera, frutas, artesanías y más — en vivo en Bogotá, Medellín, Cali, Barranquilla y 14 ciudades más.',
  alternates: { canonical: '/ciudades' },
  openGraph: {
    title: 'Vendedores informales en toda Colombia | BarrioTech',
    description:
      'Explora vendedores informales por ciudad en Colombia. 18 ciudades, mapa en vivo.',
    url: '/ciudades',
    type: 'website',
    locale: 'es_CO',
    siteName: 'BarrioTech',
    images: [{ url: '/hero.jpg', width: 1200, height: 630, alt: 'Vendedores BarrioTech Colombia' }],
  },
  robots: { index: true, follow: true },
}

type CityCount = { city_id: string; count: number }

async function fetchCityCounts(): Promise<Map<string, number>> {
  try {
    // Exclude test fixtures (same filter as the sitemap so the counts
    // here match what users can actually browse).
    const { rows } = await pool.query<CityCount>(
      `SELECT city_id, COUNT(*)::int AS count
       FROM vendors
       WHERE is_active = true
         AND deleted_at IS NULL
         AND slug IS NOT NULL
         AND slug NOT LIKE 'ci-%'
         AND slug NOT LIKE 'mi-negocio-de-test-%'
         AND slug != 'mi-negocio-de-carlos-bogota'
       GROUP BY city_id`,
    )
    return new Map(rows.map((r) => [r.city_id, r.count]))
  } catch {
    return new Map()
  }
}

export default async function CiudadesIndexPage() {
  const counts = await fetchCityCounts()

  // Group by department for a tidy 2-column layout.
  const byDepartment = new Map<string, typeof COLOMBIA_CITIES>()
  for (const c of COLOMBIA_CITIES) {
    const list = byDepartment.get(c.department) ?? []
    list.push(c)
    byDepartment.set(c.department, list)
  }

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Vendedores informales en Colombia',
    description: 'Índice de ciudades donde BarrioTech conecta compradores con vendedores informales.',
    url: 'https://barriotech.com.co/ciudades',
    inLanguage: 'es-CO',
    hasPart: COLOMBIA_CITIES.map((c) => ({
      '@type': 'City',
      name: c.name,
      url: `https://barriotech.com.co/ciudades/${c.id}`,
      containedInPlace: { '@type': 'Country', name: 'Colombia' },
    })),
  }

  return (
    <>
      <Script
        id="ciudades-collection"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(collectionJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <main className="mx-auto max-w-5xl px-4 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">
            Vendedores en tu ciudad
          </h1>
          <p className="mt-3 text-lg text-gray-600">
            Explora vendedores informales activos en {COLOMBIA_CITIES.length}{' '}
            ciudades de Colombia. Comida, frutas, artesanías y más — en vivo.
          </p>
        </header>

        <div className="grid gap-8 md:grid-cols-2">
          {[...byDepartment.entries()].map(([dept, cities]) => (
            <section key={dept}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {dept}
              </h2>
              <ul className="space-y-1">
                {cities.map((c) => {
                  const count = counts.get(c.id) ?? 0
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/ciudades/${c.id}`}
                        className="flex items-baseline justify-between rounded-md px-3 py-2 hover:bg-orange-50"
                      >
                        <span className="font-medium text-gray-900">
                          {c.name}
                        </span>
                        <span className="text-sm text-gray-500">
                          {count > 0
                            ? `${count} vendedor${count === 1 ? '' : 'es'}`
                            : 'Próximamente'}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  )
}
