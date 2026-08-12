'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { Store, X } from 'lucide-react'

/**
 * Seller onboarding completion banner (2026-07-23, CRIT-A2 + Sprint 4 B6).
 *
 * Scenario: a user registers with role='seller'. The /api/auth/register
 * endpoint auto-bootstraps a vendors row inside the same transaction
 * (lines 251-279 of apps/web/app/api/auth/register/route.ts) with
 * is_active=false and a placeholder name "Mi negocio de {firstName}".
 * If the seller never completes the /onboarding VendorFormSlide — they
 * closed the tab mid-flow, lost signal in the street, or registered
 * without intending to set up a puesto right away — they end up with
 * user.role='seller' but a vendor that is permanently is_active=false
 * (and thus invisible on the map).
 *
 * What this banner does:
 *   - For sellers whose /api/vendors/me returns vendors.length===0,
 *     OR returns a vendor with is_active=false AND is_verified=false
 *     (still placeholder), shows a dismissable yellow CTA bar that
 *     links to /onboarding?next=<current path>.
 *   - Persists dismiss state in localStorage keyed by user id + vendor
 *     id so it re-appears if the placeholder vendor changes (e.g. the
 *     seller names it but never sets it active).
 *   - Sprint 4 B6: shows concrete completion progress and the first
 *     missing field, so the seller knows what's left instead of a
 *     generic "completá el registro".
 *
 * What this banner does NOT do:
 *   - It does NOT redirect. A seller might want to browse the map first
 *     to see the area before setting up. An aggressive redirect would
 *     trap them out of the app on a flaky street connection.
 *
 * Touch targets: the close (X) button is min 44px square (h-11 w-11).
 * The CTA button uses the shared <Button> component which is already
 * min-height 44px on mobile (see Button.tsx). The banner itself is
 * min-h-[56px] so the content is thumb-reachable.
 */
const STORAGE_PREFIX = 'seller_onboarding_banner_dismissed:'

// Map a backend `missingFields[]` token to a Spanish phrase for the banner
// sub-copy. Kept inline (not i18n) because this banner is only shown to ES-CO
// sellers in their own product. If we add i18n later, hoist to a hook.
const MISSING_FIELD_LABELS: Record<string, string> = {
  name: 'nombre',
  description: 'descripción',
  category: 'categoría',
  phone: 'WhatsApp',
  photo: 'foto',
  city: 'ciudad',
  location: 'ubicación',
}

function humanizeMissing(missing: string[]): string {
  if (missing.length === 0) return ''
  const labels = missing
    .map((m) => MISSING_FIELD_LABELS[m] ?? m)
    .slice(0, 3) // cap at 3 so we never blow up the banner height
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}

function dismissKey(userId: string, vendorKey: string): string {
  // Key per (user, vendor). When the vendor changes (or one is created)
  // the key changes too and the banner re-appears.
  return `${STORAGE_PREFIX}${userId}:${vendorKey}`
}

type VendorSummary = {
  id?: string
  isActive?: boolean
  isVerified?: boolean
  name?: string
  completionPercent?: number
  missingFields?: string[]
}

export function SellerOnboardingBanner() {
  const user = useStore((s) => s.user)
  const router = useRouter()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [vendorKey, setVendorKey] = useState<string>('none')
  const [dismissed, setDismissed] = useState(false)
  // Cached completion stats for the visible vendor. Defaults shown until the
  // fetch resolves.
  const [completionPercent, setCompletionPercent] = useState<number>(0)
  const [missingFields, setMissingFields] = useState<string[]>([])

  // Only consider the banner when we have a logged-in seller.
  useEffect(() => {
    if (!user || (user.role !== 'seller' && user.role !== 'service')) {
      setShow(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function check() {
      try {
        const res = await fetch('/api/vendors/me', {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!res.ok) {
          // 403 = buyer hitting the endpoint, 401 = not logged in. Either
          // way, banner should hide. Network errors → silent fail (we
          // don't want a flashing banner if the API blips).
          if (!cancelled) setShow(false)
          return
        }
        const data = await res.json()
        const list: VendorSummary[] = data.vendors ?? (data.vendor ? [data.vendor] : [])

        // Conditions to show:
        //   1. No vendor at all (legacy sellers, or registered before
        //      the auto-bootstrap in register landed in production).
        //   2. Has a vendor but it's still the placeholder
        //      (is_active=false AND is_verified=false) — the seller
        //      hasn't finished onboarding yet.
        let needsOnboarding = false
        let key = 'none'
        let placeholder: VendorSummary | null = null
        if (list.length === 0) {
          needsOnboarding = true
          key = 'empty'
        } else {
          placeholder = list.find(
            (v) => v.isActive === false && v.isVerified === false,
          ) ?? null
          if (placeholder) {
            needsOnboarding = true
            key = placeholder.id ?? 'placeholder'
          }
        }

        if (cancelled) return

        setVendorKey(key)
        const isDismissed = window.localStorage.getItem(dismissKey(user!.id, key)) === '1'
        setDismissed(isDismissed)

        // Read the completion stats. Fall back to zeros if the API didn't
        // include them yet (older servers during deploy).
        const pct = placeholder?.completionPercent ?? 0
        const missing = placeholder?.missingFields ?? []
        setCompletionPercent(pct)
        setMissingFields(missing)

        setShow(needsOnboarding && !isDismissed)
      } catch {
        // Network / abort — silent.
      }
    }

    check()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [user])

  if (!show || !user) return null

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(user.id, vendorKey), '1')
    } catch {
      // localStorage full / disabled — silent.
    }
    setShow(false)
  }

  // Compose the headline copy. Avoid "Tu cuenta está creada pero..." because
  // the seller already KNOWS they registered; the actionable info is "what's
  // missing right now". ES-CO casual register.
  const missingCopy = humanizeMissing(missingFields)
  const headline = `Te falta ${missingCopy} para activar tu puesto`
  // If the placeholder vendor is brand new (no fields filled), show the
  // progress percent. After at least one field is filled, the sub-copy
  // is the more concrete "falta X y Y" message.
  const showPercent = completionPercent > 0 && completionPercent < 100

  return (
    <div
      role="region"
      aria-label="Onboarding incompleto"
      className="sticky top-0 z-40 w-full bg-amber-50 border-b border-amber-200"
    >
      <div className="mx-auto flex max-w-screen-lg items-center gap-3 px-4 py-3 min-h-[56px]">
        <Store
          className="shrink-0 text-amber-700"
          size={22}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900 leading-snug">
            {headline}
          </p>
          <p className="text-xs text-amber-800/90 leading-snug mt-0.5">
            {showPercent
              ? `Vas al ${completionPercent}% · unos 5 min para terminarlo.`
              : 'Tu cuenta está lista, falta activar tu puesto.'}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => router.push(`/onboarding?next=${encodeURIComponent(pathname || '/profile/edit')}`)}
          className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
          aria-label="Activar mi puesto"
        >
          Activar
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Cerrar aviso"
          className="shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-lg text-amber-800 hover:bg-amber-100 active:bg-amber-200 transition-colors"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}