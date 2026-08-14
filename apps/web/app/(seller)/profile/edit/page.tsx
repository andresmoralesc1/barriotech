'use client';

// Audit 2026-08-14: force-dynamic so the prerendered SSR shell can't
// be served from cache to anonymous users.
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useEditProfile } from '@/hooks/useEditProfile'
import { ProfilePictureSection } from '@/components/seller/ProfilePictureSection'
import { BusinessDataSection } from '@/components/seller/BusinessDataSection'
import { VehicleSection } from '@/components/seller/VehicleSection'
import { LocationSection } from '@/components/seller/LocationSection'
import { GeoModeSection } from '@/components/seller/GeoModeSection'

export default function EditProfilePage() {
  const router = useRouter()
  const {
    loading,
    saving,
    error,
    vendorId,
    name,
    description,
    category,
    phone,
    photoUrl,
    vehicleType,
    vehiclePhotoUrl,
    latitude,
    longitude,
    geoMode,
    geoZoneRadiusM,
    setName,
    setDescription,
    setCategory,
    setPhone,
    setPhotoUrl,
    setVehicleType,
    setVehiclePhotoUrl,
    setLatitude,
    setLongitude,
    setGeoMode,
    setGeoZoneRadiusM,
    handleSave,
  } = useEditProfile()

  if (loading) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    )
  }

  // Red de seguridad (opción B del fix 2026-07-22): si el seller no tiene
  // vendor todavía (cuenta legacy creada antes del auto-bootstrap o un fallo
  // de transacción), le damos una acción en vez de una pared.
  // Rara vez se dispara ahora que /api/auth/register crea el vendor
  // automáticamente, pero cuesta poco mantenerla por si A se desactiva.
  if (!vendorId) {
    return (
      <div className="min-h-screen bg-background-cream">
        <header className="bg-white shadow-sm p-4 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost"><ChevronLeft size={20} /></Button>
          </Link>
          <h1 className="text-lg font-bold">Editar perfil</h1>
        </header>
        <div className="p-4">
          <Card variant="outlined" className="p-8 text-center">
            <p className="text-gray-500 mb-4">No tienes perfil de vendedor</p>
            <p className="text-sm text-gray-400 mb-6">
              Crea tu perfil para empezar a recibir pedidos
            </p>
            <div className="flex flex-col gap-2">
              {/* El seller rellena sus datos en /onboarding (que ya tiene
                  VendorFormSlide con los campos completos). Al terminar lo
                  manda al dashboard con la vendor row creada. */}
              <Link href="/onboarding?redirectTo=/profile/edit">
                <Button>Crear mi perfil de vendedor</Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="ghost">Volver al dashboard</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background-cream">
      <header className="bg-white shadow-sm p-4 flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost"><ChevronLeft size={20} /></Button>
        </Link>
        <h1 className="text-lg font-bold">Editar perfil</h1>
      </header>

      <div className="p-4 space-y-4">
        <ProfilePictureSection photoUrl={photoUrl} onPhotoChange={setPhotoUrl} />

        <BusinessDataSection
          name={name}
          description={description}
          category={category}
          phone={phone}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onCategoryChange={setCategory}
          onPhoneChange={setPhone}
        />

        <VehicleSection
          vehicleType={vehicleType}
          vehiclePhotoUrl={vehiclePhotoUrl}
          onVehicleTypeChange={setVehicleType}
          onVehiclePhotoChange={setVehiclePhotoUrl}
        />

        <LocationSection
          initialLat={latitude}
          initialLng={longitude}
          onLocationChange={(lat, lng) => {
            setLatitude(lat)
            setLongitude(lng)
          }}
        />

        <GeoModeSection
          geoMode={geoMode}
          geoZoneRadiusM={geoZoneRadiusM}
          onGeoModeChange={setGeoMode}
          onRadiusChange={setGeoZoneRadiusM}
        />

        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}

        <Button onClick={handleSave} size="lg" className="w-full" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar Cambios'}
        </Button>
      </div>
    </div>
  )
}