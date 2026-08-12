'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MapPin, Heart, Settings } from 'lucide-react'
import { FilterBar } from '@/components/map/FilterBar'
import { CitySelector } from '@/components/map/CitySelector'
import { useStore } from '@/store/useStore'
import { useEffect } from 'react'
import type { Vendor } from '@/lib/core/types'

// Dynamic import para evitar SSR con Leaflet
// Phase H2: the loading state was a plain gray box (the only
// thing the user saw while MapView's 80+ components + leaflet
// bundle downloaded). Now it mimics the real map surface:
// fake map tiles as a grid of light gray cells, three pulse
// dots for "incoming vendor markers", and a centered
// "Cargando mapa…" label. When MapView takes over it
// replaces the skeleton via React's Suspense boundary.
const MapView = dynamic(
  () => import('@/components/map/MapView').then((m) => m.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 bg-stone-100 rounded-xl relative overflow-hidden" role="status" aria-label="Cargando mapa">
        <div className="absolute inset-0 grid grid-cols-6 grid-rows-4 gap-px">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="bg-stone-200/60 animate-pulse"
              style={{ animationDelay: `${(i % 8) * 80}ms` }}
            />
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm border border-stone-200 shadow-card rounded-full px-4 py-2 flex items-center gap-2 text-sm text-stone-700">
            <span
              className="inline-block w-3.5 h-3.5 border-2 border-primary-700 border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
            <span>Cargando mapa…</span>
          </div>
        </div>
      </div>
    ),
  }
)

// Transform API vendor to match Vendor type. Must keep `phone` so the
// bottom-sheet rendered inside MapView can show the contact CTAs (M-002).
function transformVendor(apiVendor: any): Vendor {
  return {
    id: apiVendor.id,
    userId: apiVendor.profile_id,
    name: apiVendor.name,
    category: apiVendor.category,
    description: apiVendor.description || '',
    photoUrl: apiVendor.photo_url || '',
    isActive: apiVendor.is_active,
    ratingAvg: apiVendor.ratingAvg ?? 0,
    reviewCount: apiVendor.reviewCount ?? 0,
    createdAt: apiVendor.created_at,
    latitude: apiVendor.latitude,
    longitude: apiVendor.longitude,
    phone: apiVendor.phone || null,
  }
}

export default function MapPage() {
  const router = useRouter()
  const user = useStore((s) => s.user)
  const vendorId = useStore((s) => s.vendorId)
  const setVendors = useStore((s) => s.setVendors)

  useEffect(() => {
    // Redirect sellers with vendorId to seller dashboard
    if ((user?.role === 'seller' || user?.role === 'service') && vendorId) {
      router.push('/dashboard')
      return
    }

    async function fetchVendors() {
      try {
        const res = await fetch('/api/vendors?active=true&withLocation=true')
        if (!res.ok) throw new Error('Failed to fetch vendors')
        const data = await res.json()
        const transformed = data.vendors.map(transformVendor)
        setVendors(transformed)
      } catch (err) {
        // Don't show fake mock data — let the empty-state UI explain the issue.
        console.error('Error fetching vendors:', err)
        setVendors([])
      }
    }
    fetchVendors()
  }, [setVendors])

  return (
    <div className="h-screen flex flex-col">
      {/* Header — Sprint 5 B-002: city selector gets priority on mobile
          because users in the street need to confirm what city they're
          browsing at a glance. Layout:
            - mobile (<sm): CitySelector top-left, page title below (small)
            - desktop: title + CitySelector side-by-side as before */}

      <header className="bg-white shadow-sm p-3 sm:p-4 flex items-center justify-between gap-2">
        {/* Mobile-only title — small, secondary. Hidden on sm+ because the
            SiteHeader already shows it there. */}
        <h1 className="text-sm font-medium text-gray-500 sm:hidden">
          BarrioTech
        </h1>
        {/* Desktop-only title — prominent, primary. */}
        <h1 className="hidden sm:block text-xl font-bold text-gray-800">
          BarrioTech
        </h1>
        {/* CitySelector takes the remaining space on mobile so the city
            name is the most prominent thing in the header. min-h-[44px]
            for the trigger button so it meets Apple HIG tap targets. */}
        <div className="flex-1 sm:flex-initial flex justify-end">
          <CitySelector />
        </div>
      </header>

      {/* Filtros */}
      <div className="px-4 pt-4">
        <FilterBar />
      </div>

      {/* Mapa */}
      <div className="flex-1 px-4 pb-4">
        <MapView />
      </div>

      {/* Bottom Nav — aria-label avoids landmark-unique violation. */}
      <nav className="bg-white border-t flex justify-around py-3" aria-label="Navegación de la cuenta">
        <Link href="/map" className="flex flex-col items-center text-primary-700">
          <MapPin size={24} />
          <span className="text-xs mt-1">Mapa</span>
        </Link>
        <Link href="/favorites" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <Heart size={24} />
          <span className="text-xs mt-1">Favoritos</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <Settings size={24} />
          <span className="text-xs mt-1">Ajustes</span>
        </Link>
      </nav>
    </div>
  )
}