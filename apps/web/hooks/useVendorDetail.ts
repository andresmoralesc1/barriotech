'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { isUuid } from '@/lib/core/utils/slug'
import { toast } from '@/components/ui/Toast'
import type { Vendor, Product, Review } from '@/lib/core/types'

/**
 * Backend returns snake_case; components consume camelCase. These are
 * the wire shapes so we can map them at the edge without leaking the
 * backend convention into the UI.
 *
 * Migration 102: added kind + 3 service-only fields. The wire shape
 * carries them; the mapping below promotes them to the `Product`
 * camelCase type so `VendorProducts` can render duration / pricing
 * unit / "A domicilio" pill without per-call shape branching.
 */
interface RawProduct {
  id: string
  vendor_id: string
  name: string
  description?: string | null
  photo_url?: string | null
  price: string | number
  kind?: 'product' | 'service' | null
  duration_minutes?: number | null
  modality?: 'on_site' | 'travels' | 'remote' | null
  pricing_unit?: 'unit' | 'hour' | 'session' | 'class' | null
}
interface RawReview {
  id: string
  vendor_id: string
  author_name: string
  rating: number
  comment: string
  created_at: string
}
interface RawPhotoResult {
  productId: string
  photos: { url: string }[]
}

/**
 * Owns all state + side effects for the vendor detail page:
 * - fetches vendor/products/reviews + per-product photos
 * - exposes favorite/cart/review mutations with optimistic updates
 * - redirect to canonical slug when arriving via a UUID URL
 *
 * Returned `vendor` is the camelCase `Vendor` type the UI uses. UI
 * components stay pure: they receive data + a few callbacks.
 */
export function useVendorDetail(vendorId: string, vendorSlug?: string) {
  const router = useRouter()

  // Data
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [productPhotos, setProductPhotos] = useState<Record<string, string[]>>({})

  // Checkout
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')

  // Review form
  const [reviewText, setReviewText] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [submittingReview, setSubmittingReview] = useState(false)
  const [reviewSuccess, setReviewSuccess] = useState(false)
  const [reviewError, setReviewError] = useState('')

  // Micro-interaction triggers (heart pop, cart bounce)
  const [heartPop, setHeartPop] = useState(false)
  const [cartBounce, setCartBounce] = useState(false)

  // Store
  const favoriteIds = useStore((s) => s.favoriteIds)
  const addFavorite = useStore((s) => s.addFavorite)
  const removeFavorite = useStore((s) => s.removeFavorite)
  const addToCart = useStore((s) => s.addToCart)
  const cart = useStore((s) => s.cart)
  const setCartOpen = useStore((s) => s.setCartOpen)
  const clearCart = useStore((s) => s.clearCart)
  const user = useStore((s) => s.user)

  const isFavorite = favoriteIds.includes(vendorId)
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  const triggerHeartPop = useCallback(() => {
    setHeartPop(true)
    window.setTimeout(() => setHeartPop(false), 400)
  }, [])
  const triggerCartBounce = useCallback(() => {
    setCartBounce(true)
    window.setTimeout(() => setCartBounce(false), 500)
  }, [])

  // Fetch vendor + products + reviews + per-product photos. Redirect to
  // canonical slug if the URL was a UUID and we now know the slug.
  useEffect(() => {
    if (
      vendorSlug &&
      isUuid(vendorId) &&
      vendorSlug !== vendorId &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/vendedor/')
    ) {
      router.replace(`/vendor/${vendorSlug}`)
      return
    }

    let cancelled = false
    fetch(`/api/vendors/${vendorId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          router.push('/map')
          return
        }
        setVendor(data.vendor)
        setProducts(
          (data.products as RawProduct[] || []).map((p) => ({
            id: p.id,
            vendorId: p.vendor_id,
            name: p.name,
            description: p.description || '',
            photoUrl: p.photo_url || '',
            price: parseFloat(p.price as string),
            // Migration 102: surface kind + service fields so
            // VendorProducts renders duration / pricing unit / "A
            // domicilio" pill. Default to product-shaped values so a
            // row that pre-dates migration 102 (or one with kind
            // undefined from a misbehaving server) doesn't crash the
            // consumer.
            kind: (p.kind ?? 'product') as 'product' | 'service',
            durationMinutes: p.duration_minutes ?? null,
            modality: (p.modality ?? null) as
              | 'on_site' | 'travels' | 'remote' | null,
            pricingUnit: (p.pricing_unit ?? null) as
              | 'unit' | 'hour' | 'session' | 'class' | null,
          }))
        )
        setReviews(
          (data.reviews as RawReview[] || []).map((r) => ({
            id: r.id,
            vendorId: r.vendor_id,
            customerId: r.author_name,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.created_at,
          }))
        )
        // N12: fetch extra photos for each product in parallel
        return Promise.all(
          (data.products as RawProduct[] || []).map((p) =>
            fetch(`/api/products/${p.id}/photos`)
              .then((r) => (r.ok ? (r.json() as Promise<{ photos: { url: string }[] }>) : { photos: [] }))
              .then((pd) => ({ productId: p.id, photos: pd.photos || [] }))
              .catch(() => ({ productId: p.id, photos: [] }))
          )
        )
      })
      .then((photoResults: RawPhotoResult[] | undefined) => {
        if (cancelled || !Array.isArray(photoResults)) return
        const map: Record<string, string[]> = {}
        photoResults.forEach((r) => {
          map[r.productId] = r.photos.map((p) => p.url)
        })
        setProductPhotos(map)
      })
      .catch(() => {
        if (!cancelled) router.push('/map')
      })
    return () => {
      cancelled = true
    }
  }, [vendorId, vendorSlug, router])

  /** Toggle favorite with optimistic update + rollback on error */
  const toggleFavorite = useCallback(async () => {
    if (!user) {
      const shouldLogin = window.confirm('Inicia sesión para guardar favoritos. ¿Ir a login?')
      if (shouldLogin) {
        router.push('/login?redirect=' + encodeURIComponent(window.location.pathname))
      }
      return
    }
    if (!vendor) return
    const wasFavorite = isFavorite
    if (isFavorite) {
      removeFavorite(vendorId)
    } else {
      addFavorite(vendorId)
    }
    triggerHeartPop()
    try {
      const res = await fetch(
        isFavorite ? `/api/favorites?vendorId=${vendorId}` : '/api/favorites',
        {
          method: isFavorite ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: isFavorite ? undefined : JSON.stringify({ vendorId }),
        }
      )
      if (!res.ok) throw new Error('Request failed')
      toast({
        kind: wasFavorite ? 'info' : 'success',
        title: wasFavorite ? 'Eliminado de favoritos' : 'Agregado a favoritos',
        description: vendor.name,
      })
    } catch {
      // Rollback
      if (wasFavorite) {
        addFavorite(vendorId)
      } else {
        removeFavorite(vendorId)
      }
      toast({ kind: 'error', title: 'No se pudo actualizar favoritos' })
    }
  }, [user, vendor, isFavorite, vendorId, router, addFavorite, removeFavorite, triggerHeartPop])

  /** Submit checkout — clears cart on success */
  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) return
    setIsCheckingOut(true)
    setCheckoutError('')
    try {
      const items = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        price: item.product.price,
      }))
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vendorId, items }),
      })
      if (res.ok) {
        clearCart()
        setCartOpen(false)
      } else {
        const data = await res.json()
        setCheckoutError(data.error || 'Error al procesar el pedido')
      }
    } catch {
      setCheckoutError('Error de conexión')
    } finally {
      setIsCheckingOut(false)
    }
  }, [cart, vendorId, clearCart, setCartOpen])

  /** Submit a review, then refresh reviews list */
  const submitReview = useCallback(async () => {
    if (!user || reviewText.trim().length === 0) return
    const savedText = reviewText
    const savedRating = reviewRating
    setSubmittingReview(true)
    setReviewError('')
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          vendor_id: vendorId,
          rating: savedRating,
          comment: savedText.trim(),
        }),
      })
      if (res.ok) {
        setReviewSuccess(true)
        setReviewText('')
        setReviewRating(5)
        const data: { reviews?: RawReview[] } = await fetch(`/api/vendors/${vendorId}`).then((r) => r.json())
        setReviews(
          (data.reviews || []).map((r) => ({
            id: r.id,
            vendorId: r.vendor_id,
            customerId: r.author_name,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.created_at,
          }))
        )
      } else {
        setReviewError('No se pudo enviar la reseña. Intenta de nuevo.')
        setReviewText(savedText)
        setReviewRating(savedRating)
      }
    } catch {
      setReviewError('Error de conexión')
      setReviewText(savedText)
      setReviewRating(savedRating)
    } finally {
      setSubmittingReview(false)
    }
  }, [user, reviewText, reviewRating, vendorId])

  /** Add to cart with vendor-switch warning + bounce animation */
  const handleAddToCart = useCallback(
    (p: Product) => {
      const existingVendorId = cart[0]?.product.vendorId
      const switchedVendor = existingVendorId && existingVendorId !== p.vendorId
      addToCart(p)
      triggerCartBounce()
      if (switchedVendor) {
        toast({
          kind: 'warning',
          title: 'Carrito reemplazado',
          description: 'Solo puedes pedir a un vendedor a la vez por WhatsApp.',
        })
      } else {
        toast({ kind: 'success', title: 'Agregado al carrito', description: p.name })
      }
    },
    [cart, addToCart, triggerCartBounce]
  )

  const openCart = useCallback(() => setCartOpen(true), [setCartOpen])

  return {
    // data
    vendor,
    products,
    reviews,
    productPhotos,
    // derived
    isFavorite,
    cartItemCount,
    // micro-interaction flags (consumed by header)
    heartPop,
    cartBounce,
    // checkout
    isCheckingOut,
    checkoutError,
    handleCheckout,
    // review form state
    reviewText,
    reviewRating,
    setReviewText,
    setReviewRating,
    submittingReview,
    reviewSuccess,
    reviewError,
    submitReview,
    // actions
    toggleFavorite,
    handleAddToCart,
    openCart,
    // user (for buyer-only rendering decisions)
    user,
  }
}
