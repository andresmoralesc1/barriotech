'use client'

import { Card } from '@/components/ui/Card'
import { Package, Plus, User, ChevronDown } from 'lucide-react'
import type { Product } from '@/lib/core/types'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { User as UserType } from '@/store/useStore'

interface VendorProductsProps {
  products: Product[]
  onAddToCart?: (product: Product) => void
  compact?: boolean
  user?: UserType | null
  /** N12: extra photos per product id */
  extraPhotos?: Record<string, string[]>
}

export function VendorProducts({ products, onAddToCart, compact, user, extraPhotos }: VendorProductsProps) {
  const router = useRouter()

  // Migration 102: derive whether any offerings on display are services
  // so the section header + empty-state copy can flip.
  const hasServices = products.some((p) => p.kind === 'service')
  const onlyServices = products.length > 0 && products.every((p) => p.kind === 'service')

  if (products.length === 0) {
    return (
      <Card variant="outlined" className="p-4 text-center text-gray-500">
        Este vendedor aún no tiene productos
      </Card>
    )
  }

  return (
    <div>
      <h3 className="text-lg font-bold mb-3">
        {onlyServices ? 'Servicios' : hasServices ? 'Productos y servicios' : 'Productos'}
      </h3>
      <div className={clsx('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            compact={compact}
            onAddToCart={onAddToCart}
            user={user}
            router={router}
            extraPhotos={extraPhotos?.[product.id]}
          />
        ))}
      </div>
    </div>
  )
}

interface ProductCardProps {
  product: Product
  compact?: boolean
  onAddToCart?: (product: Product) => void
  user?: UserType | null
  router: ReturnType<typeof useRouter>
  extraPhotos?: string[]
}

function ProductCard({ product, compact, onAddToCart, user, router, extraPhotos }: ProductCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const allPhotos = [product.photoUrl, ...(extraPhotos ?? [])].filter(Boolean) as string[]
  const showPhoto = allPhotos.length > 0 && !imgFailed
  const currentPhoto = allPhotos[photoIdx] || product.photoUrl
  // Migration 102: service-only display bits. Empty strings when the
  // row is a product so the JSX below stays branchless.
  const isService = product.kind === 'service'
  const pricingUnitSuffix = isService ? pricingUnitLabel(product.pricingUnit ?? null) : ''
  const durationLabel = isService && product.durationMinutes
    ? ` · ${product.durationMinutes} min`
    : ''

  // Decide whether to show a "Ver más" expand trigger. Hidden when
  // compact mode is on (the seller dashboard uses compact to fit as
  // many products in view as possible) or when the description fits
  // in 2 lines anyway (we don't measure line-height here, so this is
  // a heuristic — we always show the button but it toggles a no-op
  // expansion when the content is already short).
  const showExpandToggle = !compact
  const canExpand = showExpandToggle && (product.description?.length ?? 0) > 60

  return (
    <Card variant="outlined" className="overflow-hidden p-0">
      {!compact && (
        <div className="w-full aspect-square bg-gray-100 overflow-hidden relative">
          {showPhoto ? (
            <img
              src={currentPhoto}
              alt={product.name}
              loading="lazy"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package size={32} className="text-gray-400" />
            </div>
          )}
          {/* N12: dots indicator for multi-photo carousel. Dots are 6×6
              visual but the clickable button is 24×24 for mobile targets. */}
          {allPhotos.length > 1 && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {allPhotos.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPhotoIdx(idx)}
                  aria-label={`Foto ${idx + 1} de ${allPhotos.length}`}
                  className={`min-w-[24px] min-h-[24px] flex items-center justify-center`}
                >
                  <span
                    aria-hidden="true"
                    className={`block rounded-full transition-all ${
                      idx === photoIdx ? 'bg-white w-4 h-1.5' : 'bg-white/60 w-1.5 h-1.5'
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="p-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold leading-tight">{product.name}</h4>
            {/* Expandable description — uses the grid-rows trick so the
                card height transitions smoothly from 2 lines to the
                full description. The chevron rotates 180° when open
                to match the direction of the expansion. */}
            <div
              className={clsx(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                // line-clamp-2 is applied to a child div so it only kicks
                // in when collapsed. When expanded, we render the full
                // text without the clamp.
                expanded ? 'opacity-100' : 'opacity-100'
              )}
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
              aria-hidden={!expanded}
            >
              <div className="min-h-0 overflow-hidden">
                <p className={clsx(
                  'text-sm text-gray-500 mt-1',
                  !expanded && 'line-clamp-2'
                )}>
                  {product.description}
                </p>
              </div>
            </div>
            <p className="text-primary-700 font-bold mt-1">
              ${product.price.toLocaleString('es-CO')}{pricingUnitSuffix}{durationLabel}
            </p>
            {/* Migration 102: a small "A domicilio" pill for service offerings
                where the provider travels to the client (modality='travels').
                Helps the buyer spot mobile hairdressers / tatuadores a domicilio
                without reading the description. */}
            {isService && product.modality === 'travels' && (
              <span className="inline-block mt-1 text-[11px] font-semibold uppercase tracking-wide bg-secondary/10 text-secondary-700 px-2 py-0.5 rounded-full">
                A domicilio
              </span>
            )}
          </div>
          {onAddToCart ? (
            user ? (
              <button
                onClick={() => onAddToCart(product)}
                className="p-2 bg-primary text-white rounded-full hover:bg-primary-600 transition-colors flex-shrink-0"
                // Migration 102 Phase D2: copy flips to "Reservar"
                // for service offerings (clases/masajes/etc.). The
                // cart flow is still a kind-agnostic WhatsApp
                // handoff (no date/time picker yet) — but at least
                // the button copy matches the buyer's mental model:
                // you book a class, you add a product to a cart.
                aria-label={
                  product.kind === 'service'
                    ? `Reservar ${product.name}`
                    : `Agregar ${product.name} al carrito`
                }
                title={
                  product.kind === 'service'
                    ? 'Reservar'
                    : 'Agregar al carrito'
                }
              >
                <Plus size={18} />
              </button>
            ) : (
              <button
                onClick={() => router.push('/register')}
                className="p-2 min-w-[36px] min-h-[36px] bg-gray-200 text-gray-600 rounded-full hover:bg-gray-300 transition-colors flex-shrink-0 flex items-center justify-center"
                title="Regístrate para agregar"
                aria-label="Regístrate para agregar al carrito"
              >
                <User size={18} />
              </button>
            )
          ) : null}
        </div>
        {/* "Ver más / Ver menos" toggle. We only mount it when the
            description is long enough to warrant expansion; short
            descriptions just stay line-clamped (button hidden). */}
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 inline-flex items-center gap-1 min-h-[44px] px-2 text-sm font-medium text-primary-700 hover:text-primary-800 transition-colors rounded"
          >
            <span>{expanded ? 'Ver menos' : 'Ver más'}</span>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={clsx(
                'transition-transform duration-300 ease-out',
                expanded && 'rotate-180'
              )}
            />
          </button>
        )}
      </div>
    </Card>
  )
}

// Migration 102: map pricing_unit to a short Spanish suffix shown next
// to the price on service cards. Empty string for null (product rows
// or service rows where the field somehow didn't round-trip).
function pricingUnitLabel(
  unit: 'unit' | 'hour' | 'session' | 'class' | null
): string {
  switch (unit) {
    case 'hour': return ' / hora'
    case 'session': return ' / sesión'
    case 'class': return ' / clase'
    case 'unit': return ' / unidad'
    case null: return ''
  }
}
