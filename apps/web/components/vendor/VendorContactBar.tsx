'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Navigation } from 'lucide-react'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import type { Vendor } from '@/lib/core/types'
import { isServiceCategory } from '@/lib/core/types'

interface Props {
  vendor: Vendor
}

/**
 * Sprint 5 B-009: sticky bottom contact bar on mobile.
 *
 * On <sm breakpoints, the WhatsApp / Call / Directions CTAs stay pinned
 * to the bottom of the viewport with `position: fixed`. The user can
 * scroll the vendor page (products, reviews, etc.) and never lose
 * access to the contact buttons — they're the most common next step.
 *
 * On desktop, this component is hidden (md:hidden) because the same
 * CTAs appear inline in the page content. Showing both would create
 * two competing call-to-action placements.
 *
 * Safe-area-inset-bottom: on iPhones with home indicator (X and later),
 * the bar lifts above the system gesture. Without this, the bar's
 * bottom edge clips under the home indicator and the bottom row of
 * taps is unreachable.
 *
 * Trigger logic: the bar slides up only after the user scrolls past
 * the original inline CTA location (data-anchor-target on the parent).
 * This avoids showing the floating bar over content the user is still
 * actively reading. We use IntersectionObserver on the inline anchor.
 */

// keepalive is essential here: the browser tab may navigate to tel:/wa.me
// before the fetch settles. keepalive defers completion until the new
// page is loaded.
async function logContact(vendorId: string, type: 'call' | 'whatsapp' | 'directions') {
  try {
    await fetch(`/api/vendors/${vendorId}/contact-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
      keepalive: true,
    })
  } catch {
    // Silent — audit logging is best-effort.
  }
}

export function VendorContactBar({ vendor }: Props) {
  const [visible, setVisible] = useState(false)
  // mount flag — the portal can't render until the client has hydrated,
  // otherwise SSR produces hydration mismatches when document.body is
  // available in one but not the other.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Hide until the user scrolls past the inline CTA. We use a sentinel
  // element approach instead of IntersectionObserver to avoid hydration
  // cost on mobile.
  useEffect(() => {
    const anchor = document.querySelector('[data-vendor-cta-anchor]')
    if (!anchor) {
      // No anchor on page — show the bar immediately so users can always
      // contact the vendor.
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // Bar appears when the anchor scrolls out of view (going up).
        const entry = entries[0]
        if (entry) setVisible(!entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [])

  // Migration 102: pick "productos" vs "servicios" based on vendor category.
  // See VendorContactActions for the same rationale.
  const offeringNoun = isServiceCategory(vendor.category) ? 'servicios' : 'productos'
  const whatsappUrl = vendor.phone
    ? `https://wa.me/${vendor.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `¡Hola! Quiero saber más sobre tus ${offeringNoun} en BarrioTech`
      )}`
    : null

  // If the vendor has no phone + no location, nothing to show.
  if (!vendor.phone && (vendor.latitude == null || vendor.longitude == null)) return null
  // SSR / pre-hydration: render nothing. The portal below re-renders into
  // document.body on the client.
  if (!mounted) return null

  // Sprint 8 5.5: portal the bar to document.body. Originally needed
  // because apps/web/app/template.tsx wrapped {children} with
  // `animate-slide-up`, which applied a CSS transform (`translateY(8px)`)
  // to the ancestor. CSS transforms create a new "containing block" for
  // `position: fixed` children, so the bar anchored to the wrapper
  // instead of the viewport. The transform was removed in Sprint 8 5.5
  // (replaced with `clip-path` which doesn't create a containing block),
  // so the portal is technically no longer required. We keep it as
  // defense-in-depth — if any future animation accidentally introduces
  // a transform on an ancestor, the bar still works. Portaling also
  // shields the bar from z-index stacking-context battles with the
  // page content.
  return createPortal(
    <div
      // md:hidden so this never appears on desktop where the inline CTA
      // is the only placement.
      className={`md:hidden fixed left-0 right-0 z-40 transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{
        // Lift above the iPhone home indicator so the bottom row of taps
        // is reachable on devices with safe-area-inset-bottom > 0.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-hidden={!visible}
    >
      <div className="bg-white border-t border-stone-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-3 py-2">
        <div className="flex items-center gap-2">
          {vendor.phone && (
            <a
              href={`tel:${vendor.phone}`}
              onClick={() => logContact(vendor.id, 'call')}
              aria-label={`Llamar a ${vendor.name}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-xl bg-primary-500 active:bg-primary-600 text-white text-sm font-semibold transition-colors"
            >
              <Phone size={18} aria-hidden="true" />
              <span>Llamar</span>
            </a>
          )}
          {vendor.phone && whatsappUrl && (
            <WhatsAppButton
              href={whatsappUrl}
              onClick={() => logContact(vendor.id, 'whatsapp')}
              className="flex-1 min-h-[48px]"
              label="WhatsApp"
            />
          )}
          {vendor.latitude != null && vendor.longitude != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${vendor.latitude},${vendor.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => logContact(vendor.id, 'directions')}
              aria-label={`Cómo llegar a ${vendor.name}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-xl bg-secondary active:bg-secondary-dark text-white text-sm font-semibold transition-colors"
            >
              <Navigation size={18} aria-hidden="true" />
              <span>Cómo llegar</span>
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}