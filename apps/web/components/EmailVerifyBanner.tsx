'use client'

import { useState } from 'react'
import { Mail, X } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { useAutoVerifyToken } from '@/hooks/useAutoVerifyToken'

/**
 * Email verification banner.
 *
 * Shows a dismissable yellow bar on every authenticated page if
 * `user.emailVerified === false`. The banner has two states:
 *
 *  - Idle: "Verifica tu email. [Reenviar] [Cerrar]"
 *  - Sending: spinner + "Enviando…"
 *  - Sent: "Email reenviado. [Cerrar]"
 *
 * On mount, if the URL has `?token=…`, the auto-verify network call
 * is driven by `useAutoVerifyToken()` (P1-3 audit 2026-07-27). This
 * makes the link the user clicks in their email a one-click experience
 * even when the banner is the first thing rendered.
 *
 * Used in <SiteHeader> so it appears on every page.
 */
export function EmailVerifyBanner() {
  const user = useStore((s) => s.user)
  const dismissed = useStore((s) => s.verifyBannerDismissed)
  const setDismissed = useStore((s) => s.setVerifyBannerDismissed)
  const { verifying, result } = useAutoVerifyToken()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!user || user.emailVerified || dismissed) return null

  const handleResend = async () => {
    if (!user.email || sending) return
    setSending(true)
    setSent(false)
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: user.email }),
      })
      setSent(true)
    } catch {
      setSent(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap text-sm">
        <Mail size={16} className="text-yellow-700 flex-shrink-0" />
        {verifying ? (
          <span className="text-yellow-800">Verificando tu email…</span>
        ) : sent ? (
          <span className="text-yellow-800">
            Email de verificación reenviado a {user.email}. Revisa tu bandeja.
          </span>
        ) : result ? (
          <span
            className={
              result.ok
                ? 'text-green-800 font-medium'
                : 'text-red-800 font-medium'
            }
          >
            {result.message}
          </span>
        ) : (
          <>
            <span className="text-yellow-800">
              {/* Sprint 7 B-AUTH-4 (2026-07-23): copy now distinguishes the
                  verify-email prompt from the post-verification state
                  more clearly. Previous text said "Verifica tu email
                  para..." even when emailVerified=true was returned by
                  the API — caused by B-AUTH-1 (emailVerified only at top
                  level of response). After B-AUTH-1's fix this branch
                  is only reachable for genuinely unverified users, but
                  the copy is updated anyway to be explicit. */}
              {user.emailVerified === false
                ? 'Verifica tu email para crear tu puesto, dejar reseñas y contactar vendedores.'
                : 'Confirma tu email cuando puedas — algunas funciones están limitadas hasta entonces.'}
            </span>
            <span className="text-yellow-700/70 text-xs hidden sm:inline">
              Te enviamos un enlace a {user.email}.
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!sent && !verifying && !result && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResend}
              disabled={sending}
              className="h-7 text-xs border-yellow-300 hover:bg-yellow-100"
            >
              {sending ? 'Enviando…' : 'Reenviar email'}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Cerrar"
            className="p-1 text-yellow-700 hover:text-yellow-900 rounded"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

