import type { VendorCategory } from '../types'

export interface CategoryInfo {
  id: VendorCategory
  label: string
  color: string
  emoji: string
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'frutas', label: 'Frutas', color: '#10B981', emoji: '🥑' },
  { id: 'comida', label: 'Comida caliente', color: '#F59E0B', emoji: '🍳' },
  { id: 'bebidas', label: 'Bebidas', color: '#3B82F6', emoji: '🧃' },
  { id: 'artesanias', label: 'Artesanías', color: '#8B5CF6', emoji: '🎨' },
  { id: 'ropa', label: 'Ropa', color: '#EC4899', emoji: '👕' },
  { id: 'otros', label: 'Otros', color: '#6B7280', emoji: '📦' },
  // service categories — migration 102
  { id: 'clases', label: 'Clases', color: '#0EA5E9', emoji: '🎓' },
  { id: 'bienestar', label: 'Bienestar', color: '#14B8A6', emoji: '💆' },
  { id: 'belleza', label: 'Belleza', color: '#EC4899', emoji: '💇' },
  { id: 'hogar', label: 'Hogar', color: '#F97316', emoji: '🛠️' },
  { id: 'eventos', label: 'Eventos', color: '#A855F7', emoji: '🎉' },
]

export const getCategoryInfo = (id: VendorCategory): CategoryInfo => {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[5]
}