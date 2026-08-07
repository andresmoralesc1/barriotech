'use client'

import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Star, Circle, Apple, UtensilsCrossed, CupSoda, Palette, Shirt, Package, GraduationCap, Sparkles, Scissors, Wrench, PartyPopper } from 'lucide-react'
import type { Vendor, VendorCategory, VehicleType } from '@/lib/core/types'
import { getCategoryInfo, VEHICLE_TYPES } from '@/lib/core/constants'

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

interface VendorProfileProps {
  vendor: Vendor
}

export function VendorProfile({ vendor }: VendorProfileProps) {
  const category = getCategoryInfo(vendor.category)
  const IconComponent = CategoryIconMap[vendor.category]

  return (
    <Card variant="elevated" className="p-6">
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
        {/* Hero photo — large on the left, square */}
        <div className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 flex-shrink-0 rounded-2xl overflow-hidden relative bg-gray-100">
          {vendor.photoUrl ? (
            <img
              src={vendor.photoUrl}
              alt={vendor.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
                ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div
            className={clsx(
              'w-full h-full flex items-center justify-center',
              !vendor.photoUrl && 'hidden'
            )}
            style={{ background: category.color }}
          >
            <IconComponent size={64} className="text-white" />
          </div>
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left">
          {/* Name with small category icon inline */}
          <h2 className="text-2xl sm:text-3xl font-bold flex items-center justify-center sm:justify-start gap-2 flex-wrap">
            <IconComponent
              size={22}
              className="flex-shrink-0"
              style={{ color: category.color }}
            />
            <span>{vendor.name}</span>
            {vendor.isVerified && (
              <span title="Vendedor verificado" className="text-xl">✅</span>
            )}
          </h2>

          {/* Status + category badges */}
          <div className="flex items-center justify-center sm:justify-start gap-2 mt-2 flex-wrap">
            {vendor.isActive && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Circle size={8} fill="currentColor" className="text-green-500" />
                Activo
              </Badge>
            )}
            <Badge variant="outline">{category.label}</Badge>
          </div>

          {/* Rating */}
          <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
            <Star size={20} className="text-yellow-500 fill-yellow-500" />
            {/* Same guard as VendorCard: ratingAvg can be null until the
                vendor accumulates reviews. Server returns COALESCE. */}
            <span className="text-xl font-bold">
              {typeof vendor.ratingAvg === 'number' ? vendor.ratingAvg.toFixed(1) : '—'}
            </span>
            <span className="text-gray-500">({vendor.reviewCount ?? 0} reseñas)</span>
          </div>

          <p className="text-gray-600 mt-4">{vendor.description}</p>
        </div>
      </div>

      {/* Vehicle / carrito */}
      {(vendor.vehicleType || vendor.vehiclePhotoUrl) && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Su vehículo
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {vendor.vehiclePhotoUrl && (
              <img
                src={vendor.vehiclePhotoUrl}
                alt={
                  VEHICLE_TYPES.find((v) => v.id === vendor.vehicleType)?.label ?? 'Vehículo'
                }
                className="w-20 h-20 rounded-xl object-cover border border-gray-200"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            {vendor.vehicleType && (
              <Badge variant="outline" className="flex items-center gap-1.5 text-sm">
                <span aria-hidden="true">
                  {VEHICLE_TYPES.find((v) => v.id === vendor.vehicleType)?.emoji}
                </span>
                {VEHICLE_TYPES.find((v) => v.id === vendor.vehicleType)?.label ?? vendor.vehicleType}
              </Badge>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
