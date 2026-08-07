export type UserRole = 'buyer' | 'seller' | 'admin'

export type VendorCategory =
  | 'frutas'
  | 'comida'
  | 'bebidas'
  | 'artesanias'
  | 'ropa'
  | 'otros'
  // service categories — migration 102
  | 'clases'
  | 'bienestar'
  | 'belleza'
  | 'hogar'
  | 'eventos'

export type ServiceCategory =
  | 'clases'
  | 'bienestar'
  | 'belleza'
  | 'hogar'
  | 'eventos'

export const SERVICE_CATEGORIES: VendorCategory[] = [
  'clases',
  'bienestar',
  'belleza',
  'hogar',
  'eventos',
]

export const isServiceCategory = (c: VendorCategory): boolean =>
  (SERVICE_CATEGORIES as string[]).includes(c)

export type ServiceModality = 'on_site' | 'travels' | 'remote'
export type ServicePricingUnit = 'unit' | 'hour' | 'session' | 'class'

export interface Vendor {
  id: string
  userId: string
  name: string
  category: VendorCategory
  description: string
  photoUrl: string
  isActive: boolean
  isVerified: boolean
  ratingAvg: number
  reviewCount?: number
  createdAt: string
}

export interface VendorLocation {
  id: string
  vendorId: string
  lat: number
  lng: number
  updatedAt: string
}

export interface Product {
  id: string
  vendorId: string
  name: string
  description: string
  photoUrl: string
  price: number
  // migration 102: services. kind='product' for existing rows.
  kind?: 'product' | 'service'
  // service-only; null for product rows.
  durationMinutes?: number | null
  modality?: ServiceModality | null
  pricingUnit?: ServicePricingUnit | null
}

export interface Review {
  id: string
  vendorId: string
  customerId: string
  rating: number
  comment: string
  createdAt: string
}

export interface Favorite {
  id: string
  customerId: string
  vendorId: string
  createdAt: string
}

export interface NotificationPrefs {
  id: string
  customerId: string
  categories: VendorCategory[]
  maxDistanceMeters: number
  enabled: boolean
}

export interface VendorWithLocation extends Vendor {
  location: VendorLocation
  distance?: number
}