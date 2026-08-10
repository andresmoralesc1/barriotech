'use client'

import Link from 'next/link'
import { ChevronLeft, Package, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  onBack: () => void
  productCount: number
  /**
   * Sprint 8 D.2: how many of the seller's products are currently hidden
   * (is_active = false). When > 0 we surface a "Tienes N ocultos" hint in the
   * header so the seller remembers to flip them back on when stock returns.
   * Pass 0 (default) to omit the hint.
   */
  hiddenCount?: number
  /**
   * Migration 102: when true, the page title flips from "Mis Productos"
   * to "Mis Productos y Servicios". Driven by the vendor's category —
   * service categories flip the copy so the page matches the seller's
   * mental model.
   */
  isServiceCategory?: boolean
}

/**
 * Top bar for the seller /products page — back to dashboard, page title,
 * live product count + (when applicable) hidden-product hint.
 *
 * Uses Button + chevron (matching other seller pages). The back button
 * is wired to the parent's `tryGoBack` so unsaved-form-changes funnel
 * through the discard modal.
 */
export function ProductsPageHeader({ onBack, productCount, hiddenCount = 0, isServiceCategory = false }: Props) {
  return (
    <header className="bg-white shadow-sm p-4 flex items-center gap-4">
      <Button variant="ghost" onClick={onBack} aria-label="Volver al dashboard">
        <ChevronLeft size={20} />
      </Button>
      <div className="flex-1 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight">
          {isServiceCategory ? 'Mis Productos y Servicios' : 'Mis Productos'}
        </h1>
        <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>
            {productCount} {productCount === 1 ? (isServiceCategory ? 'oferta' : 'producto') : (isServiceCategory ? 'ofertas' : 'productos')}
          </span>
          {hiddenCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="inline-flex items-center gap-1 text-amber-700 font-medium"
                data-testid="hidden-count"
              >
                <EyeOff size={12} aria-hidden="true" />
                {hiddenCount} {hiddenCount === 1 ? 'oculto' : 'ocultos'}
              </span>
            </>
          )}
        </p>
      </div>
    </header>
  )
}