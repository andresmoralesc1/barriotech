'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Lock, Eye, EyeOff, CheckCircle, ArrowLeft } from 'lucide-react'

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

  if (!token) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          <p className="text-gray-500">Redirigiendo…</p>
        </Card>
      </div>
    )
  }
  if (redirecting) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          <p className="text-gray-500">Redirigiendo…</p>
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
          <Link href="/login">
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

        <form onSubmit={handleSubmit} className="space-y-4">
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
          </div>

          <Input
            label="Confirmar contraseña"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repite tu contraseña"
            disabled={isLoading}
            autoComplete="new-password"
          />

          {error && (
            <p
              // Audit 2026-08-13 U5: role=alert so screen readers
              // announce the error.
              role="alert"
              className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading} disabled={isLoading}>
            {isLoading ? 'Actualizando...' : 'Cambiar contraseña'}
          </Button>

          <Link
            href="/login"
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
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <p className="text-gray-400">Cargando...</p>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}