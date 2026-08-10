'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { getCategoryInfo } from '@/lib/core/constants/categories'
import { COLOMBIA_CITIES, getCityById } from '@/lib/core/constants/cities'
import { SERVICE_CATEGORIES, isServiceCategory, type VendorCategory } from '@/lib/core/types'

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

interface Props {
  vendors: ServiceListing[]
}

/**
 * ServicesBrowse — city + category filter + WhatsApp CTA.
 *
 * Client component because the /servicios page is a server
 * component. The vendor list is fetched server-side and passed
 * in as a prop (small, <200 rows). We filter in-memory because
 * the table is bounded and the network roundtrip to re-query
 * on every filter change is unnecessary.
 *
 * Three filter controls:
 *   1. City dropdown (single-select, "Todas" default)
 *   2. Category chips (multi-select, "Todas" default)
 *   3. "Ofrece a domicilio" toggle (modality=travels)
 *
 * The "Reservar" button on each card opens WhatsApp with a
 * pre-filled message — same shape as the buyer-side
 * "Reservar" CTA in VendorProducts.tsx so the seller gets
 * the same request regardless of where the buyer tapped from.
 */
export function ServicesBrowse({ vendors }: Props) {
  const [cityId, setCityId] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [travelsOnly, setTravelsOnly] = useState(false)

  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      if (cityId && v.city_id !== cityId) return false
      if (categories.length > 0 && !categories.includes(v.category)) return false
      if (travelsOnly && !v.has_travels) return false
      return true
    })
  }, [vendors, cityId, categories, travelsOnly])

  // Group by city for the "browse" section. When a city is
  // selected, only that city renders. When no city is selected,
  // all cities render in a flat grid.
  const groupedByCity = useMemo(() => {
    const map = new Map<string, ServiceListing[]>()
    for (const v of filtered) {
      const key = v.city_id ?? 'sin-ciudad'
      const arr = map.get(key) ?? []
      arr.push(v)
      map.set(key, arr)
    }
    return map
  }, [filtered])

  // Cities that have at least one vendor in the filtered set.
  // Drives the city dropdown options so we don't show cities with
  // 0 matching vendors after the other filters apply.
  const citiesWithVendors = useMemo(() => {
    const set = new Set<string>()
    for (const v of filtered) if (v.city_id) set.add(v.city_id)
    return COLOMBIA_CITIES.filter((c) => set.has(c.id))
  }, [filtered])

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  const totalCount = filtered.length
  const totalAll = vendors.length

  return (
    <section aria-labelledby="browse-heading">
      <h2 id="browse-heading" className="text-lg font-semibold text-stone-800 mb-3">
        Por ciudad
      </h2>

      {/* Filter row */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor="services-city"
            className="block text-xs font-medium text-stone-600 mb-1"
          >
            Ciudad
          </label>
          <select
            id="services-city"
            value={cityId ?? ''}
            onChange={(e) => setCityId(e.target.value || null)}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          >
            <option value="">Todas ({COLOMBIA_CITIES.length})</option>
            {citiesWithVendors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <span className="block text-xs font-medium text-stone-600 mb-1">
            Categorías
          </span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((cat) => {
              const active = categories.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    active
                      ? 'text-white border-transparent'
                      : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
                  }`}
                  style={active ? { background: cat.color } : {}}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* "Ofrece a domicilio" toggle */}
      <label className="mb-6 inline-flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={travelsOnly}
          onChange={(e) => setTravelsOnly(e.target.checked)}
          className="w-4 h-4 rounded border-stone-300 text-primary focus:ring-primary"
        />
        <span className="text-stone-700 font-medium">Solo servicios a domicilio</span>
        <span className="text-xs text-stone-500">(modality: travels)</span>
      </label>

      <p className="mb-4 text-sm text-stone-600">
        {totalCount} de {totalAll} servicios
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-12 text-center">
          <p className="text-stone-700">No hay servicios que coincidan con los filtros.</p>
          <button
            onClick={() => {
              setCityId(null)
              setCategories([])
              setTravelsOnly(false)
            }}
            className="mt-3 text-sm font-medium text-primary-700 hover:text-primary-600"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {[...groupedByCity.entries()].map(([cityKey, list]) => {
            const city = getCityById(cityKey)
            return (
              <div key={cityKey}>
                <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">
                  {city?.name ?? 'Sin ciudad'} · <span className="text-stone-400">{list.length}</span>
                </h3>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((v) => (
                    <ServiceCard key={v.id} vendor={v} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const CATEGORY_OPTIONS: { id: VendorCategory; label: string; color: string }[] =
  SERVICE_CATEGORIES.map((id) => ({
    id,
    label: getCategoryInfo(id).label,
    color: getCategoryInfo(id).color,
  }))

function ServiceCard({ vendor }: { vendor: ServiceListing }) {
  const cat = isServiceCategory(vendor.category as Parameters<typeof isServiceCategory>[0])
    ? getCategoryInfo(vendor.category as Parameters<typeof getCategoryInfo>[0])
    : null
  const parts: string[] = []
  parts.push(`¡Hola ${vendor.name}!`)
  parts.push(`Quiero reservar: ${vendor.name}.`)
  if (vendor.price != null) {
    const price = typeof vendor.price === 'string' ? parseFloat(vendor.price) : vendor.price
    if (Number.isFinite(price) && price > 0) {
      parts.push(`Precio: $${price.toLocaleString('es-CO')}.`)
    }
  }
  if (vendor.duration_minutes) {
    const dur = vendor.duration_minutes < 60
      ? `${vendor.duration_minutes} min`
      : `${Math.round((vendor.duration_minutes / 6)) / 10} h`
    parts.push(`Duración: ${dur}.`)
  }
  if (vendor.modality === 'travels') {
    parts.push('Modalidad: a domicilio.')
  } else if (vendor.modality === 'remote') {
    parts.push('Modalidad: en línea.')
  } else if (vendor.modality === 'on_site') {
    parts.push('Modalidad: en tu local.')
  }
  if (vendor.description) {
    parts.push(`Notas: ${vendor.description}`)
  }
  parts.push('¿Qué fechas y horarios tienes disponibles?')
  const text = encodeURIComponent(parts.join('\n'))
  const whatsappHref = vendor.phone
    ? `https://wa.me/${vendor.phone.replace(/\D/g, '')}?text=${text}`
    : null

  return (
    <li>
      <article className="bg-white rounded-lg border border-stone-200 p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-semibold text-stone-900">{vendor.name}</h4>
          {cat && (
            <span
              className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
              style={{ background: cat.color, color: 'white' }}
            >
              {cat.label}
            </span>
          )}
        </div>
        {vendor.modality === 'travels' && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 mb-1">
            A domicilio
          </p>
        )}
        {vendor.modality === 'remote' && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 mb-1">
            En línea
          </p>
        )}
        {vendor.modality === 'on_site' && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-600 mb-1">
            En tu local
          </p>
        )}
        {vendor.description && (
          <p className="text-sm text-stone-600 line-clamp-3 flex-1">
            {vendor.description}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Link
            href={`/vendedor/${vendor.slug}`}
            className="text-xs font-medium text-stone-500 hover:text-stone-700"
          >
            Ver detalles
          </Link>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-600 transition-colors"
            >
              Reservar
            </a>
          ) : (
            <span className="text-xs text-stone-400">Sin WhatsApp</span>
          )}
        </div>
      </article>
    </li>
  )
}
