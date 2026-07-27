'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Bell, Lock, FileText, ChevronRight, Check, AlertCircle, LogOut } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Input } from '@/components/ui/Input'
import { useStore } from '@/store/useStore'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import type { City } from '@/lib/core/constants'

type ToastType = 'success' | 'error' | null

export default function SettingsPage() {
  const router = useRouter()
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)
  const _hasHydrated = useStore((s) => s._hasHydrated)
  const logout = useStore((s) => s.logout)
  const pushNotifications = useStore((s) => s.pushNotificationsEnabled)
  const setPushNotifications = useStore((s) => s.setPushNotifications)

  const { permission, subscribed, loading: pushLoading, subscribeToPush, unsubscribe, isSupported } = usePushNotifications()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [cityId, setCityId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: ToastType; message: string }>({ type: null, message: '' })
  const [cities, setCities] = useState<City[]>([])

  const showToast = (type: ToastType, message: string) => {
    setToast({ type, message })
    if (type) {
      setTimeout(() => setToast({ type: null, message: '' }), 3000)
    }
  }

  useEffect(() => {
    fetch('/api/cities')
      .then((res) => res.json())
      .then((data) => {
        if (data.cities) setCities(data.cities)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (user) {
      setName(user.fullName || '')
      setPhone(user.phone || '')
      setCityId(user.cityId || '')
    }
  }, [user])

  useEffect(() => {
    if (user?.role === 'seller') {
      fetch('/api/vendors/me', { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => {
          // c84a990 split the endpoint: GET returns { vendors: [...] }.
          // Defensive: accept legacy { vendor } too.
          const list = data.vendors ?? (data.vendor ? [data.vendor] : [])
          if (list[0]?.id) setVendorId(list[0].id)
        })
        .catch(() => {})
    }
  }, [user])

  const handlePushToggle = async (enabled: boolean) => {
    if (enabled) {
      if (permission === 'denied') {
        showToast('error', 'Activa las notificaciones en los ajustes de tu navegador')
        return
      }
      await subscribeToPush()
    } else {
      await unsubscribe()
    }
    setPushNotifications(enabled)
  }

  const handleSaveProfile = async () => {
    if (!user) return
    setSaving(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, phone, cityId }),
      })
      if (res.ok) {
        const updated = await res.json()
        setUser(updated)
        showToast('success', 'Cambios guardados')
      } else {
        const data = await res.json()
        showToast('error', data.error || 'Error al guardar')
      }
    } catch {
      showToast('error', 'Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  if (!_hasHydrated) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    router.push('/login')
    return null
  }

  return (
    <div className="min-h-screen bg-background-cream pb-20">
      {/* Toast */}
      {toast.type && (
        <div className={`fixed top-4 left-4 right-4 z-50 flex items-center gap-2 p-4 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm p-4">
        <h1 className="text-xl font-bold">Configuración</h1>
      </header>

      <div className="p-4 space-y-3 max-w-lg mx-auto">

        {/* ── Cuenta ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Cuenta
          </h2>
          <Card variant="outlined" className="overflow-hidden">

            {/* Avatar + info */}
            <div className="flex items-center gap-3 p-4 border-b border-gray-100">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                {user.fullName ? (
                  <span className="text-primary-700 font-semibold text-lg">
                    {user.fullName.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <User size={24} className="text-primary-700" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {user.fullName || 'Sin nombre'}
                </p>
                <p className="text-sm text-gray-500 truncate">{user.email}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary-700 font-medium shrink-0">
                {user.role === 'buyer' ? 'Comprador' : 'Vendedor'}
              </span>
            </div>

            {/* Edit fields */}
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Teléfono</label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="300 123 4567 (+57 opcional)"
                  type="tel"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Ciudad</label>
                <select
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary bg-white"
                >
                  <option value="">Selecciona una ciudad</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}, {city.department}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleSaveProfile}
                isLoading={saving}
              >
                Guardar cambios
              </Button>
            </div>

            {/* Ver perfil público del vendedor
                Bug 2026-07-22: si vendorId está vacío (seller legacy o
                fallo en la creación del vendor) el href `/vendor/` da 404.
                Ahora: si no hay vendorId redirigimos al onboarding para que
                cree su perfil. Rara vez se ve desde que el register
                auto-crea el vendor (commit del fix). */}
            {user.role === 'seller' && (
              <Link
                href={vendorId ? `/vendor/${vendorId}` : '/onboarding?redirectTo=/settings'}
                className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm">
                  {vendorId ? 'Ver perfil público' : 'Crear mi perfil de vendedor'}
                </span>
                <ChevronRight size={16} className="text-gray-400" />
              </Link>
            )}

            {/* Editar perfil del negocio — solo sellers.
                Funciona en ambos casos: si tienen vendor editan, si no
                la página /profile/edit muestra su propio CTA (opción B). */}
            {user.role === 'seller' && (
              <Link
                href="/profile/edit"
                className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm">Editar perfil del negocio</span>
                <ChevronRight size={16} className="text-gray-400" />
              </Link>
            )}

            {/* Cerrar sesión */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={16} />
              <span className="text-sm font-medium">Cerrar sesión</span>
            </button>
          </Card>
        </section>

        {/* ── Notificaciones ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Notificaciones
          </h2>
          <Card variant="outlined" className="divide-y divide-gray-100">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm text-gray-700">Alertas push</p>
                {!isSupported && (
                  <p className="text-xs text-amber-600">No soportado en este navegador</p>
                )}
                {isSupported && permission === 'denied' && (
                  <p className="text-xs text-red-500">Bloqueadas — actívalas en ajustes</p>
                )}
              </div>
              <Toggle
                enabled={subscribed}
                onChange={handlePushToggle}
                disabled={pushLoading || !isSupported}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm text-gray-700">Vendedores cercanos</p>
              <Toggle
                enabled={pushNotifications}
                onChange={setPushNotifications}
              />
            </div>
          </Card>
        </section>

        {/* ── Legal ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Legal
          </h2>
          <Card variant="outlined" className="divide-y divide-gray-100">
            <Link
              href="/privacidad"
              className="flex items-center justify-between px-4 py-3 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm">
                <Lock size={15} className="text-gray-400" />
                Política de privacidad
              </span>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
            <Link
              href="/terminos"
              className="flex items-center justify-between px-4 py-3 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm">
                <FileText size={15} className="text-gray-400" />
                Términos y condiciones
              </span>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
          </Card>
        </section>

        {/* ── Info ── */}
        <div className="text-center pt-2">
          <p className="text-xs text-gray-400">BarrioTech v1.0.0</p>
        </div>

      </div>

      {/* Bottom Nav — aria-label avoids landmark-unique violation. */}
      <nav className="bg-white border-t flex justify-around py-3" aria-label="Navegación de la cuenta">
        <Link href="/map" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span className="text-xs mt-1">Mapa</span>
        </Link>
        <Link href="/favorites" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          <span className="text-xs mt-1">Favoritos</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center text-primary-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          <span className="text-xs mt-1">Ajustes</span>
        </Link>
      </nav>
    </div>
  )
}
