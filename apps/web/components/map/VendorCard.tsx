'use client'

import { clsx } from 'clsx'
import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { VendorContactActions } from '@/components/vendor/VendorContactActions'
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
  Star,
  X,
  Home,
} from 'lucide-react'
import type { Vendor, VendorCategory } from '@/lib/core/types'
import { getCategoryInfo } from '@/lib/core/constants'
import { formatBusinessHoursShort } from '@/lib/business-hours'

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

interface VendorCardProps {
  vendor: Vendor
  compact?: boolean
  distance?: number // distancia en metros
  onClose?: () => void
  onViewDetails?: () => void
  isSponsored?: boolean
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`
  }
  return `${(meters / 1000).toFixed(1)}km`
}

export function VendorCard({ vendor, compact, distance, onClose, onViewDetails, isSponsored }: VendorCardProps) {
  const category = getCategoryInfo(vendor.category)
  const IconComponent = CategoryIconMap[vendor.category]

  const [imgFailed, setImgFailed] = useState(false)

  const showPhoto = vendor.photoUrl && !imgFailed

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 min-w-[200px]">
        {showPhoto ? (
          <img
            src={vendor.photoUrl}
            alt={vendor.name}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: category.color }}
          >
            <IconComponent size={24} className="text-white" />
          </div>
        )}
        <div>
          <h3 className="font-semibold flex items-center gap-1">
            {vendor.name}
            {vendor.isVerified && <span title="Vendedor verificado">✅</span>}
            {isSponsored && (
              <span
                title="Vendedor destacado — aparece primero"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-white"
              >
                ⭐ DESTACADO
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500">
            {category.label}
            {distance !== undefined && (
              <span className="ml-2 text-secondary font-medium">• {formatDistance(distance)}</span>
            )}
          </p>
          {/* Migration 102 Phase B: pill on the map popup so a buyer
              scanning the map can tell which vendors travel to the
              client before tapping through. The data comes from the
              /api/vendors LATERAL join (vendor.hasTravels) so we
              don't need a second round-trip. Same copy as the
              per-service pill in VendorProducts.tsx for consistency. */}
          {vendor.hasTravels && (
            <p className="mt-1">
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-secondary/10 text-secondary-700"
                title="Este vendedor ofrece servicios a domicilio"
              >
                <Home size={10} aria-hidden="true" />
                A domicilio
              </span>
            </p>
          )}
          {vendor.businessHours && (
            <p className="text-xs text-gray-400 mt-0.5">
              {vendor.isOpen !== false ? (
                <span className="text-green-600 font-medium">● Abierto</span>
              ) : (
                <span className="text-gray-500">● Cerrado</span>
              )}
              {' · '}
              {formatBusinessHoursShort(vendor.businessHours)}
            </p>
          )}
        </div>
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className="ml-auto text-xs font-medium text-primary hover:text-primary-700 flex items-center gap-0.5"
            aria-label="Ver detalles del vendedor"
          >
            Ver →
          </button>
        )}
      </div>
    )
  }

  return (
    <Card variant="elevated" className="p-4 relative">
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-2 right-2 z-10 p-1.5 rounded-full hover:bg-stone-100 transition-colors text-stone-500 hover:text-stone-900"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
      <div className="flex gap-4 pr-8">
        {showPhoto ? (
          <img
            src={vendor.photoUrl}
            alt={vendor.name}
            className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: category.color }}
          >
            <IconComponent size={32} className="text-white" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  {vendor.name}
                  {vendor.isVerified && <span title="Vendedor verificado" className="text-lg">✅</span>}
                </h3>
              <div className="flex items-center gap-2">
                <Badge variant="primary">{category.label}</Badge>
                {distance !== undefined && (
                  <Badge variant="secondary">
                    <MapPin size={12} className="inline mr-1" />
                    {formatDistance(distance)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Star size={16} className="text-yellow-500 fill-yellow-500" />
              {/* ratingAvg can be null when the vendor has no reviews yet
                  (server returns rating with COALESCE). Guard before .toFixed
                  to avoid crash on click. Fallback shows em-dash (—) so the
                  UI doesn't lie about a rating that doesn't exist. */}
              <span className="font-semibold">
                {typeof vendor.ratingAvg === 'number' ? vendor.ratingAvg.toFixed(1) : '—'}
              </span>
            </div>
          </div>

          <p className="text-gray-600 mt-2 text-sm line-clamp-2">
            {vendor.description}
          </p>

          {/* Contact CTAs (tel / WhatsApp / directions). Always shown in the
              bottom-sheet so a buyer can reach the vendor without leaving the
              map. The component itself guards each button on `phone` and
              lat/lng so vendors without a number just hide the row. */}
          <div className="mt-3">
            <VendorContactActions vendor={vendor} />
          </div>

          <div className="flex gap-2 mt-3">
            {onViewDetails && (
              <Button size="sm" onClick={onViewDetails}>
                Ver detalles
              </Button>
            )}
            {onClose && (
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}