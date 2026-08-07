'use client'

import { Apple, UtensilsCrossed, CupSoda, Palette, Shirt, Package, GraduationCap, Sparkles, Scissors, Wrench, PartyPopper } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { CATEGORIES } from '@/lib/core/constants'
import type { VendorCategory } from '@/lib/core/types'

// Local icon map — only this component renders category icons. Kept here
// (not in a shared module) because no other seller UI shows category icons.
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

interface Props {
  name: string
  description: string
  category: VendorCategory
  phone: string
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onCategoryChange: (v: VendorCategory) => void
  onPhoneChange: (v: string) => void
}

/**
 * "Datos del negocio" card: name + phone + category picker + description.
 *
 * Note: this is the seller's public-facing identity (shows on the buyer
 * map and profile pages). Validation belongs server-side; we don't gate
 * inputs client-side.
 */
export function BusinessDataSection({
  name,
  description,
  category,
  phone,
  onNameChange,
  onDescriptionChange,
  onCategoryChange,
  onPhoneChange,
}: Props) {
  return (
    <Card variant="outlined" className="p-4 space-y-4">
      <Input
        label="Nombre del negocio"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Ej.: Empanadas Don Juan"
      />

      <Input
        label="WhatsApp (teléfono)"
        type="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        placeholder="Ej: 300 123 4567 (+57 opcional)"
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Categoría</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const IconComponent = CategoryIconMap[cat.id as VendorCategory]
            return (
              <Badge
                key={cat.id}
                variant={category === cat.id ? 'primary' : 'outline'}
                className="cursor-pointer flex items-center gap-1"
                onClick={() => onCategoryChange(cat.id as VendorCategory)}
              >
                {IconComponent && <IconComponent size={14} />}
                {cat.label}
              </Badge>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Descripción</label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe tu negocio..."
          className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
          rows={3}
        />
      </div>
    </Card>
  )
}