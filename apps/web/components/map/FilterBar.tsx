'use client'

import { Search, X } from 'lucide-react'
import { useStore } from '@/store/useStore'

/**
 * Phase pivot (2026-08-10): the /map is now strict geo — products
 * only, with a search bar. The previous version had 11 category
 * chips, a "Servicios" group chip, an "Ofrece a domicilio"
 * modality toggle, and 6 distance chips. All of those moved
 * off the map:
 *   - Category filtering belongs on /servicios (the dedicated
 *     service browse page), not on the geo map.
 *   - "Ofrece a domicilio" is service-only — and services
 *     aren't on the map anymore.
 *   - Distance chips are now handled by the geolocation prompt
 *     (city picker in the page header) and the map's auto-fit
 *     bounds. The buyer doesn't need to pick a manual radius.
 *
 * The "Limpiar filtros" button stays in the JSX (rendered when
 * a filter is active) so the search-bar X still has a sibling
 * affordance if the buyer types something.
 */
export function FilterBar() {
  const searchQuery = useStore((s) => s.filters.searchQuery)
  const setFilters = useStore((s) => s.setFilters)

  return (
    <div className="bg-white rounded-xl shadow-md p-4">
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input
          type="text"
          placeholder="Buscar vendedores por nombre…"
          value={searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="w-full pl-10 pr-10 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          aria-label="Buscar vendedores por nombre"
        />
        {searchQuery && (
          <button
            onClick={() => setFilters({ searchQuery: '' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            aria-label="Limpiar búsqueda"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
