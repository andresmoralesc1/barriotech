import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vendor, VendorCategory, UserRole, Product } from '../lib/core/types'
import { DEFAULT_CITY } from '../lib/core/constants'
import type { City } from '../lib/core/constants'

export interface User {
  id: string
  email: string
  role: UserRole | null
  fullName: string
  avatarUrl: string
  phone?: string
  cityId?: string
  emailVerified?: boolean
  // Task 5 (2026-08-12): service-role signup decision. true = user opted
  // into map visibility at signup, so /onboarding should trigger the
  // seller-style slider. Persisted on profiles.wants_map; echoed in
  // /api/auth/register and /api/auth/me responses.
  wantsMap?: boolean
}

interface Filters {
  category: VendorCategory | null
  // Phase F3: "Servicios" group chip. When set to the 5 service
  // category ids, vendors matching ANY of them are shown (an IN
  // clause). Mutually exclusive with `category` from the API's
  // perspective — when `categoryOr` is non-empty the individual
  // category chips in the FilterBar become inactive.
  categoryOr: string[] | null
  // null = sin límite (mostrar todos). Número = filtrar hasta esa distancia en metros.
  maxDistanceMeters: number | null
  searchQuery: string
  // Migration 102 (services) Phase A2: filter to vendors whose offerings
  // include the chosen modality. Today only 'travels' is exposed in the
  // UI ("Ofrece a domicilio" chip) — 'on_site' / 'remote' are reserved
  // for future surface area. `null` = no modality filter.
  modality: 'on_site' | 'travels' | 'remote' | null
}

export interface CartItem {
  product: Product
  quantity: number
}

export interface Order {
  id: string
  buyerId: string
  vendorId: string
  status: 'pending' | 'accepted' | 'ready' | 'completed' | 'cancelled'
  total: number
  createdAt: string
  items?: CartItem[]
  vendorName?: string
}

interface AppState {
  // Hydration flag — wait for this before showing auth-dependent content
  _hasHydrated: boolean
  setHasHydrated: (v: boolean) => void

  // Usuario
  user: User | null
  setUser: (user: User | null) => void

  // Vendedores (mock data)
  vendors: Vendor[]
  setVendors: (vendors: Vendor[]) => void

  // Filtros del mapa
  filters: Filters
  setFilters: (filters: Partial<Filters>) => void

  // Favoritos
  favoriteIds: string[]
  addFavorite: (vendorId: string) => void
  removeFavorite: (vendorId: string) => void

  // Ubicación del usuario
  userLocation: { lat: number; lng: number } | null
  setUserLocation: (location: { lat: number; lng: number } | null) => void

  // Ciudad seleccionada
  selectedCity: City
  setSelectedCity: (city: City) => void

  // Estado del vendedor
  isSellerActive: boolean
  setSellerActive: (active: boolean) => void

  // Notificaciones
  pushNotificationsEnabled: boolean
  setPushNotifications: (enabled: boolean) => void
  proximityNotificationsEnabled: boolean
  setProximityNotifications: (enabled: boolean) => void

  // UI
  selectedVendorId: string | null
  setSelectedVendorId: (id: string | null) => void

  // Cart
  cart: CartItem[]
  cartOpen: boolean
  setCartOpen: (open: boolean) => void
  addToCart: (product: Product) => void
  removeFromCart: (productId: string) => void
  updateCartQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  getCartTotal: () => number

  // Orders
  orders: Order[]
  setOrders: (orders: Order[]) => void

  // Vendor state (set after login)
  vendorId: string | null
  setVendorId: (id: string | null) => void
  vendorProducts: any[]
  setVendorProducts: (products: any[]) => void

  // Logout
  logout: () => Promise<void>

  // Sprint 11 B-AUTH-4 (2026-07-24): intent flag set by `logout()` so
  // subsequent 401s (e.g. AuthInitializer's /api/auth/me on the new
  // page mount) don't get misinterpreted as a session-expiry and
  // redirected to /login?expired=1. Cleared on the next successful
  // auth-state fetch or after a short timeout.
  justLoggedOut: boolean
  setJustLoggedOut: (v: boolean) => void

  // P1-5 (audit 2026-07-27): per-session dismissal of the
  // EmailVerifyBanner. Previously local React state in the banner
  // component reset on every navigation, so users who clicked the X to
  // dismiss saw the banner again two pages later — classic "did this
  // even work?" UX failure. Now we keep it in the persisted Zustand
  // store; clearing on logout / email-verify success so the user gets
  // a fresh prompt if verification regresses.
  verifyBannerDismissed: boolean
  setVerifyBannerDismissed: (v: boolean) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Hydration
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      // Sprint 11 B-AUTH-4 (2026-07-24): starts false, becomes true right
      // after `logout()` completes. `authedFetch` reads this and skips the
      // "/login?expired=1" redirect when the 401 was caused by a deliberate
      // logout, not by a session expiring. Cleared on the next auth-state
      // fetch (login, register) or on the AuthInitializer's mount on /login
      // (where 401 is the expected path).
      justLoggedOut: false,
      setJustLoggedOut: (v) => set({ justLoggedOut: v }),

      // P1-5: defaults to false. Banner dismiss resets to true; logout
      // (which already clears user + cart + orders) also clears this so
      // a future unverified user can see the banner again.
      verifyBannerDismissed: false,
      setVerifyBannerDismissed: (v) => set({ verifyBannerDismissed: v }),

      // Usuario
      user: null,
      setUser: (user) => set({ user }),

      // Vendedores
      vendors: [],
      setVendors: (vendors) => set({ vendors }),

      // Filtros
      filters: {
        category: null,
        categoryOr: null,
        maxDistanceMeters: null,
        searchQuery: '',
        modality: null,
      },
      setFilters: (filters) =>
        set((state) => ({ filters: { ...state.filters, ...filters } })),

      // Favoritos
      favoriteIds: [],
      addFavorite: (vendorId) =>
        set((state) => {
          if (state.favoriteIds.length >= 10) return state
          if (state.favoriteIds.includes(vendorId)) return state
          return { favoriteIds: [...state.favoriteIds, vendorId] }
        }),
      removeFavorite: (vendorId) =>
        set((state) => ({
          favoriteIds: state.favoriteIds.filter((id) => id !== vendorId),
        })),

      // Ubicación
      userLocation: null,
      setUserLocation: (location) => set({ userLocation: location }),

      // Ciudad
      selectedCity: DEFAULT_CITY,
      setSelectedCity: (city) => set({ selectedCity: city }),

      // Seller activo
      isSellerActive: false,
      setSellerActive: (active) => set({ isSellerActive: active }),

      // Notificaciones
      pushNotificationsEnabled: true,
      setPushNotifications: (enabled) => set({ pushNotificationsEnabled: enabled }),
      proximityNotificationsEnabled: true,
      setProximityNotifications: (enabled) => set({ proximityNotificationsEnabled: enabled }),

      // UI
      selectedVendorId: null,
      setSelectedVendorId: (id) => set({ selectedVendorId: id }),

      // Cart
      cart: [],
      cartOpen: false,
      setCartOpen: (open) => set({ cartOpen: open }),
      addToCart: (product) =>
        set((state) => {
          // Cross-vendor guard: BarrioTech orders are placed per-vendor
          // (one WhatsApp thread per vendor). If the cart already has items
          // from a different vendor, replace the cart with the new product —
          // toast/UI elsewhere should warn the user before this happens.
          const existingVendorId = state.cart[0]?.product.vendorId
          if (existingVendorId && existingVendorId !== product.vendorId) {
            return { cart: [{ product, quantity: 1 }] }
          }
          const existing = state.cart.find((item) => item.product.id === product.id)
          if (existing) {
            return {
              cart: state.cart.map((item) =>
                item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
              ),
            }
          }
          return { cart: [...state.cart, { product, quantity: 1 }] }
        }),
      removeFromCart: (productId) =>
        set((state) => ({
          cart: state.cart.filter((item) => item.product.id !== productId),
        })),
      updateCartQuantity: (productId, quantity) =>
        set((state) => ({
          cart: state.cart.map((item) =>
            item.product.id === productId ? { ...item, quantity } : item
          ),
        })),
      clearCart: () => set({ cart: [] }),
      getCartTotal: () => {
        // Calculate from current cart state via get() to avoid stale closures.
        // Cart items may have undefined price (safety) — treat as 0.
        return get().cart.reduce(
          (sum, item) => sum + (item.product.price ?? 0) * item.quantity,
          0
        )
      },

      // Orders
      orders: [],
      setOrders: (orders) => set({ orders }),

      // Vendor state
      vendorId: null,
      setVendorId: (id) => set({ vendorId: id }),
      vendorProducts: [],
      setVendorProducts: (products) => set({ vendorProducts: products }),

      // Logout
      logout: async () => {
        // Set the intent flag BEFORE the fetch so the in-flight 401
        // chain (refresh → /api/auth/me) skips the "expired" redirect.
        // Cleared on a timer in case a code path forgets.
        set({ justLoggedOut: true })
        try {
          await fetch('/api/auth/logout', { method: 'POST' })
        } catch {
          // ignore network errors — still clear client state
        }
        localStorage.removeItem('barriotech-store')
        set({
          user: null,
          vendorId: null,
          cart: [],
          orders: [],
          favoriteIds: [],
          verifyBannerDismissed: false,
        })
        // Auto-clear after 30s so a future login flow isn't accidentally
        // skipped by the flag. The user will have re-entered the
        // login/register flow by then, which clears it explicitly.
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            set({ justLoggedOut: false })
          }, 30_000)
        }
      },
    }),
    {
      name: 'barriotech-store',
      // Only persist cart, favorites, orders, city, filters — NOT user or internal flags (auth lives in cookie)
      partialize: (state) => ({
        vendorId: state.vendorId,
        cart: state.cart,
        favoriteIds: state.favoriteIds,
        orders: state.orders,
        selectedCity: state.selectedCity,
        filters: state.filters,
        pushNotificationsEnabled: state.pushNotificationsEnabled,
        proximityNotificationsEnabled: state.proximityNotificationsEnabled,
        // P1-5: persist dismissal across reloads so a user who clicked
        // X doesn't see the banner re-appear on the next page view.
        verifyBannerDismissed: state.verifyBannerDismissed,
        // _hasHydrated and user are NOT persisted — always restored from cookie at runtime
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Signal that hydration is in progress — components should wait
        state.setHasHydrated(false)

        // After rehydrating from localStorage, check if user is logged in via cookie
        // This handles page refreshes and direct navigation after login.
        // Optimization: short-circuit if there is no auth cookie. Without
        // this, every anonymous session fires a 401 against /api/auth/me
        // on every page load — noisy console + wasted round-trip. We check
        // for the cookie first; if absent, the user is definitely
        // logged out and the API call is guaranteed to 401.
        if (typeof document === 'undefined' || !document.cookie.includes('gps_session')) {
          state.setHasHydrated(true)
          return
        }
        fetch('/api/auth/me', { credentials: 'include' })
          .then((res) => {
            if (res.ok) return res.json()
            return null
          })
          .then((user) => {
            if (user) state.setUser(user)
          })
          .catch(() => { /* ignore — user stays null (logged out) */ })
          .finally(() => {
            state.setHasHydrated(true)
          })
      },
    }
  )
)
