'use client'

import { Phone, Navigation } from 'lucide-react'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import type { Vendor } from '@/lib/core/types'
import { isServiceCategory } from '@/lib/core/types'

interface Props {
  vendor: Vendor
}

/**
 * Three-up CTA strip: call / WhatsApp / directions. Each button only
 * renders when the underlying capability exists on the vendor (phone
 * for call+wa, lat/lng for directions). The WhatsApp button keeps the
 * ripple + fly-out micro-interaction (see WhatsAppButton.tsx).
 *
 * M-001 D (2026-07-23): every CTA now fires a fire-and-forget POST to
 * /api/vendors/[id]/contact-log BEFORE the navigation. The endpoint is
 * designed to never block — it returns 204 in <50ms and a missing/failed
 * log is invisible to the user. We use `keepalive: true` so the request
 * survives the page navigation that immediately follows.
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

export function VendorContactActions({ vendor }: Props) {
  // Migration 102: services vendors ("clases", "belleza", etc.) want a
  // service-flavored opener in WhatsApp, not the generic "productos" copy.
  // The vendor's `category` is the canonical signal — the buyer opens
  // this CTA after seeing the vendor detail page, so the message tone
  // should match what they saw.
  const offeringNoun = isServiceCategory(vendor.category) ? 'servicios' : 'productos'
  const whatsappUrl = vendor.phone
    ? `https://wa.me/${vendor.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `¡Hola! Quiero saber más sobre tus ${offeringNoun} en BarrioTech`
      )}`
    : null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-sm text-gray-600 mb-3">Contacta a {vendor.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
        {vendor.phone && (
          <a
            href={`tel:${vendor.phone}`}
            onClick={() => logContact(vendor.id, 'call')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-colors md:py-2.5"
          >
            <Phone size={18} />
            <span>Llamar</span>
          </a>
        )}
        {vendor.phone && whatsappUrl && (
          <WhatsAppButton
            href={whatsappUrl}
            onClick={() => logContact(vendor.id, 'whatsapp')}
            className="w-full md:w-auto md:py-2.5"
            label="WhatsApp"
          />
        )}
        {vendor.latitude != null && vendor.longitude != null && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${vendor.latitude},${vendor.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => logContact(vendor.id, 'directions')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-secondary hover:bg-secondary-dark text-white font-medium rounded-xl transition-colors md:py-2.5"
          >
            <Navigation size={18} />
            <span>Cómo llegar</span>
          </a>
        )}
      </div>
    </div>
  )
}
