'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'
import { useAutoVerifyToken } from '@/hooks/useAutoVerifyToken'

/**
 * /verificar-email
 *
 * Two states:
 *  - URL has ?token=… → useAutoVerifyToken() drives the network call.
 *    On success, we redirect by role (P1-2 audit 2026-07-27):
 *      - sellers → /dashboard (where they can complete onboarding)
 *      - buyers  → /map     (where they can find vendors)
 *  - No token → show a "resend" form (you can re-trigger from here).
 */
function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useStore((s) => s.user)
  const { verifying, result } = useAutoVerifyToken()

  const token = searchParams.get('token')

  const [resendEmail, setResendEmail] = useState('')
  const [resendStatus, setResendStatus] = useState<null | { ok: boolean; message: string }>(null)
  const [sending, setSending] = useState(false)

  // P1-2 (audit 2026-07-27): after a successful verification, redirect
  // based on role. Previously the page hardcoded `/map` for everyone,
  // which dropped sellers into a buyer flow after they just confirmed
  // the email that the dashboard banner told them to confirm — they
  // had no clear path to their seller dashboard.
  //
  // We wait 2s so the user can see the success message before we
  // navigate; that's the same grace period the previous code used.
  useEffect(() => {
    if (!result?.ok) return
    const target = user?.role === 'seller' ? '/dashboard' : '/map'
    const t = setTimeout(() => router.push(target), 2000)
    return () => clearTimeout(t)
  }, [result?.ok, user?.role, router])

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setResendStatus(null)
    try {
      const r = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail || user?.email || '' }),
      })
      const data = await r.json().catch(() => ({}))
      // The endpoint always returns a generic message whether the email
      // exists or not. We surface it identically to keep the API honest.
      setResendStatus({ ok: r.ok, message: data.message || 'Email reenviado.' })
    } catch {
      setResendStatus({ ok: false, message: 'Error de conexión. Intenta de nuevo.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-gray-900/5 p-8 sm:p-10 w-full max-w-lg">
      <div className="text-center mb-6">
        <div className="inline-flex w-14 h-14 items-center justify-center rounded-2xl bg-orange-100 mb-4">
          <Mail size={28} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Verifica tu email</h1>
        <p className="text-gray-500 text-sm mt-1">
          Confirma tu dirección de email para activar tu cuenta de BarrioTech.
        </p>
      </div>

      {/* Verifying (URL has token) */}
      {verifying && (
        <div className="text-center py-6">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-gray-500 mt-3 text-sm">Verificando tu email…</p>
        </div>
      )}

      {/* Result from verification */}
      {result && !verifying && (
        <div
          className={`p-4 rounded-xl mb-6 ${
            result.ok
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {result.ok ? <Check size={18} /> : <X size={18} />}
            <p className="text-sm font-medium">{result.message}</p>
          </div>
          {result.ok && (
            <p className="text-xs mt-2 text-green-700">
              {user?.role === 'seller'
                ? 'Te llevamos a tu panel de vendedor…'
                : 'Te llevamos al mapa…'}
            </p>
          )}
        </div>
      )}

      {/* Resend form (no token) */}
      {!token && !verifying && (
        <form onSubmit={handleResend} className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Tu email</label>
            <input
              type="email"
              value={resendEmail || user?.email || ''}
              onChange={(e) => setResendEmail(e.target.value)}
              required
              // Explicit autoComplete prevents browsers from guessing (and
              // from password managers that have a stored password for a
              // different site from injecting into the wrong field).
              // Also adds `inputMode="email"` so mobile keyboards show the
              // email-optimized layout. Spec: WHATWG HTML living standard
              // — `autoComplete` for email is the token "email".
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="tu@email.com"
              className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Si te registraste, te enviamos un email con un enlace. Revisa
              también la carpeta de spam.
            </p>
          </div>
          <Button type="submit" disabled={sending} className="w-full" size="lg">
            {sending ? 'Enviando…' : 'Reenviar email de verificación'}
          </Button>
          {resendStatus && (
            <p
              className={`text-sm text-center ${
                resendStatus.ok ? 'text-gray-600' : 'text-red-600'
              }`}
            >
              {resendStatus.message}
            </p>
          )}
        </form>
      )}

      <div className="text-center mt-6 pt-4 border-t border-gray-100">
        <Link href="/" className="text-sm text-primary-700 hover:underline inline-flex items-center min-h-[44px] px-2">
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
      <Suspense
        fallback={
          <div className="w-full max-w-lg p-8 flex items-center justify-center">
            <p className="text-gray-400">Cargando...</p>
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </div>
  )
}
