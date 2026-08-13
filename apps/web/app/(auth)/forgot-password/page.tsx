'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { ArrowLeft, Mail, CheckCircle, AlertCircle } from 'lucide-react'

// Audit 2026-08-13 U12: pull reset-TTL from the API when available
// (env-overridable), default to 1h matching the backend.
const DEFAULT_RESET_TTL_LABEL = '1 hora'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [ttlLabel, setTtlLabel] = useState<string>(DEFAULT_RESET_TTL_LABEL)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (!email) {
      setError('Ingresa tu email')
      setIsLoading(false)
      return
    }
    // Audit 2026-08-13 U10: keep the cheap gate, but the real
    // validation runs through <Input type="email"> + the API. No need
    // to block on a regex here.
    if (!email.includes('@')) {
      setError('Email inválido')
      setIsLoading(false)
      return
    }

    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // Audit 2026-08-13 U2: distinguish transport from business errors.
      // 200/4xx → generic success (security — don't reveal if email exists).
      // 5xx → real transport/server error, surface it so the user knows
      // to retry rather than waiting for an email that won't come.
      if (r.status >= 500) {
        setError('No pudimos enviar el correo ahora. Intenta en unos minutos.')
        return
      }
      // Audit 2026-08-13 U12: if the API returns the canonical TTL label
      // we use it; otherwise stay with the default. Defensive copy — keeps
      // server-truth on the page.
      const data = await r.json().catch(() => ({}))
      if (typeof data?.ttlLabel === 'string') setTtlLabel(data.ttlLabel)
      setSubmitted(true)
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <Card variant="elevated" className="w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Revisa tu correo</h1>
          <p className="text-gray-600 mb-6">
            Si el email está registrado, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
          </p>
          <p className="text-sm text-gray-500 mb-2">
            El enlace expira en {ttlLabel}. Si no ves el email, revisa tu carpeta de spam o promociones.
          </p>
          {/* Audit 2026-08-13 U19: forgot-password now matches the
              reset-password page's session-invalidation claim, so users
              who recover through this flow know other devices will be
              logged out. Same UI shape as reset-password success card. */}
          <p className="text-sm text-gray-500 mb-6">
            Cuando uses el enlace, cerraremos sesión en todos tus dispositivos por seguridad.
          </p>
          <Link href="/login" aria-label="Volver a iniciar sesión">
            <Button variant="outline" className="w-full">
              <ArrowLeft size={16} className="mr-2" />
              Volver a iniciar sesión
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
            <Mail size={28} className="text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">¿Olvidaste tu contraseña?</h1>
          <p className="text-gray-500 text-sm">
            Ingresa tu email y te enviaremos un enlace para restablecerla.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            disabled={isLoading}
            autoComplete="email"
          />

          {error && (
            // Audit 2026-08-13 U5: role=alert so screen readers
            // announce the error.
            // Audit 2026-08-13 U20: error UI now matches the verify-email
            // banner pattern — icon + bg/border, not raw red text.
            <div role="alert" className="flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading} disabled={isLoading}>
            {isLoading ? 'Enviando...' : 'Enviar enlace de recuperación'}
          </Button>

          <Link
            href="/login"
            aria-label="Volver a iniciar sesión"
            className="flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-primary-700"
          >
            <ArrowLeft size={14} />
            Volver a iniciar sesión
          </Link>
        </form>
      </Card>
    </div>
  )
}