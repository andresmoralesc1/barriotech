'use client'

import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { BarChart3, Package, Settings, Edit3, ChevronRight, Camera, RefreshCw, BatteryLow, Zap, Store } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SellerDashboard } from '@/components/seller/SellerDashboard'
import { ConnectivityIndicator } from '@/components/seller/ConnectivityIndicator'
import { FloatingActionButton } from '@/components/seller/FloatingActionButton'
import { CopyPublicLink } from '@/components/seller/CopyPublicLink'
import { ProductsMetricTile } from '@/components/seller/ProductsMetricTile'
import { isServiceCategory, type VendorCategory } from '@/lib/core/types'
import { toast as notify } from '@/components/ui/Toast'
import { VendorVisibility } from '@/components/seller/VendorVisibility'
import { WhatsAppCatalog } from '@/components/seller/WhatsAppCatalog'
import { useStore } from '@/store/useStore'
import { clientLog } from '@/lib/client-logger'

// Heavy / map-bound / WS-bound components — dynamic-imported with ssr:false
// so a failure inside any of them doesn't take down the whole dashboard.
// Each one has a lightweight skeleton fallback so the layout stays stable.
const PullToRefresh = dynamic(() => import('@/components/seller/PullToRefresh').then(m => m.PullToRefresh), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-background-cream pb-24">{/* skeleton handled by child */}</div>,
})
const VendorSwitcher = dynamic(() => import('@/components/seller/VendorSwitcher').then(m => m.VendorSwitcher), {
  ssr: false,
  loading: () => <div className="h-12 rounded-lg bg-white animate-pulse" />,
})
const LiveViewers = dynamic(() => import('@/components/seller/LiveViewers').then(m => m.LiveViewers), {
  ssr: false,
  loading: () => <div className="h-8 w-32 rounded bg-gray-100 animate-pulse" />,
})
const BusinessHours = dynamic(() => import('@/components/seller/BusinessHours').then(m => m.BusinessHours), {
  ssr: false,
  loading: () => <div className="h-32 rounded-lg bg-white animate-pulse" />,
})
const LocationHistory = dynamic(() => import('@/components/seller/LocationHistory').then(m => m.LocationHistory), {
  ssr: false,
  loading: () => <div className="h-48 rounded-lg bg-white animate-pulse" />,
})
const ManualLocationPicker = dynamic(() => import('@/components/seller/ManualLocationPicker').then(m => m.ManualLocationPicker), {
  ssr: false,
  loading: () => <div className="h-56 rounded-lg bg-gray-100 animate-pulse" />,
})

// View-model for the active vendor in this dashboard. Fields are a mix of
// snake_case (from /api/vendors/me) and camelCase (the seller components we
// pass data into). Only the fields this page actually reads are listed.
interface VendorData {
  id: string
  name?: string
  description?: string
  // photo_url is the raw API field; photoUrl is used by some child components.
  photo_url?: string | null
  photoUrl?: string | null
  category?: string
  isActive?: boolean
  stationType?: 'fixed' | 'mobile'
  latitude?: number
  longitude?: number
  cityId?: string | null
  slug?: string
  geoMode?: 'precise' | 'battery'
  geoZoneLat?: number | null
  geoZoneLng?: number | null
  geoZoneRadiusM?: number | null
}

interface Product {
  id: string
  name: string
  description: string
  price: number
  photo_url: string | null
  // Sprint 6 D.1: per-product publish flag. Dashboard fetches with
  // includeDrafts=true so it sees hidden products too.
  is_active: boolean
}

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background-cream flex items-center justify-center">
      <div className="text-center">
        {/* sr-only h1 for axe page-has-heading-one — visible to screen readers */}
        <h1 className="sr-only">Cargando panel de vendedor</h1>
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
        <p className="text-gray-500">Cargando tu panel...</p>
      </div>
    </div>
  )
}

export function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const [vendors, setVendors] = useState<VendorData[]>([])
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorData, setVendorData] = useState<VendorData | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Location sharing state
  const [sharingLocation, setSharingLocation] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [locationSuccess, setLocationSuccess] = useState(false)

  // B6 fix: hydration flag so we don't read store before Zustand hydrates.
  const [hasHydrated, setHasHydrated] = useState(false)
  useEffect(() => {
    setHasHydrated(true)
  }, [])

  // B4 fix: AbortController so pending getCurrentPosition doesn't fire setState on unmount.
  const geolocationAbortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)

  const fetchDashboardData = async (specificVendorId?: string) => {
    setLoadError(null)
    setLoading(true)
    try {
      // B2 fix: check r.ok on /api/vendors/me; redirect to /login on 401.
      const meRes = await fetch('/api/vendors/me', { credentials: 'include' })
      if (meRes.status === 401) {
        await logout()
        router.push('/login')
        return
      }
      if (!meRes.ok) {
        setLoadError('No pudimos cargar tu información. Intenta de nuevo.')
        setLoading(false)
        return
      }
      const data = await meRes.json()
      // N16: vendors array (new) or vendor (legacy)
      const list = (data.vendors ?? (data.vendor ? [data.vendor] : [])) as VendorData[]
      // P2-2 (audit 2026-07-27): instead of redirecting to /onboarding
      // when the seller has no vendor yet, fall through and render the
      // "no vendors yet" empty-state below. Reasons:
      //   1. /onboarding is where the FIRST seller is created; a re-entry
      //      from /dashboard created a second redirect loop in some
      //      navigation flows.
      //   2. After email verification (P1-2) a seller lands here
      //      directly; an immediate redirect to /onboarding reads as
      //      "wrong page" rather than "next step".
      //   3. The dashboard is the seller's home — they should
      //      understand why it's empty, not be teleported elsewhere.
      // The empty state CTA points to /onboarding directly.
      setVendors(list)

      // Pick the active vendor: ?vendor= param > localStorage > first
      let activeVendor = list[0]
      const wantedId = specificVendorId ?? searchParams.get('vendor')
      if (wantedId) {
        const found = list.find((v) => v.id === wantedId)
        if (found) activeVendor = found
      } else {
        try {
          const persisted = localStorage.getItem('active_vendor_id')
          if (persisted) {
            const found = list.find((v) => v.id === persisted)
            if (found) activeVendor = found
          }
        } catch {}
      }

      setVendorId(activeVendor.id)
      setVendorData(activeVendor)

      const productsRes = await fetch(`/api/products?vendorId=${activeVendor.id}&includeDrafts=true`, { credentials: 'include' })
      if (productsRes.ok) {
        const productsData = await productsRes.json()
        setProducts(productsData.products ?? [])
      }
    } catch (err) {
      // B-009 fix: use clientLog instead of console.error.
      clientLog.error('Dashboard load error:', err)
      setLoadError('Error de conexión. Verifica tu internet.')
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!hasHydrated) return
    if (user === null) return
    if (user?.role !== 'seller' && user?.role !== 'service') {
      // Seller-only page. Since role is immutable post-register, redirect
      // non-sellers to the public map.
      router.push('/map')
      return
    }
    cancelledRef.current = false
    fetchDashboardData()
    return () => {
      cancelledRef.current = true
      geolocationAbortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, hasHydrated])

  const handleShareLocation = async () => {
    if (!navigator.geolocation) {
      setLocationError('Tu navegador no soporta geolocalización')
      return
    }

    setSharingLocation(true)
    setLocationError('')
    setLocationSuccess(false)

    // B4 fix: cancel any pending share before starting a new one.
    geolocationAbortRef.current?.abort()
    const ac = new AbortController()
    geolocationAbortRef.current = ac

    // Wrap getCurrentPosition in a promise so we can race against abort.
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setLocationError('Permiso de ubicación denegado. Actívalo en tu navegador.')
          } else if (err.code === err.TIMEOUT) {
            setLocationError('La solicitud tardó demasiado. Intenta de nuevo.')
          } else {
            setLocationError('No pude obtener tu ubicación')
          }
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
      ac.signal.addEventListener('abort', () => resolve(null))
    })

    if (ac.signal.aborted || cancelledRef.current) {
      setSharingLocation(false)
      return
    }

    if (!position) {
      setSharingLocation(false)
      return
    }

    const { latitude, longitude } = position.coords
    try {
      const res = await fetch('/api/vendors/me/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ latitude, longitude }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLocationError(data.error || 'Error al guardar ubicación')
      } else {
        setLocationSuccess(true)
        setLocationError('')
        notify({ title: 'Ubicación actualizada ✓', kind: 'success' })
        // B7 fix: refresh local vendorData with new coords to avoid full re-fetch.
        setVendorData((v) => v ? { ...v, latitude, longitude } : v)
      }
    } catch {
      setLocationError('Error de conexión')
    } finally {
      setSharingLocation(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
          <p className="text-gray-500">Cargando tu panel...</p>
        </div>
      </div>
    )
  }

  // B5 fix: surface load errors with retry button instead of silent empty screen.
  if (loadError) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center p-6">
        <Card variant="outlined" className="p-6 max-w-sm text-center">
          <p className="text-red-600 mb-3">{loadError}</p>
          <Button onClick={() => fetchDashboardData()} className="w-full">
            <RefreshCw size={16} className="mr-2" />
            Reintentar
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <PullToRefresh onRefresh={fetchDashboardData}>
      {/* max-w-2xl mx-auto: caps the width and centers the dashboard on
          desktop so cards don't stretch full-bleed across 1920px monitors.
          pb-24 keeps space for the fixed bottom nav. */}
      <div className="min-h-screen bg-background-cream pb-24 md:max-w-2xl md:mx-auto">
        {/* Header */}
        <header className="bg-white shadow-sm p-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              Mi panel
              <Badge variant="primary">Vendedor</Badge>
            </h1>
            {/* B6 fix: don't render fullName until store hydrated to avoid flicker. */}
            <p className="text-sm text-gray-500">
              {hasHydrated ? (user?.fullName || 'Vendedor') : '\u00A0'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ConnectivityIndicator />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Cerrar
            </Button>
          </div>
        </header>

        <div className="p-4 space-y-4">
          {/* FIELD-FIX (2026-07-27): inline empty state when no vendor
              is currently active on the map. /api/auth/register auto-
              bootstraps a placeholder vendor (is_active=false) in the
              same tx, so the OLD trigger `vendors.length === 0` was
              dead code — every seller had a vendor row from minute 0.
              The useful signal is "this vendor is not yet visible to
              buyers", which means `!vendors.some(v => v.isActive)`.
              We point to /onboarding because that's where the
              VendorFormSlide sets isActive=true in the same PATCH. */}
          {vendors.length > 0 && !vendors.some(v => v.isActive) && (
            <Card variant="outlined" className="p-6 text-center border-orange-300 bg-orange-50/40">
              <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-orange-100 mb-3">
                <Store size={24} className="text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Tu puesto aún no está visible
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Completa tu perfil (nombre, categoría, foto y zona) para aparecer
                en el mapa y empezar a recibir clientes.
              </p>
              <Link href="/onboarding">
                <Button className="w-full" size="lg">
                  Completar mi puesto
                </Button>
              </Link>
            </Card>
          )}
          {vendorId && vendorData && (
            <>
              {/* N16: Vendor switcher (only shows if user has multiple) */}
              {vendors.length > 0 && (
                <VendorSwitcher
                  vendors={vendors.map((v) => ({
                    id: v.id,
                    name: v.name ?? '',
                    category: v.category ?? 'otros',
                    photoUrl: v.photoUrl ?? v.photo_url ?? null,
                    isActive: v.isActive,
                    slug: v.slug,
                  }))}
                  currentVendorId={vendorId}
                  onSwitch={(id) => fetchDashboardData(id)}
                />
              )}

              {/* N9: Live viewers */}
              <div className="flex items-center justify-between">
                <LiveViewers vendorId={vendorId} />
              </div>

              {/* Completar perfil banner — outline (no gradient fullbleed).
                  El estilo anterior (bg-gradient-to-r from-orange-500 to-orange-600)
                  peleaba visualmente con el botón "Guardar horario" del
                  BusinessHours (también naranja) y violaba color-contrast con
                  texto blanco sobre orange-500. Pasamos a outline que pide
                  atención sin gritarle al "Guardar horario". */}
              // Audit 2026-08-14: photoUrl (not photo_url). The /api/vendors/me
              // response uses camelCase; the snake_case field was never
              // populated so this banner always showed even after a photo
              // was uploaded.
              {(!vendorData.name || !vendorData.category || !vendorData.photoUrl) && (
                <Link href="/profile/edit">
                  <Card
                    variant="outlined"
                    className="p-4 bg-orange-50/60 border-orange-300 cursor-pointer hover:bg-orange-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                        <Camera size={20} className="text-orange-700" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-orange-900">Completar perfil</p>
                        <p className="text-sm text-orange-800/80">Añade información para que los clientes te encuentren</p>
                      </div>
                      <ChevronRight size={20} className="text-orange-400" />
                    </div>
                  </Card>
                </Link>
              )}

              {/* Toggle activo/inactivo + estación (móvil / fija)
                  Consolidado en VendorVisibility (Sprint 2 fix). El antiguo
                  ActiveToggle escribía el mismo `is_active` por una vía
                  paralela (PUT /api/vendors/{id}/location) y generaba una
                  race condition contra el toggle de Visibilidad. Ahora
                  ambos controles viven en VendorVisibility con un solo
                  endpoint (PATCH /api/vendors/me/settings) y polling GPS
                  cada 10s cuando isActive=true. */}

              {/* Geo-mode badge — shows the seller which GPS cadence is active
                  right now. Lives here (not inside VendorVisibility) because
                  the badge is informational and the seller should be able to
                  see it even if they collapse/hide the visibility card.
                  Geo mode is configured in /profile/edit. */}
              {vendorData?.geoMode === 'battery' ? (
                <Link href="/profile/edit" className="block" aria-label="Cambiar modo de ubicación en el perfil">
                  <Badge variant="outline" className="w-full justify-center gap-1.5 py-2 cursor-pointer hover:bg-green-50 border-green-300 text-green-800">
                    <BatteryLow size={14} aria-hidden="true" />
                    Modo batería · radio {vendorData.geoZoneRadiusM ?? 500} m
                  </Badge>
                </Link>
              ) : (
                <Link href="/profile/edit" className="block" aria-label="Cambiar modo de ubicación en el perfil">
                  <Badge variant="outline" className="w-full justify-center gap-1.5 py-2 cursor-pointer hover:bg-gray-50 border-gray-300 text-gray-700">
                    <Zap size={14} aria-hidden="true" />
                    Modo preciso · GPS cada 10 s
                  </Badge>
                </Link>
              )}

              <VendorVisibility
                vendorId={vendorId}
                initialIsActive={vendorData?.isActive ?? true}
                initialStationType={vendorData?.stationType ?? 'mobile'}
                geoMode={vendorData?.geoMode ?? 'precise'}
                geoZoneLat={vendorData?.geoZoneLat ?? null}
                geoZoneLng={vendorData?.geoZoneLng ?? null}
                geoZoneRadiusM={vendorData?.geoZoneRadiusM ?? 500}
              />

              {/* N11: Business hours */}
              <BusinessHours vendorId={vendorId} />

              {/* Tu ubicación en el mapa: GPS automático + ajuste manual */}
              <Card variant="outlined" className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${vendorData?.latitude ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    {/* h2 to maintain heading-order under the page's <h1>.
                        The visual size stays text-sm to match the other cards. */}
                    <h2 className="font-semibold text-gray-800 text-sm">Tu ubicación en el mapa</h2>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {vendorData?.latitude != null && vendorData?.longitude != null
                        ? `Activa — lat ${vendorData.latitude.toFixed(4)}, lng ${vendorData.longitude.toFixed(4)}`
                        : 'No has compartido tu ubicación todavía'}
                    </p>
                  </div>
                </div>
                <ManualLocationPicker
                  initialLat={vendorData?.latitude ?? null}
                  initialLng={vendorData?.longitude ?? null}
                  initialCityId={vendorData?.cityId ?? null}
                  onSaved={(lat, lng) => {
                    setVendorData((v) => v ? { ...v, latitude: lat, longitude: lng } : v)
                    setLocationSuccess(true)
                    setLocationError('')
                    notify({ title: 'Ubicación actualizada ✓', kind: 'success' })
                  }}
                />
              </Card>

              {/* N6: Copy public vendor link */}
              <CopyPublicLink vendorSlug={vendorData.slug ?? vendorId} />

              {/* Dashboard stats — keyed by vendorId so switching vendors
                  remounts the child with the new props (no need to manually
                  re-call loadAll; React does it). Avoids the round-trip of
                  "parent fetches new data, then re-fetches inside the child". */}
              <SellerDashboard
                key={vendorId}
                vendorId={vendorId}
                products={products.slice(0, 3)}
                productCount={products.length}
                initialVendorName={vendorData?.name}
                initialVendorDescription={vendorData?.description}
                initialVendorPhotoUrl={vendorData?.photo_url}
                onOrderAction={async (action: string, orderId?: string) => {
                  if (action === 'refresh') {
                    fetchDashboardData()
                    notify({ title: 'Actualizando pedidos...', kind: 'info' })
                    return
                  }
                  if (action === 'mark_delivered' && orderId) {
                    // PATCH /api/orders/[id] with { status: 'completed' }.
                    // Re-use the same status whitelist the route enforces.
                    try {
                      const res = await fetch(`/api/orders/${orderId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ status: 'completed' }),
                      })
                      if (res.ok) {
                        notify({ title: 'Pedido marcado como entregado', kind: 'success' })
                        await fetchDashboardData()
                      } else {
                        const data = await res.json().catch(() => ({}))
                        notify({ title: data.error || 'No se pudo actualizar el pedido', kind: 'error' })
                      }
                    } catch {
                      notify({ title: 'Error de conexión', kind: 'error' })
                    }
                  }
                }}
              />

              {/* Editar perfil */}
              <Link href="/profile/edit">
                <Card variant="outlined" className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <Edit3 size={24} className="text-gray-600" />
                    <span className="font-semibold">Editar perfil</span>
                  </div>
                  <ChevronRight size={20} className="text-gray-400" />
                </Card>
              </Link>

              {/* Sprint 8 D.2: replaced the plain "Editar productos · N" tile with
                  a richer metric tile that surfaces published/hidden counts.
                  Seller now sees at a glance how many products are visible
                  to buyers vs paused. */}
              <ProductsMetricTile
                totalCount={products.length}
                hiddenCount={products.filter((p) => p.is_active === false).length}
                // Migration 102 Phase C: flip the tile copy to "Mis
                // servicios" + Sparkles icon for service sellers so the
                // tile doesn't say "productos" to a hair-salon or
                // dance-class seller.
                isServiceCategory={isServiceCategory(vendorData.category as VendorCategory)}
              />

              {/* N13: WhatsApp catalog */}
              <WhatsAppCatalog vendorId={vendorId} />

              {/* N14: Location history heatmap */}
              <LocationHistory vendorId={vendorId} />
            </>
          )}
        </div>

        {/* N2: Floating Action Button */}
        {vendorId && (
          <FloatingActionButton
            vendorId={vendorId}
            onShareLocation={handleShareLocation}
            sharingLocation={sharingLocation}
          />
        )}

        {/* Toast UI is rendered globally by app/layout.tsx (ToastContainer).
            Submitting a toast via the `notify()` import above pushes the item
            onto the global queue — no per-page UI needed here. */}

        {/* Bottom Nav */}
        {/* B10 fix: aria-current on active link. */}
        {/* Specific label so this doesn't collide with SiteHeader's
            "Navegación principal del sitio" — axe flags two landmarks with
            the same accessible name as redundant (landmark-unique rule). */}
        <nav className="bg-white border-t flex justify-around py-3 fixed bottom-0 left-0 right-0 z-10" aria-label="Navegación del panel">
          <Link href="/dashboard" aria-current="page" className="flex flex-col items-center text-primary-700">
            <BarChart3 size={24} />
            <span className="text-xs mt-1">Panel</span>
          </Link>
          <Link href="/products" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
            <Package size={24} />
            <span className="text-xs mt-1">Productos</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
            <Settings size={24} />
            <span className="text-xs mt-1">Ajustes</span>
          </Link>
        </nav>
      </div>
    </PullToRefresh>
  )

}
