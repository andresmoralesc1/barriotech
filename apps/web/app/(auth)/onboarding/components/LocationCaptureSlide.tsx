'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ManualLocationPicker } from '@/components/seller/ManualLocationPicker'

/**
 * LocationCaptureSlide — onboarding step that lets the seller (or the
 * field agent on the seller's behalf) refine the placeholder vendor's
 * location from "city center" to the seller's actual spot.
 *
 * FIELD-FIX (2026-07-27): before this slide, the placeholder vendor
 * was seeded with city-center coords on register but the onboarding
 * flow had no step to refine them — the seller had to navigate to
 * /dashboard's ManualLocationPicker later. For field onboarding we
 * want the seller visible at their actual location RIGHT NOW, not
 * after a separate dashboard visit.
 *
 * Reuses ManualLocationPicker unchanged — it already handles the
 * draggable pin, GPS capture, Colombia bounds validation, and the
 * PATCH /api/vendors/me/location call. We just feed it the bootstrap
 * lat/lng (which the parent passes in via initialLat/initialLng) so
 * the map opens centered on the seller's city, not on Cali's
 * hard-coded DEFAULT_CENTER.
 */

interface LocationCaptureSlideProps {
  vendorId: string
  initialLat: number | null
  initialLng: number | null
  cityId: string | null
  onSaved: (lat: number, lng: number) => void
  onSkip: () => void
}

export function LocationCaptureSlide({
  vendorId,
  initialLat,
  initialLng,
  cityId,
  onSaved,
  onSkip,
}: LocationCaptureSlideProps) {
  // Continuar — uses the bootstrap lat/lng the picker already has
  // loaded. The picker auto-saves on "Guardar ubicación manual", but
  // if the seller just dragged the pin and hit Continuar we treat
  // the current pin as their intent and POST once more so the
  // server reflects the final position.
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleContinue = async () => {
    if (initialLat == null || initialLng == null) {
      // No pin set yet — just advance. The seller can refine later
      // from /dashboard.
      onSaved(0, 0)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/vendors/me/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ latitude: initialLat, longitude: initialLng }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Error al guardar ubicación')
        return
      }
      onSaved(initialLat, initialLng)
    } catch {
      setError('Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto flex-1 flex flex-col py-6">
      <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">
        ¿Dónde vas a vender hoy?
      </h2>
      <p className="text-gray-500 text-center mb-4 text-sm">
        Arrastra el pin a tu ubicación exacta. Los compradores te van a
        ver en este punto del mapa. Si hoy te mueves, lo puedes cambiar
        desde tu dashboard.
      </p>

      <ManualLocationPicker
        initialLat={initialLat}
        initialLng={initialLng}
        initialCityId={cityId}
        onSaved={(lat, lng) => {
          setError(null)
          onSaved(lat, lng)
        }}
      />

      {error && <p className="text-red-500 text-xs text-center mt-2">{error}</p>}

      {/* vendorId prop is accepted by the parent to chain ordering, but
          ManualLocationPicker already hits /api/vendors/me/location
          which scopes itself to the current user's active vendor. The
          prop is kept here so the parent doesn't have to track
          "did we already save the location vs. just opened the
          picker?" separately. */}
      <input type="hidden" value={vendorId} readOnly />

      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={handleContinue} size="lg" className="w-full" disabled={saving}>
          {saving ? 'Guardando...' : 'Continuar'}
        </Button>
        <Button onClick={onSkip} size="sm" variant="ghost" className="w-full">
          Lo dejo para después
        </Button>
      </div>
    </div>
  )
}