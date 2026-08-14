// Audit 2026-08-14: force-dynamic so the prerendered SSR shell can't
// be served from cache to anonymous users.
export const dynamic = 'force-dynamic'

'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'
import { SellerOnboardingSlider } from './components/SellerOnboardingSlider'

const BUYER_SLIDES = [
  {
    title: 'Encuentra vendedores cerca de ti',
    description: 'Explora un mapa interactivo con todos los vendedores activos en tu zona.',
    image: 'https://images.pexels.com/photos/8824105/pexels-photo-8824105.jpeg?auto=compress&w=800',
  },
  {
    title: 'Mira productos y precios',
    description: 'Navega el catálogo de cada vendedor, mira fotos y decide qué quieres pedir.',
    image: 'https://images.pexels.com/photos/37348090/pexels-photo-37348090.jpeg?auto=compress&w=800',
  },
  {
    title: 'Contáctalos directo',
    description: 'Escríbeles por WhatsApp o teléfono — sin intermediarios, sin pagos en la app.',
    image: 'https://images.pexels.com/photos/5677994/pexels-photo-5677994.jpeg?auto=compress&w=800',
  },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const user = useStore((s) => s.user)
  const [mounted, setMounted] = useState(false)

  // Task 5 (2026-08-12): service users with wantsMap=true need the same
  // seller onboarding flow as role='seller'. The 'wantsMap === true'
  // (strict) means a service user who didn't opt into map visibility
  // skips the slider — they go straight to /map like a buyer.
  const isOnboardingUser =
    user?.role === 'seller' || (user?.role === 'service' && user.wantsMap === true)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleNext = () => {
    if (step < BUYER_SLIDES.length - 1) {
      setStep(step + 1)
    } else {
      router.push('/login')
    }
  }

  const handleSellerComplete = () => {
    // P2-3 (audit 2026-07-27): honor ?redirectTo= so callers can route
    // a seller back to where they were (e.g. /profile/edit when the
    // "you have no vendor" screen on /profile/edit links here with
    // ?redirectTo=/profile/edit). Falls back to /dashboard as before.
    // Only same-origin paths are accepted to prevent open-redirect.
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    const redirectTo = params.get('redirectTo')
    const safe = redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')
      ? redirectTo
      : '/dashboard'
    if (isOnboardingUser) {
      router.push(safe)
    } else {
      router.push('/login')
    }
  }

  const handleSellerSkip = () => {
    router.push('/login')
  }

  // Sprint 4 B8: swipe gesture (mobile). Tracks the first touch X and
  // commits the change once the user has moved past SWIPE_THRESHOLD
  // pixels AND the horizontal displacement dominates the vertical (to
  // not steal vertical scrolls).
  //
  // Sprint 4 B9: each completed swipe fires navigator.vibrate(10) — a
  // subtle 10ms haptic confirmation. iOS Safari doesn't support
  // navigator.vibrate (returns true and silently ignores), so this is
  // Android-only in practice. We intentionally cap at 10ms because the
  // swipe already provides visual feedback (slide transitions); heavy
  // vibration is fatiguing on a 3-slide onboarding.
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const SWIPE_THRESHOLD = 80

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(10) } catch { /* unsupported, silent */ }
    }
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartX.current = t.clientX
    touchStartY.current = t.clientY
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current
    const startY = touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (startX === null || startY === null) return

    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY

    // Reject if vertical movement dominates (a vertical scroll, not a swipe)
    if (Math.abs(dy) > Math.abs(dx) * 1.4) return

    if (dx <= -SWIPE_THRESHOLD) {
      // swipe-left → next
      triggerHaptic()
      handleNext()
    } else if (dx >= SWIPE_THRESHOLD && step > 0) {
      // swipe-right → previous (only if there's a previous slide)
      triggerHaptic()
      setStep(step - 1)
    }
  }

  // Show seller onboarding if user is a seller (or service+wantsMap)
  if (mounted && isOnboardingUser) {
    return (
      <SellerOnboardingSlider
        onComplete={handleSellerComplete}
        onSkip={handleSellerSkip}
      />
    )
  }

  // Buyer onboarding (original)
  const slide = BUYER_SLIDES[step]
  const totalSteps = BUYER_SLIDES.length
  const progressPct = ((step + 1) / totalSteps) * 100

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 bg-white"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Progress bar (top, fixed position). The `role="progressbar"` plus
          aria-valuenow/min/max makes this readable by VoiceOver / TalkBack
          and turns the visual fill into semantic progress info. The fill
          uses a CSS transform rather than a width change so the GPU can
          composite it without triggering layout on every step. */}
      <div className="fixed top-0 left-0 right-0 z-50 px-6 pt-3 pointer-events-none">
        {/* Sprint 4 B8: a visible "back" affordance on mobile (sm:hidden) so
            the swipe-back gesture isn't invisible to users who haven't
            discovered it. Pointer-events-auto on the button so it captures
            the tap even though the bar above is pointer-events-none. */}
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            aria-label="Volver al paso anterior"
            className="sm:hidden pointer-events-auto absolute left-4 top-3 inline-flex items-center justify-center h-11 w-11 rounded-full bg-white/80 backdrop-blur text-stone-700 hover:bg-white active:scale-95 transition shadow-sm border border-stone-200"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        )}
        <div
          className="w-full max-w-sm mx-auto h-1.5 bg-stone-200 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Paso ${step + 1} de ${totalSteps}`}
        >
          <div
            className="h-full bg-primary rounded-full transition-transform duration-300 ease-out origin-left"
            style={{ transform: `scaleX(${progressPct / 100})` }}
          />
        </div>
        <div className="text-center text-xs text-stone-500 mt-2 font-medium">
          {step + 1} de {totalSteps}
        </div>
      </div>

      <div className="text-center max-w-sm mx-auto flex-1 flex flex-col items-center justify-center py-12">
        <div className="w-full h-64 rounded-2xl overflow-hidden mb-8 shadow-lg">
          <img src={slide.image} alt={slide.title} className="w-full h-full object-cover" />
        </div>
        <h1 className="text-3xl font-bold mb-4">{slide.title}</h1>
        <p className="text-gray-500 text-lg">{slide.description}</p>
      </div>

      {/* Dots — kept as a visual second cue in addition to the progress
          bar. Some users (colorblind, low-vision) find the bar too thin
          to notice; the dots remain as a backup. */}
      <div className="flex gap-2 mb-8">
        {BUYER_SLIDES.map((_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              i === step ? 'bg-primary' : 'bg-gray-300'
            }`}
          />
        ))}
      </div>

      <div className="w-full max-w-sm">
        <Button className="w-full" size="lg" onClick={handleNext}>
          {step < BUYER_SLIDES.length - 1 ? (
            <span className="flex items-center gap-2">
              Siguiente <ChevronRight size={20} />
            </span>
          ) : (
            'Comenzar'
          )}
        </Button>
        {step < BUYER_SLIDES.length - 1 && (
          <button
            className="w-full text-center text-sm text-gray-400 mt-3 hover:text-gray-600"
            onClick={() => router.push('/login')}
          >
            Omitir
          </button>
        )}
      </div>
    </div>
  )
}
