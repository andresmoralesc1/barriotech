'use client'

import { useState } from 'react'
import { Camera, Check } from 'lucide-react'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { Button } from '@/components/ui/Button'

/**
 * PhotoUploadSlide — onboarding step where the seller (or field agent on
 * the seller's behalf) uploads a profile photo so the buyer map and
 * vendor cards show a real face/logo instead of a generic placeholder.
 *
 * FIELD-FIX v4 (2026-07-27): the static "📸 Tu foto de perfil" tip slide
 * was just copy — the photo had to wait for the seller to navigate to
 * /profile/edit on the dashboard, which most field-onboarded sellers
 * never did. For the field agent's workflow this slide lets the photo
 * land during onboarding, in the same session.
 *
 * Flow:
 *   1. ImageUpload POSTs /api/upload (folder="vendors"), gets back
 *      { url: "/storage/vendors/{uuid}.jpg" }.
 *   2. We PATCH /api/vendors/me with { photoUrl: url } to persist it.
 *      /api/vendors/me maps photoUrl → photo_url without enforcing
 *      the http(s) scheme — relative /storage paths work.
 *   3. "Continuar" persists + advances; "Lo dejo para después" advances
 *      without saving (the placeholder vendor still gets created at
 *      step 0 with isActive=true and city-center coords).
 */

interface PhotoUploadSlideProps {
  initialPhotoUrl?: string | null
  onSaved: (photoUrl: string) => void
  onSkip: () => void
}

export function PhotoUploadSlide({
  initialPhotoUrl = null,
  onSaved,
  onSkip,
}: PhotoUploadSlideProps) {
  const [photoUrl, setPhotoUrl] = useState<string>(initialPhotoUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleContinue = async () => {
    if (!photoUrl) {
      // Nothing to save — just advance.
      onSaved('')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/vendors/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ photoUrl }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'No pude guardar la foto')
        return
      }
      onSaved(photoUrl)
    } catch {
      setError('Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto flex-1 flex flex-col py-6">
      <div className="flex items-center justify-center mb-3">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Camera size={28} className="text-primary-700" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">
        Sube una foto de tu negocio
      </h2>
      <p className="text-gray-500 text-center mb-6 text-sm">
        Una foto clara de ti o de tu puesto ayuda a que los compradores te
        reconozcan cuando te busquen en el mapa.
      </p>

      <div className="flex justify-center mb-6">
        <ImageUpload
          value={photoUrl || undefined}
          onChange={(url) => { setPhotoUrl(url); setError(null) }}
          folder="vendors"
        />
      </div>

      {photoUrl && (
        <p className="text-green-600 text-xs text-center mb-3 flex items-center justify-center gap-1">
          <Check size={14} /> Foto lista para guardar
        </p>
      )}

      {error && <p className="text-red-500 text-xs text-center mb-3">{error}</p>}

      <div className="mt-auto flex flex-col gap-2">
        <Button onClick={handleContinue} size="lg" className="w-full" disabled={saving}>
          {saving ? 'Guardando...' : photoUrl ? 'Continuar' : 'Continuar sin foto'}
        </Button>
        <Button onClick={onSkip} size="sm" variant="ghost" className="w-full">
          Lo dejo para después
        </Button>
      </div>
    </div>
  )
}
