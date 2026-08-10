'use client'

import { clsx } from 'clsx'
import { Search, X, Home, Sparkles } from 'lucide-react'
import {
  Apple,
  UtensilsCrossed,
  CupSoda,
  Palette,
  Shirt,
  Package,
  GraduationCap,
  Sparkles as SparklesIcon,
  Scissors,
  Wrench,
  PartyPopper,
  MapPin,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { CATEGORIES } from '@/lib/core/constants'
import { GRADIENTS } from '@/lib/design-tokens'
import { SERVICE_CATEGORIES, type VendorCategory } from '@/lib/core/types'

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

  const hasActiveFilters =
    filters.category !== null ||
    !!filters.categoryOr ||
    filters.maxDistanceMeters !== null ||
    filters.searchQuery !== '' ||
    filters.modality !== null

  const clearFilters = () => {
    setFilters({
      category: null,
      categoryOr: null,
      maxDistanceMeters: null,
      searchQuery: '',
      modality: null,
    })
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
            onClick={() => {
              setFilters({ category: null, categoryOr: null })
            }}
            className={clsx(
              `shrink-0 snap-start px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
              filters.category === null && !filters.categoryOr
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            Todos
          </button>
          {/* Phase F3: "Servicios" group chip — toggles all 5 service
              categories at once. Mutually exclusive with the
              individual category chips below (clicking one clears
              categoryOr). Saves the buyer 5 clicks when they just
              want to see "any service nearby". */}
          <button
            onClick={() => {
              if (filters.categoryOr) {
                setFilters({ categoryOr: null })
              } else {
                setFilters({ category: null, categoryOr: [...SERVICE_CATEGORIES] })
              }
            }}
            aria-pressed={!!filters.categoryOr}
            className={clsx(
              `shrink-0 snap-start px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
              filters.categoryOr
                ? `${GRADIENTS.chipActive} text-white shadow-md`
                : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200'
            )}
          >
            <Sparkles size={14} aria-hidden="true" />
            Servicios
          </button>
          {CATEGORIES.map((cat) => {
            const IconComponent = CategoryIconMap[cat.id]
            // Phase F3: disable individual category chips when the
            // "Servicios" group chip is active — they're
            // sub-categories of that group, so picking one would
            // be confusing. Visual treatment: muted background +
            // "Subsumed" hover title.
            const subsumed = !!filters.categoryOr
            return (
              <button
                key={cat.id}
                onClick={() => {
                  if (subsumed) return
                  setFilters({ category: cat.id as VendorCategory, categoryOr: null })
                }}
                className={clsx(
                  `shrink-0 snap-start px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
                  filters.category === cat.id && !subsumed
                    ? 'text-white'
                    : subsumed
                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
                style={filters.category === cat.id && !subsumed ? { background: cat.color } : {}}
                disabled={subsumed}
                title={subsumed ? 'Activo bajo "Servicios" — desactívalo para filtrar por categoría' : undefined}
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

      {/* Migration 102 (services) Phase A2: "Ofrece a domicilio" chip.
          Sits in its own row above the distance row so it's discoverable
          without competing with the 11 category chips. Toggling on
          sets `modality='travels'` which the map fetches as a query
          param; the API filters vendors to those with at least one
          service offering that travels. The Home icon + the "A
          domicilio" copy mirror the pill rendered on service cards
          in VendorProducts.tsx, so the buyer sees the same word
          across the funnel. */}
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() =>
            setFilters({ modality: filters.modality === 'travels' ? null : 'travels' })
          }
          className={clsx(
            `shrink-0 px-3 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${CHIP_TAP}`,
            filters.modality === 'travels'
              ? 'bg-secondary text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
          aria-pressed={filters.modality === 'travels'}
        >
          <Home size={14} />
          Ofrece a domicilio
        </button>
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