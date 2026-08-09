'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import { PullToRefresh } from '@/components/ui/PullToRefresh'
import 'leaflet/dist/leaflet.css'
import { Frown, LogIn, X } from 'lucide-react'

// Leaflet touch-target override is injected from the MapContainer via a
// runtime <style> tag (see LeafletTouchTargetOverride component below).
// Doing it at runtime instead of via globals.css because Next.js extracts
// `import 'leaflet/dist/leaflet.css'` into its own chunk which loads AFTER
// globals.css, and Tailwind's purge discards `.leaflet-*` selectors from
// the base layer. Runtime injection guarantees the override reaches the
// browser after Leaflet's CSS chunk is parsed.
import Link from 'next/link'
import { VendorCard } from './VendorCard'
import { LocationAdjustControl } from './LocationAdjustControl'
import { DraggableUserMarker } from './DraggableUserMarker'
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet'
import {
  MapUpdater,
  MapClickCloser,
  LeafletTouchTargetOverride,
  MapPanToVendor,
  MapRecenter,
  MapFitBounds,
} from './MapHelpers'
import { useStore } from '@/store/useStore'
import { calculateDistance } from '@/lib/core/utils/geo'
import { getCategoryInfo, COLOMBIA_CITIES } from '@/lib/core/constants'
import type { Vendor, VendorCategory } from '@/lib/core/types'
import type { LatLng } from 'leaflet'
import L from 'leaflet'
// MAP-005: subscribe to incremental GPS updates via the SSE endpoint that
// already emits vendor location changes every 5s. Without this the only
// path into React state was a 30s polling cycle that rebuilt the entire
// `activeVendors` array and forced every marker to call `setIcon` (visible
// flicker on slow devices). The poll remains as a fallback for when the
// SSE is disconnected — see the useEffect below.
import { useVendorStream } from '@/lib/hooks/useVendorStream'

// Fix para íconos de Leaflet en Next.js
import '@/lib/leaflet-icon-fix'

// 5 Leaflet helpers (MapUpdater, MapClickCloser, LeafletTouchTargetOverride,
// MapPanToVendor, MapRecenter) moved to ./MapHelpers on 2026-07-21 to keep
// this file under 500 lines. Imported above.

export function MapView() {
  const selectedCity = useStore((s) => s.selectedCity)
  const setSelectedCity = useStore((s) => s.setSelectedCity)
  const [center, setCenter] = useState<[number, number]>(selectedCity.center)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  // MapView is built around ~10 pieces of state (selectedCity, filters, etc.).
  // The hooks below are grouped together to keep the data-flow of the page
  // legible at a glance.
  const [activeVendors, setActiveVendors] = useState<Vendor[]>([])
  // MAP-001: cache of `L.DivIcon` instances keyed by visual props. Persists
  // across re-renders so the same `<Marker>` keeps receiving the same icon
  // reference and react-leaflet skips `setIcon()` (which was destroying the
  // marker DOM every 30s poll and causing the visible flicker).
  const iconCacheRef = useRef<Map<string, L.DivIcon>>(new Map())
  const [cardHeightPx, setCardHeightPx] = useState(0)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const filters = useStore((s) => s.filters)
  const userLocation = useStore((s) => s.userLocation)
  const user = useStore((s) => s.user)
  const _hasHydrated = useStore((s) => s._hasHydrated)
  const isLoggedIn = _hasHydrated && !!user
  const [guestBannerDismissed, setGuestBannerDismissed] = useState(false)
  // True only when the user grants the browser's geolocation prompt. When
  // permission is denied / unavailable we fall back to the city center so the
  // map always has something to display — but in that case MapFitBounds can
  // still kick in to auto-frame vendors that are far from the city center.
  const [hasRealGeolocation, setHasRealGeolocation] = useState(false)

  // ─── Location-adjust mode ──────────────────────────────────────────
  // `isAdjusting`: when true, the user-location marker becomes draggable
  // and clicking the map moves the pin to that point. Exits when the
  // user taps "Listo" or after they drag.
  // `isRelocating`: true while waiting for navigator.geolocation to
  // resolve after the user taps "Usar GPS".
  // `recenterTick`: increments every time we want MapRecenter to pan
  // the map (dragend, gps-fix, city-change-via-Adjust). The MapRecenter
  // effect watches this counter instead of the raw location to avoid
  // fighting with the user's own pan/zoom.
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [isRelocating, setIsRelocating] = useState(false)
  const [recenterTick, setRecenterTick] = useState(0)
  const [locationManuallySet, setLocationManuallySet] = useState(false)

  // Restore the "guest banner dismissed" flag from localStorage on mount so
  // the auth prompt stays hidden across reloads, not just in-session.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('barriotech_guest_banner_dismissed') === '1') {
      setGuestBannerDismissed(true)
    }
  }, [])

  const dismissGuestBanner = () => {
    setGuestBannerDismissed(true)
    try { localStorage.setItem('barriotech_guest_banner_dismissed', '1') } catch {}
  }

  // Vendors are browsable for guests, but they cannot see details until
  // they sign in. We track this as a single flag derived from auth state.

  // Persist city selection to localStorage
  useEffect(() => {
    const saved = localStorage.getItem('selectedCityId')
    if (saved) {
      const city = COLOMBIA_CITIES.find((c) => c.id === saved)
      if (city) setSelectedCity(city)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save city to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedCityId', selectedCity.id)
    // When city changes, clear user location so map centers on city center
    useStore.getState().setUserLocation(null)
  }, [selectedCity])

  const fetchActiveVendors = useCallback(async () => {
    try {
      // Without real GPS we can't tell which city the user is actually in, so
      // fetch ALL vendors with a known location and let the map + fitBounds
      // figure out what to show. Filtering by selectedCity here would leave
      // the map empty whenever the default city differs from where sellers
      // actually are. The user can still narrow via the city picker.
      const params = new URLSearchParams({ withLocation: 'true' })
      if (hasRealGeolocation && selectedCity) {
        params.set('cityId', selectedCity.id)
      }
      // Migration 102 Phase A2: "Ofrece a domicilio" filter. Server-side
      // via the /api/vendors filters builder (EXISTS subquery on products
      // with the chosen modality). Only attached when the filter is on
      // so the default request shape stays unchanged.
      if (filters.modality) {
        params.set('modality', filters.modality)
      }
      const res = await fetch(`/api/vendors?${params.toString()}`)
      const data = await res.json()
      if (data.vendors) {
        // MAP-005: merge instead of replace. The 30s poll is now a fallback
        // for when SSE is offline. Merge keeps the existing entries and
        // only adds/updates what changed — markers that haven't moved
        // don't get re-evaluated. Also dedupes by id so a vendor appearing
        // twice (SSE + polling race) keeps one entry.
        setActiveVendors((prev) => {
          const byId = new Map<string, Vendor>()
          for (const v of prev) byId.set(v.id, v)
          for (const v of data.vendors as Vendor[]) byId.set(v.id, v)
          return Array.from(byId.values())
        })
      }
    } catch (err) {
      console.error('Failed to fetch vendors:', err)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity.id, hasRealGeolocation, filters.modality])

  // MAP-005: when SSE delivers a per-vendor update, patch the existing entry
  // in place — do NOT rebuild the array. This is the key fix for the
  // marker flicker: only one marker's `position` prop changes per update
  // instead of every icon reference in 50+ markers.
  useVendorStream(selectedCity?.id ?? null, (u) => {
    setActiveVendors((prev) => {
      const idx = prev.findIndex((v) => v.id === u.vendorId)
      if (idx === -1) return prev
      const next = prev.slice()
      next[idx] = {
        ...next[idx],
        latitude: u.latitude,
        longitude: u.longitude,
        isActive: u.isActive,
        location_updated_at: u.locationUpdatedAt,
        locationFresh: true,
      }
      return next
    })
  })
  useEffect(() => {
    if (!userLocation) {
      // Try to get real location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setHasRealGeolocation(true)
            useStore.getState().setUserLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            })
          },
          () => {
            useStore.getState().setUserLocation({ lat: selectedCity.center[0], lng: selectedCity.center[1] })
          }
        )
      } else {
        useStore.getState().setUserLocation({ lat: selectedCity.center[0], lng: selectedCity.center[1] })
      }
    }
  }, [selectedCity])

  useEffect(() => {
    fetchActiveVendors()
    const interval = setInterval(fetchActiveVendors, 30000)
    return () => clearInterval(interval)
  }, [fetchActiveVendors])

  // Initial center: userLocation if available, else city center.
  // We don't auto-recenter on userLocation changes anymore — the user
  // can pan/zoom freely, and we only pan explicitly via MapRecenter
  // (triggered by dragend, GPS re-locate, or city change while in
  // adjust mode). This keeps manual panning from fighting the marker.
  useEffect(() => {
    if (!userLocation) return
    // Only run once on initial mount or when userLocation was previously null.
    setCenter([userLocation.lat, userLocation.lng])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // City change always resets the center (user explicitly chose a new city).
  useEffect(() => {
    setCenter(selectedCity.center)
    // Clear any manually-set location so the city center wins.
    setLocationManuallySet(false)
    setIsAdjusting(false)
  }, [selectedCity])

  // Measure the floating card so MapPanToVendor can offset the marker.
  useEffect(() => {
    if (!selectedVendor || !cardRef.current) return
    const el = cardRef.current
    const update = () => setCardHeightPx(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [selectedVendor])

  // Esc closes the selected vendor card.
  useEffect(() => {
    if (!selectedVendor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedVendor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedVendor])

  // MAP-006: memoize filteredVendors. The filter runs on every render (which
  // happens every 30s on the polling cycle). Without useMemo each filter
  // builds a fresh array → `MapFitBounds` and every <Marker> receive new
  // props → Leaflet skips its diff and triggers DOM work. With useMemo the
  // array reference is stable when inputs haven't changed.
  const filteredVendors = useMemo(() => {
    return activeVendors.filter((v) => {
      if (filters.category && v.category !== filters.category) return false
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        if (!v.name?.toLowerCase().includes(query)) return false
      }
      // null = sin límite de distancia (Todos)
      if (
        filters.maxDistanceMeters !== null &&
        userLocation &&
        v.latitude &&
        v.longitude
      ) {
        const dist = calculateDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude)
        if (dist > filters.maxDistanceMeters) return false
      }
      return true
    })
  }, [activeVendors, filters.category, filters.searchQuery, filters.maxDistanceMeters, userLocation])

  const getVendorDistance = useCallback(
    (vendor: Vendor) => {
      if (!userLocation || !vendor.latitude || !vendor.longitude) return undefined
      return calculateDistance(userLocation.lat, userLocation.lng, vendor.latitude, vendor.longitude)
    },
    [userLocation]
  )

  // ── Location-adjust handlers ──────────────────────────────────────

  // "Usar GPS" — re-trigger navigator.geolocation. If the user already
  // gave permission this is instant; if they previously denied, the
  // browser may silently fail and we fall back to the city center.
  const handleRelocate = useCallback(() => {
    if (!navigator.geolocation) {
      // No geolocation API at all — at least snap to city center.
      useStore.getState().setUserLocation({
        lat: selectedCity.center[0],
        lng: selectedCity.center[1],
      })
      setLocationManuallySet(false)
      setRecenterTick((n) => n + 1)
      return
    }
    setIsRelocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        useStore.getState().setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
        setLocationManuallySet(false)
        setRecenterTick((n) => n + 1)
        setIsRelocating(false)
      },
      () => {
        // Permission denied or fix unavailable — fall back to city center.
        useStore.getState().setUserLocation({
          lat: selectedCity.center[0],
          lng: selectedCity.center[1],
        })
        setLocationManuallySet(false)
        setRecenterTick((n) => n + 1)
        setIsRelocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [selectedCity])

  // While the user drags the pin, update the store on every move so
  // distance filters and the vendor list stay live.
  const handleLocationDrag = useCallback((lat: number, lng: number) => {
    useStore.getState().setUserLocation({ lat, lng })
  }, [])

  // When the user releases the pin (or taps the map in adjust mode),
  // recenter the map on the new location and exit adjust mode. We
  // exit so the marker becomes a passive pin again — the user has
  // committed to their chosen location.
  const handleLocationDragEnd = useCallback((lat: number, lng: number) => {
    useStore.getState().setUserLocation({ lat, lng })
    setLocationManuallySet(true)
    setRecenterTick((n) => n + 1)
    // Auto-exit adjust mode after they let go. They can re-enter if they
    // want to fine-tune.
    setIsAdjusting(false)
  }, [])


  return (
    // Sprint 4 B12: pull-to-refresh wraps the entire map. The wrapper's
    // touch handlers only fire when the user starts the gesture within
    // TOUCH_START_TOP_PX of the container's top — i.e. they're pulling
    // down from the address bar area. Otherwise the gesture is ignored
    // and Leaflet handles the touch as a map pan/zoom.
    <PullToRefresh
      onRefresh={async () => {
        await fetchActiveVendors()
        // Trigger haptic confirmation if the device supports it. Sprint 4
        // B9 keeps it consistent with the onboarding swipe haptic.
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(15) } catch { /* unsupported */ }
        }
      }}
      className="relative w-full h-full"
    >
      <LeafletTouchTargetOverride />
      <MapContainer
        center={center}
        zoom={15}
        className="w-full h-full rounded-xl"
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {userLocation && !isAdjusting && (
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={10}
            pathOptions={{
              color: '#3B82F6',
              fillColor: '#3B82F6',
              fillOpacity: 0.5,
              weight: 3,
            }}
          >
            <Popup>Tu ubicación</Popup>
          </CircleMarker>
        )}

        {userLocation && isAdjusting && (
          <DraggableUserMarker
            location={userLocation}
            onDrag={handleLocationDrag}
            onDragEnd={handleLocationDragEnd}
          />
        )}

        <MapUpdater center={{ lat: center[0], lng: center[1] } as LatLng} />
        {/* M-003: auto-fitBounds to visible vendors. Skipped only when the user
            has granted real geolocation (their location is already centered).
            When geolocation is denied/unavailable we still want vendors to be
            visible even if they're in another city — the fallback to city center
            would otherwise leave the user staring at empty tiles. */}
        {!hasRealGeolocation && (
          <MapFitBounds vendors={filteredVendors} />
        )}
        <MapClickCloser
          onMapClick={() => {
            // In adjust mode the click is consumed by DraggableUserMarker
            // to set the pin — don't close the vendor card too, the user
            // is doing two different things at once.
            if (!isAdjusting) setSelectedVendor(null)
          }}
        />
        {recenterTick > 0 && userLocation && (
          <MapRecenter
            center={{ lat: userLocation.lat, lng: userLocation.lng } as LatLng}
            trigger={recenterTick}
          />
        )}
        <MapPanToVendor vendor={selectedVendor} bottomOffsetPx={cardHeightPx + 16} />

        {filteredVendors.length === 0 ? (
          <Marker position={center}>
            <Popup>
              <div className="text-center p-3 min-w-[200px]">
                <Frown size={36} className="mx-auto text-gray-400 mb-3" />
                <p className="font-semibold text-gray-800">No hay vendedores</p>
                {filters.searchQuery ? (
                  <p className="text-sm text-gray-500 mt-1">
                    No encontramos &quot;{filters.searchQuery}&quot;
                  </p>
                ) : filters.category ? (
                  <p className="text-sm text-gray-500 mt-1">
                    No hay vendedores de esta categoría
                  </p>
                ) : filters.maxDistanceMeters !== null ? (
                  <p className="text-sm text-gray-500 mt-1">
                    No hay vendedores en este radio
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">
                    Intenta con otro filtro o cambia de zona
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ) : (
          filteredVendors.map((vendor) => {
            if (!vendor.latitude || !vendor.longitude) return null
            const cat = (vendor.category as VendorCategory) || 'otros'
            // Local emoji map for the Leaflet pin label. Mirrors the
            // emoji in `lib/core/constants/categories.ts` (the Lucide
            // icons used by FilterBar + VendorCard live elsewhere).
            // Migration 102 audit: the 5 service categories used to
            // fall through to the `otros` `📦` fallback and looked
            // identical on the map — confusing because a `clases` pin
            // and an `otros` pin shared the same glyph. Each service
            // category now gets a distinct emoji.
            const catMap: Record<string, string> = {
              frutas: '🥑', comida: '🍳', bebidas: '🧃', artesanias: '🎨', ropa: '👕', otros: '📦',
              // service categories — migration 102
              clases: '🎓', bienestar: '💆', belleza: '💇', hogar: '🛠️', eventos: '🎉',
            }
            const emoji = catMap[cat] || '📦'
            const catColor = getCategoryInfo(cat).color
            const sponsored = vendor.isSponsored
            // Show a small "Cerrado" overlay when business hours say we're closed.
            // The map intentionally shows all vendors with location; this badge
            // distinguishes open ones from ones whose auto schedule turned them
            // off right now.
            const showClosedBadge = vendor.isOpen === false
            const ringColor = sponsored ? '#F59E0B' : 'white'
            const ringWidth = sponsored ? 4 : 3
            // Pulse ring for the currently selected vendor. We render it
            // as an absolutely-positioned div BEHIND the marker (z-index
            // -1 inside the icon's wrapper) so it doesn't displace the
            // pin itself. The ring uses the same primary orange so it
            // reads as "this is the one you tapped" without competing
            // with the category color of the icon.
            const isSelected = selectedVendor?.id === vendor.id

            // MAP-001 / MAP-002 fix: react-leaflet compares `icon` by reference,
            // so building a fresh `L.DivIcon` per render makes `setIcon()` fire
            // every poll (30s default) and the marker DOM re-renders, causing
            // visible flicker. Cache the icon by a stable key derived from
            // visual properties — when those don't change, we reuse the same
            // instance and Leaflet skips `setIcon`. The cache ref persists
            // across renders, and stale entries are evicted if the selected
            // vendor changes (selected state is part of the key).
            const iconKey = `${cat}|${sponsored ? 1 : 0}|${showClosedBadge ? 1 : 0}|${isSelected ? 1 : 0}`
            let markerIcon = iconCacheRef.current.get(iconKey)
            if (!markerIcon) {
              const pulseRing = isSelected
                ? '<div class="vendor-marker-pulse" style="position:absolute;inset:-6px;border-radius:50%;background:rgba(194,65,12,0.35);animation:marker-pulse-ring 1.4s ease-in-out infinite;pointer-events:none;"></div>'
                : ''
              // Sprint 5 B-004: vendor name appears as a small caption BELOW
              // the pin. Truncated to 14 chars so dense clusters don't overflow.
              // The label is a sibling div anchored under the pin via the
              // `iconAnchor` shift below. `whitespace-nowrap text-overflow:
              // ellipsis` keeps long names inside the chip.
              const labelText = String(vendor.name || '').slice(0, 14) + (
                String(vendor.name || '').length > 14 ? '…' : ''
              )
              const isMobileIcon = typeof window !== 'undefined' && window.innerWidth < 640
              // Hide labels on mobile when the bottom sheet is open OR when
              // there are too many vendors (cluster). Threshold 12 is
              // empirical — at ~25 markers on a 390px viewport the labels
              // create a wall of text; 12 keeps the map scannable.
              const showLabel = isMobileIcon && activeVendors.length <= 12
              const labelHtml = showLabel
                ? `<div style="position:absolute;top:46px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.95);backdrop-filter:blur(4px);color:#1f2937;font-size:10px;font-weight:600;line-height:1;padding:2px 6px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.25);white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${labelText}</div>`
                : ''
              markerIcon = new L.DivIcon({
                html: `<div style="
                  background: ${catColor};
                  width: 42px;
                  height: 42px;
                  border-radius: 50% 50% 50% 0;
                  transform: rotate(-45deg);
                  border: ${ringWidth}px solid ${ringColor};
                  box-shadow: 0 2px 8px rgba(0,0,0,0.3)${sponsored ? ', 0 0 12px rgba(245, 158, 11, 0.6)' : ''};
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 20px;
                  position: relative;
                "><span style="transform: rotate(45deg);">${emoji}</span>${
                  sponsored ? '<span style="position:absolute;top:-6px;right:-6px;background:#F59E0B;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,0.3);">⭐</span>' : ''
                }${
                  showClosedBadge ? '<span style="position:absolute;bottom:-4px;left:-4px;background:#6B7280;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,0.3);color:white;font-weight:600;">⏻</span>' : ''
                }${pulseRing}</div>${labelHtml}`,
                className: 'vendor-category-marker',
                iconSize: [42, 42],
                iconAnchor: [21, 42],
                popupAnchor: [0, -44],
              })
              iconCacheRef.current.set(iconKey, markerIcon)
            }

            return (
              <Marker
                key={vendor.id}
                position={[vendor.latitude, vendor.longitude]}
                icon={markerIcon}
                eventHandlers={{
                  click: () => {
                    setSelectedVendor(vendor)
                  },
                }}
              >
                {isLoggedIn ? (
                  <Popup>
                    <VendorCard
                      vendor={vendor}
                      compact
                      distance={getVendorDistance(vendor)}
                      isSponsored={sponsored}
                      onViewDetails={() => {
                        window.location.href = `/vendor/${vendor.slug || vendor.id}`
                      }}
                    />
                  </Popup>
                ) : null}
              </Marker>
            )
          })
        )}
      </MapContainer>

      {selectedVendor && (
        <>
        {/* Desktop layout (>=640px): floating card with X to close.
            On mobile this is hidden — the MobileBottomSheet below takes
            over with a drag handle and swipe-down-to-dismiss. */}
        <div
          ref={cardRef}
          className="hidden sm:block absolute left-3 right-3 sm:left-4 sm:right-4 bottom-[88px] sm:bottom-4 z-[1000] max-w-md mx-auto animate-slide-up"
          role="dialog"
          aria-label={`Detalles de ${selectedVendor.name}`}
        >
          <VendorCard
            vendor={selectedVendor}
            distance={getVendorDistance(selectedVendor)}
            onClose={() => setSelectedVendor(null)}
            onViewDetails={
              isLoggedIn
                ? () => {
                    window.location.href = `/vendor/${selectedVendor.slug || selectedVendor.id}`
                  }
                : undefined
            }
          />
          {!isLoggedIn && (
            <div className="mt-2 bg-white rounded-xl shadow-card border border-stone-200 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-stone-900 mb-2">
                Inicia sesión para ver detalles
              </p>
              <div className="flex gap-2 justify-center">
                <Link
                  href="/login"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-600 transition-colors"
                >
                  Ingresar
                </Link>
                <Link
                  href="/register"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
                >
                  Registrarme
              </Link>
            </div>
          </div>
        )}
        </div>

        {/* Mobile layout (<640px): draggable bottom sheet with handle.
            Same VendorCard content as the desktop variant — both consume
            the same selectedVendor state so a tap on a marker is mirrored
            in both views (only one is visible at a time thanks to the
            `sm:hidden` / `hidden sm:block` class split above). */}
        <MobileBottomSheet
          open={!!selectedVendor}
          onClose={() => setSelectedVendor(null)}
          ariaLabel={`Detalles de ${selectedVendor.name}`}
        >
          <VendorCard
            vendor={selectedVendor}
            distance={getVendorDistance(selectedVendor)}
            onClose={() => setSelectedVendor(null)}
            onViewDetails={
              isLoggedIn
                ? () => {
                    window.location.href = `/vendor/${selectedVendor.slug || selectedVendor.id}`
                  }
                : undefined
            }
          />
          {!isLoggedIn && (
            <div className="mt-2 bg-white rounded-xl shadow-card border border-stone-200 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-stone-900 mb-2">
                Inicia sesión para ver detalles
              </p>
              <div className="flex gap-2 justify-center">
                <Link
                  href="/login"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-600 transition-colors"
                >
                  Ingresar
                </Link>
                <Link
                  href="/register"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
                >
                  Registrarme
                </Link>
              </div>
            </div>
          )}
        </MobileBottomSheet>
        </>
      )}

      {/* Location-adjust control — floating action buttons to manually
          drag the user-location pin or snap back to GPS. Sits in the
          bottom-right corner, above the bottom nav on mobile. */}
      {userLocation && (
        <LocationAdjustControl
          isAdjusting={isAdjusting}
          setIsAdjusting={setIsAdjusting}
          onRelocate={handleRelocate}
          isRelocating={isRelocating}
          selectedVendor={!!selectedVendor}
          cardHeightPx={cardHeightPx}
        />
      )}

      {/* Guest banner — only visible to non-logged-in users */}
      {!isLoggedIn && !guestBannerDismissed && (
        <div className="absolute top-4 left-4 right-4 sm:right-auto z-[1000] pointer-events-auto">
          <div className="bg-white rounded-2xl shadow-card border border-stone-200 px-4 py-3 max-w-md flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <LogIn size={18} className="text-primary-700" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-stone-900">Explora el mapa</p>
              <p className="text-xs text-stone-600 mt-0.5">
                Inicia sesión para ver detalles de los vendedores.
              </p>
              <div className="mt-2 flex gap-2">
                <Link
                  href="/login"
                  className="text-xs font-semibold text-primary-700 hover:text-primary-600 transition-colors"
                >
                  Ingresar
                </Link>
                <span className="text-xs text-stone-300" aria-hidden="true">·</span>
                <Link
                  href="/register"
                  className="text-xs font-semibold text-primary-700 hover:text-primary-600 transition-colors"
                >
                  Registrarme
                </Link>
              </div>
            </div>
            <button
              onClick={dismissGuestBanner}
              aria-label="Cerrar aviso"
              className="p-1 rounded-lg hover:bg-stone-100 transition-colors flex-shrink-0"
            >
              <X size={16} className="text-stone-500" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </PullToRefresh>
  )
}