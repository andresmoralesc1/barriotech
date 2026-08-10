'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { X, MapPin, Heart, Bell, ArrowRight } from 'lucide-react'

const STORAGE_KEY = 'barriotech_onboarding_done'
const LABELS: Record<string, string> = {
  '/map': 'mapa',
  '/favorites': 'favoritos',
  '/settings': 'ajustes',
}
const STEPS = [
  {
    icon: MapPin,
    title: 'Encuentra vendedores cerca de ti',
    body: 'El mapa te muestra vendedores activos en tu barrio en tiempo real.',
    target: '/map',
  },
  {
    icon: Heart,
    title: 'Guarda tus favoritos',
    body: 'Marca los vendedores que más te gusten para encontrarlos rápido.',
    target: '/favorites',
  },
  {
    icon: Bell,
    title: 'Recibe notificaciones',
    body: 'Te avisamos cuando tus favoritos estén cerca o tengan algo nuevo.',
    target: '/settings',
  },
]

/**
 * 3-step onboarding tour for new buyers.
 * Shown once on first visit to a buyer page. Dismissed permanently after
 * the user completes all steps or hits Skip.
 *
 * Phase G6 a11y: WCAG 2.1 modal dialog pattern.
 *   - role="dialog" + aria-modal + labelledby + describedby (already
 *     present from the original implementation).
 *   - ESC closes (added in this commit).
 *   - Backdrop click closes (the user can now dismiss without finding
 *     the X button).
 *   - Focus trap: Tab and Shift+Tab cycle within the dialog instead
 *     of escaping to the underlying app. Critical: without this, a
 *     screen reader user tabbing through the tour would land on
 *     invisible map markers / vendor pins behind the dialog.
 *   - Initial focus moves to the close button (top-right X) so the
 *     user has a safe "out". On close, focus returns to the element
 *     that triggered the tour (or document.body if unknown).
 *
 * The focusable-element search runs on every Tab keystroke — fine
 * for a dialog with 4-5 focusable elements (X, 2 CTA buttons, skip).
 */
export function OnboardingTour() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Only show on buyer pages (map, favorites, settings) and only once.
    // Run on first mount — do NOT depend on `pathname` because that would
    // re-arm the timer on every client-side navigation and re-trigger the
    // tour for users who already finished it (the localStorage guard below
    // would still let it through if the storage write race-lost).
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEY) === '1') return

    const buyerPaths = ['/map', '/favorites', '/settings']
    if (!buyerPaths.some((p) => pathname?.startsWith(p))) return

    const skipPaths = ['/login', '/register', '/onboarding', '/profile']
    if (skipPaths.some((p) => pathname?.startsWith(p))) return

    const timer = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close on Escape + focus trap (WCAG 2.1 — keyboard + non-escape focus).
  useEffect(() => {
    if (!open) return

    // Capture the element that had focus before the dialog opened so we
    // can restore it on close. Without restoration, screen readers and
    // keyboard users are stranded at <body> after dismissing the tour.
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null

    // Initial focus: first focusable element inside the dialog. We pick
    // the close (X) button as a safe "out" — Esc / Enter / Tab all
    // get the user out from there.
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        skip()
        return
      }
      // Tab / Shift+Tab focus trap
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', keyHandler)
    return () => document.removeEventListener('keydown', keyHandler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
    // Restore focus to the trigger element so keyboard / screen-reader
    // users land back where they were. Fall back to <body> if the
    // trigger is gone (e.g. after a route change).
    requestAnimationFrame(() => {
      const el = triggerRef.current
      if (el && document.contains(el)) {
        el.focus()
      } else {
        document.body.focus()
      }
      triggerRef.current = null
    })
  }

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      finish()
    }
  }

  const skip = () => finish()

  const goToStep = () => {
    finish()
    router.push(STEPS[step].target)
  }

  if (!open) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1
  const isFirst = step === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
      aria-describedby="onboarding-tour-body"
      // G6 backdrop click closes the tour. Inner clicks (which carry
      // the dialog itself) stop propagation so the backdrop handler
      // doesn't fire from inside the dialog.
      onClick={(e) => {
        if (e.target === e.currentTarget) finish()
      }}
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
      >
        <button
          ref={closeButtonRef}
          onClick={skip}
          aria-label="Cerrar tour"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 p-1 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg"
        >
          <X size={20} />
        </button>

        <div className="flex justify-center mb-4">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
            <Icon size={40} className="text-amber-600" />
          </div>
        </div>

        <h2 id="onboarding-tour-title" className="text-xl font-bold text-center text-gray-800 mb-2">
          {current.title}
        </h2>
        <p id="onboarding-tour-body" className="text-center text-gray-600 mb-6">
          {current.body}
        </p>

        {/* Step indicators */}
        <div className="flex justify-center gap-2 mb-5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-8 bg-amber-500' : 'w-1.5 bg-gray-300'
              }`}
            />
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={goToStep}
            className="flex-1 px-4 py-3 rounded-xl border-2 border-amber-500 text-amber-600 font-semibold hover:bg-amber-50 transition-colors"
          >
            {isFirst ? 'Entendido' : `Ir a ${LABELS[current.target] || current.target}`}
          </button>
          <button
            onClick={next}
            className="flex-1 px-4 py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors flex items-center justify-center gap-1"
          >
            {isLast ? 'Listo' : 'Siguiente'}
            {!isLast && <ArrowRight size={18} />}
          </button>
        </div>

        <button
          onClick={skip}
          className="block mx-auto mt-3 px-3 py-2 text-sm text-gray-400 hover:text-gray-600 rounded min-h-[36px]"
        >
          Omitir tour
        </button>
      </div>
    </div>
  )
}