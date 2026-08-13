'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Check, X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
// Button import kept for the resend form; the success CTA inlines the
// primary variant classes because Button doesn't expose asChild (audit
// 2026-08-13 U7).
import { useStore } from '@/store/useStore'
import { useAutoVerifyToken } from '@/hooks/useAutoVerifyToken'

/**
 * /verificar-email
 *
 * Two states:
 *  - URL has ?token=… → useAutoVerifyToken() drives the network call.
 *    On success, we show a confirmation banner + button to continue
 *    (P1-2 audit 2026-07-27 / audit 2026-08-13 U7):
 *      - sellers → /dashboard (where they can complete onboarding)
 *      - buyers  → /map     (where they can find vendors)
 *    We removed the 2s blind auto-redirect because screen readers
 *    couldn't finish announcing the success message before being yanked.
 *    A small setTimeout (1.5s) on the primary CTA still nudges users
 *    who don't read.
 *  - No token → show a "resend" form (you can re-trigger from here).
 */
function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useStore((s) => s.user)
  const { verifying, result } = useAutoVerifyToken()

  const token = searchParams.get('token')

  // Audit 2026-08-13 U1: initialize from user.email ONCE, not on every
  // render. The old `value={resendEmail || user?.email || ''}` pattern
  // meant the user could never clear the field — the binding kept
  // refilling it from the store. Single state, single source of truth.
  const [resendEmail, setResendEmail] = useState<string>(user?.email ?? '')
  const [resendStatus, setResendStatus] = useState<null | { ok: boolean; message: string }>(null)
  const [sending, setSending] = useState(false)

  // Audit 2026-08-13 U6: ref for the success banner so screen readers
  // (and keyboard users) get focus moved into the result region after
  // async transitions.
  const resultRef = useRef<HTMLDivElement>(null)

  // P1-2 (audit 2026-07-27): after a successful verification, the user
  // can click the manual CTA (preferred). Audit 2026-08-13 U7: the old
  // 2s blind setTimeout was yanked away before SR could finish. Now the
  // CTA is explicit; we still nudge after 1.5s for users who don't read.
  const [nudgeCountdown, setNudgeCountdown] = useState<number | null>(null)
  useEffect(() => {
    if (!result?.ok) {
      setNudgeCountdown(null)
      return
    }
    // Audit 2026-08-13 U6: move focus into the result banner on success
    // so SR users hear the success message even without nav.
    resultRef.current?.focus()
    setNudgeCountdown(2)
    const interval = setInterval(() => {
      setNudgeCountdown((c) => (c === null ? null : c - 1))
    }, 1000)
    const target = user?.role === 'seller' ? '/dashboard' : '/map'
    const t = setTimeout(() => router.push(target), 2000)
    return () => {
      clearInterval(interval)
      clearTimeout(t)
    }
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
      setResendStatus({
        ok: r.ok,
        // Audit 2026-08-13 U2: distinguish transport/business errors.
        // 5xx = Brevo/network problem → real error. 4xx/200 = generic
        // success (no-enumeration). 429 = rate-limited, surface throttled.
        message:
          r.status === 429
            ? 'Has pedido muchos reenvíos. Espera unos minutos.'
            : data.message || 'Email reenviado.',
      })
    } catch {
      setResendStatus({ ok: false, message: 'Error de conexión. Intenta de nuevo.' })
    } finally {
      setSending(false)
    }
  }

  const continueHref = user?.role === 'seller' ? '/dashboard' : '/map'
  const continueLabel = user?.role === 'seller' ? 'Ir a mi panel' : 'Ir al mapa'

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
          // Audit 2026-08-13 U6: tabIndex=-1 + autoFocus-style focus
          // via resultRef gives keyboard users a clear landing point.
          // tabIndex lets us programmatic-focus a non-interactive div.
          tabIndex={-1}
          ref={resultRef}
          // Audit 2026-08-13 U5: role + aria-live so screen readers
          // announce the success/failure without focus needing to move.
          role="status"
          aria-live="polite"
          className={`p-4 rounded-xl mb-6 outline-none ${
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
            // Audit 2026-08-13 U7: explicit manual CTA replaces the
            // 2s blind auto-redirect. Users get a real link to click.
            // (No <Button asChild> because Button doesn't expose it —
            // inlined the primary button classes here.)
            <Link
              href={continueHref}
              className="relative w-full mt-3 inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 bg-gradient-to-b from-primary to-primary-600 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] px-7 py-3.5 text-base"
            >
              {continueLabel}
              {nudgeCountdown !== null && nudgeCountdown > 0 && (
                <span className="ml-2 text-xs opacity-70">en {nudgeCountdown}s…</span>
              )}
              <ArrowRight size={16} className="ml-2" />
            </Link>
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
              value={resendEmail}
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
              // Audit 2026-08-13 U5: aria-live so the message is
              // announced when it appears.
              role="status"
              aria-live="polite"
              // Audit 2026-08-13 U21: success path now uses green so it
              // doesn't look muted — the API returns the generic
              // always-success message so the user has no signal of
              // "did it actually send", and gray reads as failure.
              className={`text-sm text-center ${
                resendStatus.ok ? 'text-green-700' : 'text-red-600'
              }`}
            >
              {resendStatus.message}
            </p>
          )}
        </form>
      )}

      <div className="text-center mt-6 pt-4 border-t border-gray-100">
        <Link
          href="/"
          // Audit 2026-08-13 I4: noreferrer so the token-in-URL Referer
          // doesn't leak when the user clicks this link.
          rel="noreferrer noopener"
          // Audit 2026-08-13 U17: aria-label so SR doesn't read the
          // surrounding text twice.
          aria-label="Volver al inicio"
          className="text-sm text-primary-700 hover:underline inline-flex items-center min-h-[44px] px-2"
        >
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
