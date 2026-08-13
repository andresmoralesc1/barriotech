'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Lock, Eye, EyeOff, CheckCircle, ArrowLeft, AlertCircle, Check } from 'lucide-react'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // If no token in URL, bounce to forgot-password. Audit 2026-08-13
  // U3: keep the form rendered with a "Redirigiendo…" state so
  // users with slow JS don't see a flash of empty content.
  const [redirecting, setRedirecting] = useState(!token)
  useEffect(() => {
    if (!token) {
      router.replace('/forgot-password')
    } else {
      setRedirecting(false)
    }
  }, [token, router])

  // Audit 2026-08-13 U8: live validation. Strength meter colors by length
  // (gray → red → green). Confirm match state.
  const passwordLength = password.length
  const passwordStrength = useMemo(() => {
    if (passwordLength === 0) return { label: '', color: 'bg-gray-200' }
    if (passwordLength < 8) return { label: 'Muy corta', color: 'bg-red-400' }
    if (passwordLength < 12) return { label: 'Aceptable', color: 'bg-yellow-400' }
    return { label: 'Segura', color: 'bg-green-500' }
  }, [passwordLength])
  const confirmState = useMemo(() => {
    if (confirmPassword.length === 0) return null
    return password === confirmPassword ? 'match' : 'mismatch'
  }, [password, confirmPassword])

  if (!token) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          {/* Audit 2026-08-13 U18: spinner instead of bare text. */}
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-gray-500 mt-3 text-sm">Redirigiendo…</p>
        </Card>
      </div>
    )
  }
  if (redirecting) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-gray-500 mt-3 text-sm">Redirigiendo…</p>
        </Card>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      let data
      try {
        data = await res.json()
      } catch {
        setError('Error interpretando respuesta del servidor')
        setIsLoading(false)
        return
      }

      if (!res.ok) {
        // Audit 2026-08-13 U9: surface the API's specific message (it's
        // already Spanish). Distinguish "token expired" / "token used"
        // from generic "couldn't reset" so the user knows whether to
        // request a new link.
        setError(data.error || 'No se pudo restablecer la contraseña')
        setIsLoading(false)
        return
      }

      setSuccess(true)
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Contraseña actualizada</h1>
          <p className="text-gray-600 mb-6">
            Tu contraseña fue cambiada. Por seguridad, cerramos sesión en todos tus dispositivos.
          </p>
          <Link href="/login" aria-label="Iniciar sesión">
            <Button className="w-full" size="lg">
              Iniciar sesión
            </Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
      <Card variant="elevated" className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-orange-100 rounded-2xl mb-4">
            <Lock size={28} className="text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Crea una nueva contraseña</h1>
          <p className="text-gray-500 text-sm">Mínimo 8 caracteres. No uses contraseñas comunes.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Nueva contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                disabled={isLoading}
                autoComplete="new-password"
                className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 pr-12"
                required
                aria-describedby="password-strength"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                // Audit 2026-08-13 U4: removed tabIndex={-1} so keyboard users
                // can tab to the toggle. aria-pressed announces the toggle
                // state to AT.
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {/* Audit 2026-08-13 U8: live strength meter. */}
            <div id="password-strength" className="mt-2" aria-live="polite">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${passwordStrength.color}`}
                  style={{ width: `${Math.min(100, (passwordLength / 12) * 100)}%` }}
                />
              </div>
              {passwordStrength.label && (
                <p className="text-xs mt-1 text-gray-500">{passwordStrength.label}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Confirmar contraseña</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite tu contraseña"
              disabled={isLoading}
              autoComplete="new-password"
              className={`w-full px-4 py-3 min-h-[44px] border rounded-xl text-sm focus:outline-none focus:ring-2 disabled:opacity-50 ${
                confirmState === 'match'
                  ? 'border-green-400 focus:ring-green-200'
                  : confirmState === 'mismatch'
                  ? 'border-red-400 focus:ring-red-200'
                  : 'border-gray-300 focus:ring-primary/50'
              }`}
              required
              aria-describedby="confirm-state"
            />
            {confirmState && (
              <p
                id="confirm-state"
                aria-live="polite"
                className={`text-xs mt-1 ${
                  confirmState === 'match' ? 'text-green-700' : 'text-red-600'
                }`}
              >
                {confirmState === 'match' ? (
                  <span className="inline-flex items-center gap-1">
                    <Check size={12} /> Coincide
                  </span>
                ) : (
                  'No coincide'
                )}
              </p>
            )}
          </div>

          {error && (
            // Audit 2026-08-13 U5/U9/U20: role=alert + specific message +
            // icon/border treatment matching the verify-email banner.
            <div
              role="alert"
              className="flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2"
            >
              <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
              <p>{error}</p>
              {/* Audit 2026-08-13 U9: shortcut to request a fresh link. */}
              {/expir|usad|no es válid/i.test(error) && (
                <Link
                  href="/forgot-password"
                  className="ml-auto text-primary-700 font-medium hover:underline whitespace-nowrap"
                >
                  Pedir nuevo enlace
                </Link>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading} disabled={isLoading}>
            {isLoading ? 'Actualizando...' : 'Cambiar contraseña'}
          </Button>

          <Link
            href="/login"
            aria-label="Volver a iniciar sesión"
            className="flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-primary-700 min-h-[44px]"
          >
            <ArrowLeft size={14} />
            Volver a iniciar sesión
          </Link>
        </form>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      // Audit 2026-08-13 U18: spinner instead of bare "Cargando..." text.
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-gray-400 mt-3 text-sm">Cargando…</p>
        </div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}