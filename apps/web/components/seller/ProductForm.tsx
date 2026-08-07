'use client'

import { X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { hasErrors } from '@/lib/products/validation'
import type { ProductValidationErrors } from '@/hooks/useProductsPage'
import type {
  ServiceModality,
  ServicePricingUnit,
} from '@/lib/core/types'

interface Props {
  editingId: string | null
  formName: string
  formDescription: string
  formPrice: string
  formPhotoUrl: string
  formSaving: boolean
  formError: string
  formSuccess: string
  fieldErrors: ProductValidationErrors
  touched: Record<string, boolean>
  // Migration 102: service offering fields. Rendered only when the
  // seller's vendor category is a service category (clases, bienestar,
  // belleza, hogar, eventos). When false, the form is the original
  // product form and these props are ignored.
  isServiceCategory: boolean
  formDurationMinutes: string
  formModality: ServiceModality | ''
  formPricingUnit: ServicePricingUnit | ''
  onChangeName: (v: string) => void
  onChangeDescription: (v: string) => void
  onChangePrice: (v: string) => void
  onChangePhotoUrl: (v: string) => void
  onChangeDurationMinutes: (v: string) => void
  onChangeModality: (v: ServiceModality | '') => void
  onChangePricingUnit: (v: ServicePricingUnit | '') => void
  onBlur: (field: keyof ProductValidationErrors) => void
  onClose: () => void
  onSubmit: () => void
}

// Spanish labels for service-only UI. Keeping them inline so this file
// is the single place that renders them.
const MODALITY_LABELS: Record<ServiceModality, string> = {
  on_site: 'En mi local',
  travels: 'Voy a domicilio',
  remote: 'En línea',
}
const PRICING_UNIT_LABELS: Record<ServicePricingUnit, string> = {
  unit: 'Por unidad',
  hour: 'Por hora',
  session: 'Por sesión',
  class: 'Por clase',
}

/**
 * Add/edit form for a single offering. Re-validates on every keystroke
 * AFTER the first blur (so the user isn't yelled at while still typing).
 * aria-invalid + role="alert" on the error message keep the form usable
 * with a screen reader.
 *
 * Migration 102: when the seller's vendor category is a service
 * category, three extra fields (duración / modalidad / unidad) appear
 * below the price and the title flips to "Agregar servicio" /
 * "Editar servicio".
 */
export function ProductForm({
  editingId,
  formName,
  formDescription,
  formPrice,
  formPhotoUrl,
  formSaving,
  formError,
  formSuccess,
  fieldErrors,
  touched,
  isServiceCategory,
  formDurationMinutes,
  formModality,
  formPricingUnit,
  onChangeName,
  onChangeDescription,
  onChangePrice,
  onChangePhotoUrl,
  onChangeDurationMinutes,
  onChangeModality,
  onChangePricingUnit,
  onBlur,
  onClose,
  onSubmit,
}: Props) {
  const titleNoun = isServiceCategory ? 'servicio' : 'producto'
  return (
    <Card variant="outlined" className="p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">
          {editingId ? `Editar ${titleNoun}` : `Agregar ${titleNoun}`}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar formulario">
          <X size={18} />
        </Button>
      </div>
      <div className="space-y-3">
        <div>
          <Input
            label="Nombre"
            value={formName}
            onChange={(e) => onChangeName(e.target.value)}
            onBlur={() => onBlur('name')}
            placeholder={isServiceCategory ? 'Ej: Clase de salsa (1 hora)' : 'Ej: Empanada de pollo'}
            aria-invalid={Boolean(touched.name && fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
          />
          {touched.name && fieldErrors.name && (
            <p id="name-error" role="alert" className="text-xs text-red-700 mt-1">
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div>
          <Input
            label="Descripción"
            value={formDescription}
            onChange={(e) => onChangeDescription(e.target.value)}
            onBlur={() => onBlur('description')}
            placeholder={isServiceCategory ? 'Ej: Nivel principiante, pareja o individual' : 'Ej: Rellena con pollo y papa'}
            aria-invalid={Boolean(touched.description && fieldErrors.description)}
          />
          {touched.description && fieldErrors.description && (
            <p role="alert" className="text-xs text-red-700 mt-1">
              {fieldErrors.description}
            </p>
          )}
        </div>
        <div>
          <Input
            label={isServiceCategory ? 'Precio (COP)' : 'Precio (COP)'}
            type="number"
            value={formPrice}
            onChange={(e) => onChangePrice(e.target.value)}
            onBlur={() => onBlur('price')}
            placeholder={isServiceUnit(formPricingUnit) ? '25000' : '2500'}
            aria-invalid={Boolean(touched.price && fieldErrors.price)}
          />
          {touched.price && fieldErrors.price && (
            <p role="alert" className="text-xs text-red-700 mt-1">
              {fieldErrors.price}
            </p>
          )}
        </div>
        {isServiceCategory && (
          <>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Duración (minutos)
              </label>
              <Input
                type="number"
                value={formDurationMinutes}
                onChange={(e) => onChangeDurationMinutes(e.target.value)}
                placeholder="60"
                min={5}
                max={600}
              />
              <p className="text-xs text-gray-500 mt-1">Entre 5 y 600 minutos</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Modalidad</label>
              <select
                value={formModality}
                onChange={(e) => onChangeModality(e.target.value as ServiceModality | '')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              >
                <option value="">Selecciona...</option>
                {(Object.keys(MODALITY_LABELS) as ServiceModality[]).map((m) => (
                  <option key={m} value={m}>
                    {MODALITY_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Unidad de precio</label>
              <select
                value={formPricingUnit}
                onChange={(e) => onChangePricingUnit(e.target.value as ServicePricingUnit | '')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              >
                <option value="">Selecciona...</option>
                {(Object.keys(PRICING_UNIT_LABELS) as ServicePricingUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {PRICING_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Foto (opcional)</label>
          <ImageUpload
            value={formPhotoUrl}
            onChange={onChangePhotoUrl}
            folder="products"
          />
          {touched.photoUrl && fieldErrors.photoUrl && (
            <p role="alert" className="text-xs text-red-700 mt-1">
              {fieldErrors.photoUrl}
            </p>
          )}
        </div>
        {formError && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3"
          >
            {formError}
          </div>
        )}
        {formSuccess && (
          <div
            role="status"
            className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3"
          >
            {formSuccess}
          </div>
        )}
        <Button
          onClick={onSubmit}
          disabled={formSaving || hasErrors(fieldErrors)}
          className="w-full"
        >
          {formSaving
            ? 'Guardando...'
            : editingId
              ? 'Guardar cambios'
              : isServiceCategory
                ? `Agregar servicio`
                : `Agregar producto`}
        </Button>
      </div>
    </Card>
  )
}

// Tiny helper so the placeholder picks a believable number per unit.
function isServiceUnit(u: ServicePricingUnit | ''): boolean {
  return u === 'hour' || u === 'session' || u === 'class'
}
