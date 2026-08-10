'use client'

import { useRouter } from 'next/navigation'
import { VendorProfile } from '@/components/vendor/VendorProfile'
import { VendorProducts } from '@/components/vendor/VendorProducts'
import { VendorReviews } from '@/components/vendor/VendorReviews'
import { VendorLocationMap } from '@/components/vendor/VendorLocationMap'
import { CartDrawer } from '@/components/cart/CartDrawer'
import { VendorDetailHeader } from '@/components/vendor/VendorDetailHeader'
import { VendorStatusBadges } from '@/components/vendor/VendorStatusBadges'
import { VendorContactActions } from '@/components/vendor/VendorContactActions'
import { VendorContactBar } from '@/components/vendor/VendorContactBar'
import { VendorReviewForm } from '@/components/vendor/VendorReviewForm'
import { VendorNotificationCta } from '@/components/vendor/VendorNotificationCta'
import { useVendorDetail } from '@/hooks/useVendorDetail'
import type { Vendor } from '@/lib/core/types'

interface Props {
  /**
   * Always a UUID. The server resolves both UUID and slug URLs to the canonical
   * UUID before passing it here so client endpoints (favorites, orders, etc.)
   * always get a valid UUID.
   */
  vendorId: string
  /**
   * The slug from the URL (for canonical redirects and breadcrumb display).
   * May be the same value as `vendorId` when the URL was already a UUID.
   */
  vendorSlug?: string
}

/**
 * Composer for the /vendor/[id] buyer page. All state + side effects
 * live in `useVendorDetail`; this component is responsible for
 * layout + composing the focused section components.
 *
 * Sections, in render order:
 *   1. Header — back / vendor name / favorite / cart
 *   2. Profile — avatar + bio + meta
 *   3. Status badges — open / closed / station type / hours
 *   4. Mini-map — current vendor location (if lat/lng)
 *   5. Contact actions — call / WhatsApp / directions
 *   6. Products grid — with add-to-cart
 *   7. Review form (buyers only)
 *   8. Reviews list
 *   9. Notification CTA card
 */
export function VendorDetailClient({ vendorId, vendorSlug }: Props) {
  const router = useRouter()
  const {
    vendor,
    products,
    reviews,
    productPhotos,
    isFavorite,
    cartItemCount,
    heartPop,
    cartBounce,
    isCheckingOut,
    checkoutError,
    reviewText,
    reviewRating,
    submittingReview,
    reviewSuccess,
    reviewError,
    submitReview,
    toggleFavorite,
    handleAddToCart,
    openCart,
    handleCheckout,
    setReviewText,
    setReviewRating,
    user,
  } = useVendorDetail(vendorId, vendorSlug)

  if (!vendor) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Cargando...</div>
      </div>
    )
  }

  // Adapt vendor to component's expected shape (some fields are
  // pre-parsed in the hook, some are still raw strings from the API).
  // M-001 fix: phone + latitude + longitude must reach `VendorContactActions`
  // so the contact CTAs render. Earlier omission made the API return phone
  // for free but the UI never saw it.
  const adaptedVendor: Vendor = {
    id: vendor.id,
    userId: '',
    name: vendor.name,
    category: vendor.category,
    description: vendor.description || '',
    photoUrl: vendor.photoUrl || '',
    isActive: vendor.isActive,
    isVerified: vendor.isVerified || false,
    ratingAvg: typeof vendor.ratingAvg === 'string' ? parseFloat(vendor.ratingAvg) : vendor.ratingAvg || 0,
    reviewCount: vendor.reviewCount ?? 0,
    createdAt: vendor.createdAt,
    vehicleType: vendor.vehicleType,
    vehiclePhotoUrl: vendor.vehiclePhotoUrl,
    phone: vendor.phone,
    latitude: vendor.latitude,
    longitude: vendor.longitude,
  }

  return (
    <div className="min-h-screen bg-background-cream pb-20">
      <VendorDetailHeader
        vendorName={vendor.name}
        vendorId={vendor.id}
        isFavorite={isFavorite}
        cartItemCount={cartItemCount}
        heartPop={heartPop}
        cartBounce={cartBounce}
        onBack={() => router.back()}
        onToggleFavorite={toggleFavorite}
        onOpenCart={openCart}
      />

      <div className="p-4 space-y-6 max-w-5xl mx-auto md:p-6 md:space-y-8">
        <VendorProfile vendor={adaptedVendor} />

        <VendorStatusBadges vendor={adaptedVendor} />

        {vendor.latitude != null && vendor.longitude != null && (
          <VendorLocationMap
            lat={vendor.latitude}
            lng={vendor.longitude}
            name={vendor.name}
            category={vendor.category}
            stationType={vendor.stationType}
          />
        )}

        {/* data-vendor-cta-anchor is the sentinel the floating
            VendorContactBar observes (IntersectionObserver). When this
            block scrolls out of view, the floating bar slides up from
            the bottom of the viewport. */}
        <div data-vendor-cta-anchor>
          <VendorContactActions vendor={adaptedVendor} />
        </div>

        {/* Phase G5: pass vendor identity so the "Reservar" button on
            service offerings can open WhatsApp directly. The shape
            is minimal (name + phone) — VendorProducts only needs
            these to construct the wa.me link + greeting line. */}
        <VendorProducts
          products={products}
          extraPhotos={productPhotos}
          onAddToCart={handleAddToCart}
          vendor={{ name: vendor.name, phone: vendor.phone }}
        />

        {/* Review form is for buyers only — sellers can't review their own profile. */}
        {user && user.role === 'buyer' && (
          <VendorReviewForm
            reviewText={reviewText}
            reviewRating={reviewRating}
            reviewSuccess={reviewSuccess}
            reviewError={reviewError}
            submittingReview={submittingReview}
            onTextChange={setReviewText}
            onRatingChange={setReviewRating}
            onSubmit={submitReview}
          />
        )}

        <VendorReviews reviews={reviews} />

        <VendorNotificationCta isLoggedIn={!!user} />
      </div>

      {/* Sprint 5 B-009: floating contact bar on mobile. md:hidden hides
          it on desktop because the inline VendorContactActions covers
          that case. The bar observes [data-vendor-cta-anchor] (above)
          via IntersectionObserver and slides up when the inline CTA
          scrolls off-screen. */}
      <VendorContactBar vendor={adaptedVendor} />

      <CartDrawer
        vendorPhone={vendor.phone}
        vendorName={vendor.name}
        onCheckout={handleCheckout}
        isCheckingOut={isCheckingOut}
        checkoutError={checkoutError}
      />
    </div>
  )
}
