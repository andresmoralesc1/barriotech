'use client'

import { useState, useEffect } from 'react'
import { Package, MapPin, MessageCircle, ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { VendorFormSlide } from './VendorFormSlide'
import { LocationCaptureSlide } from './LocationCaptureSlide'
import { PhotoUploadSlide } from './PhotoUploadSlide'

const STORAGE_KEY = 'seller_onboarding_done'

// FIELD-FIX v4 (2026-07-27): the "📸 Tu foto de perfil" slide used to be
// a static tip-only slide. The actual photo upload lived on
// /profile/edit, which field-onboarded sellers never reached. We replaced
// the static slide with PhotoUploadSlide at step index 2 (real upload
// component, persists to /api/vendors/me on Continuar).
const SLIDES = [
  {
    title: '📦 Tus productos',
    description: 'Agrega los productos que vendes con fotos, precios y descripciones atractivas.',
    Icon: Package,
    tip: 'Las fotos claras ayudan a que tus productos se entiendan mejor.',
  },
  {
    title: '📍 Tu ubicación',
    description: 'Activa la ubicación para que los compradores cercanos puedan encontrarte.',
    Icon: MapPin,
    tip: 'Puedes ajustar tu radio de cobertura desde tu perfil.',
  },
  {
    title: '💬 WhatsApp',
    description: 'Conecta tu WhatsApp para recibir mensajes directos de clientes interesados.',
    Icon: MessageCircle,
    tip: 'Responder pronto ayuda a generar confianza.',
  },
]

interface VendorCreated {
  id: string
  latitude: number | null
  longitude: number | null
  cityId: string | null
}

interface SellerOnboardingSliderProps {
  onComplete: () => void
  onSkip?: () => void
}

export function SellerOnboardingSlider({ onComplete, onSkip }: SellerOnboardingSliderProps) {
  // Step index map:
  //   0: VendorFormSlide       (mandatory — creates the vendor)
  //   1: LocationCaptureSlide  (optional — refines the pin)
  //   2: PhotoUploadSlide      (optional — uploads the profile photo)
  //   3..N: educational SLIDES (skippable)
  const TOTAL_STEPS = SLIDES.length + 3
  const [current, setCurrent] = useState(0)
  const [vendor, setVendor] = useState<VendorCreated | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string>('')

  // Check if already completed on mount
  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY)
    if (completed === 'true') {
      onComplete()
    }
  }, [onComplete])

  const goNext = () => {
    if (current < TOTAL_STEPS - 1) {
      setCurrent(current + 1)
    } else {
      localStorage.setItem(STORAGE_KEY, 'true')
      onComplete()
    }
  }

  const prev = () => {
    if (current > 0) setCurrent(current - 1)
  }

  const handleFormComplete = (newVendor: VendorCreated) => {
    setVendor(newVendor)
    goNext()
  }

  const handleLocationSaved = (_lat: number, _lng: number) => {
    // ManualLocationPicker already PATCHed /api/vendors/me/location.
    // We just advance the slider.
    goNext()
  }

  const handleLocationSkip = () => {
    // Seller chose "Lo dejo para después" — advance with the
    // city-center coords the bootstrap already wrote.
    goNext()
  }

  const handlePhotoSaved = (url: string) => {
    setPhotoUrl(url)
    goNext()
  }

  const handlePhotoSkip = () => {
    // Keep the existing photoUrl state (could be empty if no upload
    // happened yet, or set by a prior step); advance the slider.
    goNext()
  }

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    onSkip?.()
  }

  // Render: form (step 0) → location (step 1) → photo (step 2) → educational (step 3..N)
  if (current === 0) {
    return (
      <div className="min-h-screen flex flex-col bg-white px-6">
        <VendorFormSlide onCreated={handleFormComplete} />
      </div>
    )
  }

  if (current === 1 && vendor) {
    return (
      <div className="min-h-screen flex flex-col bg-white px-6">
        <LocationCaptureSlide
          vendorId={vendor.id}
          initialLat={vendor.latitude}
          initialLng={vendor.longitude}
          cityId={vendor.cityId}
          onSaved={handleLocationSaved}
          onSkip={handleLocationSkip}
        />
      </div>
    )
  }

  if (current === 2) {
    return (
      <div className="min-h-screen flex flex-col bg-white px-6">
        <PhotoUploadSlide
          initialPhotoUrl={photoUrl || null}
          onSaved={handlePhotoSaved}
          onSkip={handlePhotoSkip}
        />
      </div>
    )
  }

  const slide = SLIDES[current - 3]
  const IconComponent = slide.Icon

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-white">
      {/* Skip button — solo en slides educativos, no en el form */}
      {onSkip && (
        <button
          onClick={handleSkip}
          className="absolute top-6 right-6 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
        >
          Omitir
        </button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto py-12">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-8">
          <IconComponent size={40} className="text-primary-700" strokeWidth={1.5} />
        </div>

        {/* Content */}
        <h1 className="text-2xl font-bold text-center mb-3 text-gray-800">
          {slide.title}
        </h1>
        <p className="text-gray-600 text-center mb-6">
          {slide.description}
        </p>

        {/* Tip */}
        <div className="bg-primary/5 rounded-xl px-4 py-3 mb-8">
          <p className="text-sm text-primary-700 font-medium text-center">
            💡 {slide.tip}
          </p>
        </div>

        {/* Illustration placeholder */}
        <div className="w-full h-40 rounded-2xl overflow-hidden mb-4 bg-gray-50">
          <div className="w-full h-full flex items-center justify-center">
            <IconComponent size={64} className="text-gray-300" strokeWidth={1} />
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-8">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? 'w-8 bg-primary' : 'w-2.5 bg-gray-300'
            }`}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="w-full max-w-sm flex gap-3">
        {current > 0 && (
          <Button
            variant="outline"
            size="lg"
            onClick={prev}
            className="flex-1"
          >
            <ChevronLeft size={20} />
          </Button>
        )}
        <Button
          size="lg"
          onClick={goNext}
          className="flex-1"
        >
          {current === TOTAL_STEPS - 1 ? (
            'Finalizar'
          ) : (
            <span className="flex items-center gap-2">
              Siguiente <ChevronRight size={20} />
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}

// Helper to check if seller onboarding is completed
export function isSellerOnboardingDone(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

// Helper to reset seller onboarding (for testing)
export function resetSellerOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY)
}