export type UserRole = 'buyer' | 'seller' | 'admin'

export type VendorCategory =
  | 'frutas'
  | 'comida'
  | 'bebidas'
  | 'artesanias'
  | 'ropa'
  | 'otros'

export type VehicleType =
  | 'bicicleta'
  | 'moto'
  | 'carro'
  | 'triciclo'
  | 'pie'
  | 'otro'

export interface Vendor {
  id: string
  slug?: string
  userId: string
  name: string
  category: VendorCategory
  description: string
  photoUrl: string
  isActive: boolean
  isVerified?: boolean
  isSponsored?: boolean
  ratingAvg: number
  reviewCount: number
  createdAt: string
  vehicleType?: VehicleType
  vehiclePhotoUrl?: string
  // 'fixed' = sits in one spot all day, 'mobile' = moves around the city
  stationType?: 'fixed' | 'mobile'
  // Computed server-side using vendor's business_hours and current Bogota time
  isOpen?: boolean
  // Raw business_hours payload (only present on /api/vendors list response)
  businessHours?: {
    enabled: boolean
    start: string | null
    end: string | null
    days: string[]
  }
  phone?: string
  // ponytail: lat/lng from API, add to type for convenience
  latitude?: number
  longitude?: number
  location_updated_at?: string
  // GPS-005: explicit freshness flag so the map and the detail card can
  // render differentiated UI ("online recently" vs "toggle on but stale").
  locationFresh?: boolean
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