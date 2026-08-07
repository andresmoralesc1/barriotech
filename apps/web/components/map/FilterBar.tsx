'use client'

import { clsx } from 'clsx'
import { Search, X } from 'lucide-react'
import {
  Apple,
  UtensilsCrossed,
  CupSoda,
  Palette,
  Shirt,
  Package,
  GraduationCap,
  Sparkles,
  Scissors,
  Wrench,
  PartyPopper,
  MapPin,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { CATEGORIES } from '@/lib/core/constants'
import type { VendorCategory } from '@/lib/core/types'

// Mapeo de categorías a iconos Lucide
const CategoryIconMap: Record<VendorCategory, typeof Apple> = {
  frutas: Apple,
  comida: UtensilsCrossed,
  bebidas: CupSoda,
  artesanias: Palette,
  ropa: Shirt,
  otros: Package,
  // service categories — migration 102
  clases: GraduationCap,
  bienestar: Sparkles,
  belleza: Scissors,
  hogar: Wrench,
  eventos: PartyPopper,
}

// M-004 fix: 44px is the Apple HIG / WCAG 2.5.5 minimum tap target. The old
// 36px fell below the threshold and made chips hard to hit with the thumb on
// mobile. Used everywhere a clickable filter chip is rendered.
const CHIP_TAP = 'min-h-[44px]'

// null = "Todos" (sin límite de distancia). Número = metros máximos.
const DISTANCES: { label: string; value: number | null }[] = [
  { label: 'Todos', value: null },
  { label: '500m', value: 500 },
  { label: '1km', value: 1000 },
  { label: '2km', value: 2000 },
  { label: '5km', value: 5000 },
  { label: '10km', value: 10000 },
]

export function FilterBar() {
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)

  const hasActiveFilters = filters.category !== null || filters.maxDistanceMeters !== null || filters.searchQuery !== ''

  const clearFilters = () => {
    setFilters({ category: null, maxDistanceMeters: null, searchQuery: '' })
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-4 space-y-4">
      {/* Buscador */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar vendedores por nombre..."
          value={filters.searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="w-full pl-10 pr-10 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        />
        {filters.searchQuery && (
          <button
            onClick={() => setFilters({ searchQuery: '' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Categorías */}
      <div className="relative">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory">
          <button
            onClick={() => setFilters({ category: null })}
            className={clsx(
              `shrink-0 snap-start px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
              filters.category === null
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            Todos
          </button>
          {CATEGORIES.map((cat) => {
            const IconComponent = CategoryIconMap[cat.id]
            return (
              <button
                key={cat.id}
                onClick={() => setFilters({ category: cat.id as VendorCategory })}
                className={clsx(
                  `shrink-0 snap-start px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
                  filters.category === cat.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
                style={filters.category === cat.id ? { background: cat.color } : {}}
              >
                <IconComponent size={16} />
                {cat.label}
              </button>
            )
          })}
        </div>
        {/* Indicador de scroll a la derecha */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-6 bg-gradient-to-l from-white to-transparent" aria-hidden="true" />
      </div>

      {/* Distancia */}
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {DISTANCES.map((dist) => (
            <button
              key={dist.value ?? 'all'}
              onClick={() => setFilters({ maxDistanceMeters: dist.value })}
              className={clsx(
                `shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
                filters.maxDistanceMeters === dist.value
                  ? 'bg-secondary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {dist.value !== null && <MapPin size={14} />}
              {dist.label}
            </button>
          ))}
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className={`ml-auto shrink-0 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1.5 ${CHIP_TAP}`}
          >
            <X size={14} />
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  )
}