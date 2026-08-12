'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CityInput } from '@/components/ui/CityInput'
import { useStore } from '@/store/useStore'
import type { UserRole } from '@/lib/core/types'

interface Props {
  isLoading: boolean
  error: string
  setError: (msg: string) => void
  setIsLoading: (b: boolean) => void
  /** Pre-selected role from the URL (?role=seller) or null. */
  initialRole?: UserRole
  /**
   * Where to send the user after a successful registration.
   *   - `'onboarding'` — seller → /onboarding, buyer → /map.
   *   - `'map'`       — everyone → /map.
   * P3-1 (audit 2026-07-27): the previous union
   *   `'dashboard' | 'onboarding' | 'map'` had a dead `'dashboard'`
   *   member — no caller in apps/web ever passed it. Narrowing forces
   *   TS to flag a future mistake and keeps the routing table honest.
   */
  redirectTo: 'onboarding' | 'map'
}

/**
 * Registration form — full name + contact (email OR phone) + alt contact
 * (optional) + city + password + role + Ley 1581/2012 consent.
 *
 * Used by both the login page (as a toggle step) and the standalone
 * /register route, so it accepts an initial role and a redirect target
 * as props instead of hard-coding them.
 *
 * The "single contact field" UX: user types either an email or a phone
 * number into one input, and we detect which one it is. They can fill
 * the alt-contact field too — backend accepts either, at least one is
 * required.
 */
export function RegisterForm({
  isLoading,
  error,
  setError,
  setIsLoading,
  initialRole = 'buyer',
  redirectTo,
}: Props) {
  const router = useRouter()
  const setUser = useStore((s) => s.setUser)
  // Sprint 11 B-AUTH-4 (2026-07-24): clear the justLoggedOut flag on
  // register so a successful register doesn't get intercepted by a
  // stale "don't redirect on 401" flag from a prior session.
  const setJustLoggedOut = useStore((s) => s.setJustLoggedOut)

  const [fullName, setFullName] = useState('')
  const [contact, setContact] = useState('')
  const [altContact, setAltContact] = useState('')
  const [cityId, setCityId] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>(initialRole)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showOnMap, setShowOnMap] = useState(false)

  const isContactEmail = contact.includes('@')
  const contactInputMode = isContactEmail ? 'email' : 'tel'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (!fullName || !regPassword) {
      setError('Completa tu nombre y contraseña')
      setIsLoading(false)
      return
    }
    if (!contact && !altContact) {
      setError('Necesitas al menos un email o un teléfono para registrarte')
      setIsLoading(false)
      return
    }
    if (regPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      setIsLoading(false)
      return
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setError('Debes aceptar los Términos y la Política de Tratamiento de Datos Personales para continuar.')
      setIsLoading(false)
      return
    }

    // Build payload — backend normalizes email/phone.
    const payload: Record<string, unknown> = {
      password: regPassword,
      name: fullName,
      cityId,
      role: selectedRole,
      acceptedTerms,
      acceptedPrivacy,
    }
    if (selectedRole === 'service') {
      payload.wantsMap = showOnMap
    }
    if (contact.includes('@')) {
      payload.email = contact
      if (altContact) payload.phone = altContact
    } else {
      payload.phone = contact
      if (altContact.includes('@')) payload.email = altContact
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al registrarse')
        setIsLoading(false)
        return
      }

      setJustLoggedOut(false)
      setUser({
        ...data.user,
        // Sprint 7 B-AUTH-1 (2026-07-23): the register response puts
        // emailVerified at the top level, but `setUser` expects it on
        // the user object so Zustand store + EmailVerifyBanner work.
        // Backward compatible — older /api/auth/login and other auth
        // endpoints already return `emailVerified` inside `user`, so
        // the spread overrides only when the server doesn't include it.
        emailVerified: data.user.emailVerified ?? data.emailVerified ?? false,
      })
      const role = data.user.role as UserRole
      const wantsMap = Boolean(data.user.wantsMap)
      const needsOnboarding =
        redirectTo === 'onboarding' &&
        (role === 'seller' || (role === 'service' && wantsMap))
      const target = needsOnboarding ? '/onboarding' : '/map'
      router.push(target)
    } catch {
      setError('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.')
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Role selector — M-3: shadow + scale feedback when selected so the
          click feels like a real selection instead of a border-only toggle. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setSelectedRole('buyer')}
          aria-pressed={selectedRole === 'buyer'}
          className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
            selectedRole === 'buyer'
              ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl mb-1">🛒</div>
          <div className="text-sm font-semibold text-gray-800">Comprador</div>
          <div className="text-xs text-gray-500">Buscar y pedir</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedRole('seller')}
          aria-pressed={selectedRole === 'seller'}
          className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
            selectedRole === 'seller'
              ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl mb-1">📍</div>
          <div className="text-sm font-semibold text-gray-800">Vendedor</div>
          <div className="text-xs text-gray-500">Aparecer en el mapa</div>
        </button>
        <button
          type="button"
          onClick={() => setSelectedRole('service')}
          aria-pressed={selectedRole === 'service'}
          className={`p-3 rounded-xl border-2 text-center transition-all duration-200 ease-out ${
            selectedRole === 'service'
              ? 'border-primary bg-orange-50 shadow-card-hover scale-[1.02]'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl mb-1">🛠️</div>
          <div className="text-sm font-semibold text-gray-800">Servicio</div>
          <div className="text-xs text-gray-500">A domicilio o con local</div>
        </button>
      </div>

      {selectedRole === 'service' && (
        <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer py-2.5 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors min-h-[44px]">
          <input
            type="checkbox"
            checked={showOnMap}
            onChange={(e) => setShowOnMap(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-primary-700 focus:ring-primary"
          />
          <span>
            Tengo un local/estudio físico y quiero aparecer en el mapa.
            <span className="block text-xs text-gray-500 mt-0.5">
              Si no tienes local, omite esta opción. Tus servicios se podrán buscar en /servicios igual.
            </span>
          </span>
        </label>
      )}

      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Nombre completo</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Juan Pérez"
          disabled={isLoading}
          className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Email o teléfono</label>
        <input
          type="text"
          inputMode={contactInputMode}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="tu@email.com o 300 123 4567 (+57 opcional)"
          disabled={isLoading}
          className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <p className="text-xs text-gray-500 mt-1">Necesitas al menos uno.</p>
      </div>

      {/*
        M-1: grid-rows 0fr→1fr so the altContact field expands smoothly
        instead of jumping the whole form down ~64px when it appears.
        The wrapping <div> is always rendered; only the inner row's height
        animates between 0fr (hidden) and 1fr (full content height).
      */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          contact ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        aria-hidden={!contact}
      >
        <div className="overflow-hidden">
          <div className="pb-1">
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              {isContactEmail ? 'Teléfono (opcional)' : 'Email (opcional)'}
            </label>
            <input
              type="text"
              inputMode={isContactEmail ? 'tel' : 'email'}
              autoComplete={isContactEmail ? 'tel' : 'email'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={altContact}
              onChange={(e) => setAltContact(e.target.value)}
              placeholder={isContactEmail ? 'tu@email.com' : '300 123 4567 (+57 opcional)'}
              disabled={isLoading}
              tabIndex={contact ? 0 : -1}
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Ciudad</label>
        <CityInput
          value={cityId}
          onChange={setCityId}
          disabled={isLoading}
          placeholder="Busca tu ciudad..."
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Contraseña</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={regPassword}
            onChange={(e) => setRegPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            disabled={isLoading}
            autoComplete="new-password"
            className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>

      {/*
        M-2: the error banner is always in the DOM so its height is
        reserved; opacity + max-height transition so it fades in/out
        smoothly instead of pushing the consent checkboxes down.
      */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          error ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        aria-live="polite"
        role={error ? 'alert' : undefined}
      >
        <div className="overflow-hidden">
          <p className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2">
            {error || ''}
          </p>
        </div>
      </div>

      <div className="space-y-1 pt-2">
        <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer py-2.5 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors min-h-[44px]">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-primary-700 focus:ring-primary"
          />
          <span>
            Acepto los{' '}
            <Link href="/terminos" className="text-primary-700 hover:underline" target="_blank">
              Términos de Servicio
            </Link>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer py-2.5 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors min-h-[44px]">
          <input
            type="checkbox"
            checked={acceptedPrivacy}
            onChange={(e) => setAcceptedPrivacy(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 rounded border-gray-300 text-primary-700 focus:ring-primary"
          />
          <span>
            Acepto la{' '}
            <Link href="/privacidad" className="text-primary-700 hover:underline" target="_blank">
              Política de Tratamiento de Datos Personales
            </Link>{' '}
            (Ley 1581/2012)
          </span>
        </label>
      </div>

      {!acceptedTerms || !acceptedPrivacy ? (
        <p className="text-xs text-gray-500">Acepta los Términos y la Política para continuar.</p>
      ) : null}

      <Button type="submit" className="w-full" size="lg" isLoading={isLoading} disabled={isLoading}>
        {isLoading ? 'Creando cuenta...' : 'Crear Cuenta'}
      </Button>
    </form>
  )
}
