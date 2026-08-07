import type { VendorCategory } from '../types'

export interface CategoryInfo {
  id: VendorCategory
  label: string
  icon: string
  color: string
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'frutas', label: 'Frutas', icon: '🍎', color: '#10B981' },
  { id: 'comida', label: 'Comida caliente', icon: '🍔', color: '#F59E0B' },
  { id: 'bebidas', label: 'Bebidas', icon: '🥤', color: '#3B82F6' },
  { id: 'artesanias', label: 'Artesanías', icon: '🎨', color: '#8B5CF6' },
  { id: 'ropa', label: 'Ropa', icon: '👕', color: '#EC4899' },
  { id: 'otros', label: 'Otros', icon: '📦', color: '#6B7280' },
  // service categories — migration 102
  { id: 'clases', label: 'Clases', icon: '🎓', color: '#0EA5E9' },
  { id: 'bienestar', label: 'Bienestar', icon: '💆', color: '#14B8A6' },
  { id: 'belleza', label: 'Belleza', icon: '💇', color: '#EC4899' },
  { id: 'hogar', label: 'Hogar', icon: '🛠️', color: '#F97316' },
  { id: 'eventos', label: 'Eventos', icon: '🎉', color: '#A855F7' },
]

export const getCategoryInfo = (id: VendorCategory): CategoryInfo => {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[5]
}