export type UserRole = 'buyer' | 'seller' | 'admin'

export type VendorCategory =
  | 'frutas'
  | 'comida'
  | 'bebidas'
  | 'artesanias'
  | 'ropa'
  | 'otros'

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