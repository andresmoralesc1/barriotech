import type { Metadata } from 'next'
import Link from 'next/link'
import { getCategoryInfo } from '@/lib/core/constants/categories'
import { SERVICE_CATEGORIES } from '@/lib/core/types'

/**
 * /servicios — service-categories index. Phase D3 companion to
 * /servicios/[category]. The page lists the 5 service categories
 * (clases, bienestar, belleza, hogar, eventos) and routes each to
 * its own SEO landing page at /servicios/[category]. Acts as the
 * entry point for a buyer who wants to "browse all services" instead
 * of landing on a specific category.
 */
export const metadata: Metadata = {
  title: 'Servicios cerca de ti | BarrioTech',
  description:
    'Encuentra clases, bienestar, belleza, hogar y eventos cerca de ti en Colombia. BarrioTech conecta vendedores de servicios informales con clientes por WhatsApp.',
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

export default function ServicesIndexPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <nav className="mb-6 text-sm text-gray-500" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><Link href="/" className="hover:text-orange-600">Inicio</Link></li>
          <li>/</li>
          <li className="text-gray-900">Servicios</li>
        </ol>
      </nav>

      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Servicios</h1>
        <p className="mt-2 text-gray-600">
          Encuentra vendedores de servicios informales cerca de ti.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_CATEGORIES.map((cat) => {
          const info = getCategoryInfo(cat)
          return (
            <li key={cat}>
              <Link
                href={`/servicios/${cat}`}
                className="block rounded-lg border border-gray-200 p-5 transition hover:border-orange-300 hover:shadow-sm"
              >
                <h2
                  className="font-semibold"
                  style={{ color: info.color }}
                >
                  {info.label}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Ver vendedores de {info.label.toLowerCase()} cerca de ti
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
