'use client'

import Link from 'next/link'
import { ChevronRight, Package, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'

interface Props {
  /** All products count (published + hidden). */
  totalCount: number
  /** Hidden (is_active=false) products. */
  hiddenCount: number
  /**
   * Migration 102 Phase C: when true, the vendor's category is a
   * service category (clases/bienestar/belleza/hogar/eventos). The
   * tile flips its copy from "Mis productos" to "Mis servicios" and
   * updates the empty-state hint accordingly. The call site already
   * has the vendor's category from /api/vendors/me, so passing this
   * is a one-line addition in the parent.
   */
  isServiceCategory?: boolean
}

/**
 * Sprint 8 D.2: dashboard tile that surfaces the publish-state breakdown
 * of the seller's catalog. Replaces the previous "Editar productos · N"
 * link with a richer card showing:
 *   - N total productos (large)
 *   - N publicados / N ocultos (smaller, with eye icons)
 *   - hint copy when there are 0 products or hidden products
 *
 * Click target is the whole card → goes to /products so the seller can
 * add new items or flip the visibility on existing ones.
 *
 * Migration 102 Phase C: copy flips to "Mis servicios" for service
 * sellers so the dashboard doesn't talk about "productos" to a
 * hair-salon or dance-class seller.
 */
export function ProductsMetricTile({ totalCount, hiddenCount, isServiceCategory = false }: Props) {
  const publishedCount = totalCount - hiddenCount
  const noun = isServiceCategory ? 'servicios' : 'productos'
  const singular = isServiceCategory ? 'servicio' : 'producto'
  return (
    <Link href="/products" className="block" data-testid="products-metric-tile">
      <Card variant="outlined" className="p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-primary-50 flex items-center justify-center">
              {isServiceCategory ? (
                <Sparkles size={20} className="text-primary-700" aria-hidden="true" />
              ) : (
                <Package size={20} className="text-primary-700" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Mis {noun}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="font-bold text-gray-900">{totalCount}</span> en total
              </p>
              {totalCount > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                    <Eye size={12} aria-hidden="true" />
                    {publishedCount} {publishedCount === 1 ? 'publicado' : 'publicados'}
                  </span>
                  {hiddenCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-amber-700 font-medium"
                      data-testid="dashboard-hidden-count"
                    >
                      <EyeOff size={12} aria-hidden="true" />
                      {hiddenCount} {hiddenCount === 1 ? 'oculto' : 'ocultos'}
                    </span>
                  )}
                </div>
              )}
              {totalCount === 0 && (
                <p className="text-xs text-amber-700 mt-1 font-medium">
                  {isServiceCategory
                    ? `Empezá publicando tu primer ${singular}.`
                    : 'Empezá publicando tu primer producto.'}
                </p>
              )}
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400 shrink-0 mt-1" aria-hidden="true" />
        </div>
      </Card>
    </Link>
  )
}