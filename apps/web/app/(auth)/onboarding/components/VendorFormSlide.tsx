'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { CityInput } from '@/components/ui/CityInput'
import { CATEGORIES } from '@/lib/core/constants'
import type { VendorCategory } from '@/lib/core/types'

interface VendorFormSlideProps {
  onCreated: (vendorId: string) => void
  initialName?: string
}

export function VendorFormSlide({ onCreated, initialName = '' }: VendorFormSlideProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<VendorCategory>('comida')
  const [phone, setPhone] = useState('')
  const [cityId, setCityId] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('El nombre del negocio es requerido')
      return
    }
    if (!category) {
      setError('Selecciona una categoría')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      // Sprint 11 B-AUTH-3 (2026-07-24): the register flow auto-creates a
      // placeholder vendor row ("Mi negocio de {firstName}") in the same
      // transaction. Before this fix, the onboarding form always tried to
      // POST /api/vendors which returned 409 Conflict, leaving the form
      // stuck on the "Continuar" button with no error message.
      //
      // New flow: GET /api/vendors/me first; if a vendor already exists
      // (the auto-bootstrap case), PATCH it with the form values AND
      // set isActive=true so the vendor becomes visible on the map.
      // If no vendor exists (defensive — shouldn't happen since register
      // auto-creates one), POST as before.
      const existing = await fetch('/api/vendors/me', {
        credentials: 'include',
      })
      const existingData = existing.ok ? await existing.json() : { vendors: [] }
      const existingVendor = existingData.vendors?.[0] ?? null

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        category,
        phone: phone.replace(/\D/g, ''),
        cityId: cityId || 'bogota',
        // Activate the vendor so the buyer map picks it up. Without
        // this, the vendor row stays is_active=false (the auto-bootstrap
        // default) and never shows on /map.
        isActive: true,
      }

      const res = existingVendor
        ? await fetch(`/api/vendors/${existingVendor.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          })
        : await fetch('/api/vendors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al crear el perfil')
        setSubmitting(false)
        return
      }

      // PATCH returns { vendor }; POST returns { vendor } too — both shapes
      // agree on the inner vendor key, so we can read either.
      const vendor = data.vendor
      onCreated(vendor.id)
    } catch {
      setError('Error de conexión')
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center py-8">
      <h2 className="text-2xl font-bold text-center mb-2 text-gray-800">
        Crea tu perfil de vendedor
      </h2>
      <p className="text-gray-500 text-center mb-6 text-sm">
        Esto es lo único que necesitamos para empezar
      </p>

      <div className="space-y-4">
        <Input
          label="Nombre del negocio"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Don Juan Empanadas"
        />

        <Input
          label="Teléfono"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="300 123 4567 (+57 opcional)"
        />

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Ciudad</label>
          <CityInput
            value={cityId}
            onChange={setCityId}
            placeholder="Busca tu ciudad..."
            rounded="lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Categoría</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id as VendorCategory)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  category === cat.id
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
                }`}
              >
                {cat.emoji} {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Cuéntales a tus clientes qué vendes..."
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            rows={3}
          />
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <Button
          onClick={handleSubmit}
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? 'Creando...' : 'Continuar'}
        </Button>
      </div>
    </div>
  )
}