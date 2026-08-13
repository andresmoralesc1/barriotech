'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/store/useStore'

/**
 * useAutoVerifyToken
 *
 * P1-3 (audit 2026-07-27): the auto-verify-on-?token= flow was duplicated
 * verbatim across /verificar-email/page.tsx and EmailVerifyBanner.tsx.
 * Each copy had subtle behavioral drift (one updated the store, one
 * cleaned the URL, neither ran under the same conditions). One source of
 * truth now.
 *
 * On mount: if the current URL has `?token=…`, POST to
 * /api/auth/verify-email. Side effects on success:
 *   - Flip the Zustand user's `emailVerified` flag (so the banner
 *     disappears everywhere in the same SPA tick).
 *   - Drop `?token=` from the URL and add `?verified=1` so a refresh
 *     doesn't re-trigger the call. The `verified=1` query param is
 *     readable by analytics later if we want it.
 *
 * Returns: { verifying, result, dismissResult }
 *   - `verifying` is true while the network call is in flight.
 *   - `result` is { ok, message } once the call resolves (or null while
 *     pending / before the URL had a token).
 *   - `dismissResult` lets the consumer clear the local result message
 *     (e.g. on a "got it" click). The hook continues to drive the URL
 *     side effects independently of UI dismissal.
 *
 * Note: we intentionally do NOT auto-redirect from this hook. The
 * caller decides where to send the user on success — /verificar-email
 * goes to /dashboard or /map depending on role (P1-2), EmailVerifyBanner
 * stays put. Keeping the redirect in the consumer is the cleanest split.
 */
export interface AutoVerifyState {
  verifying: boolean
  result: null | { ok: boolean; message: string }
  /** Clear the current `result` (e.g. after the user dismisses a notice). */
  dismissResult: () => void
}

const DEFAULT_OK_MESSAGE = 'Email verificado. ¡Bienvenido a BarrioTech!'
const DEFAULT_ERR_MESSAGE = 'No pudimos verificar tu email. Reenvíalo desde tu cuenta.'

export function useAutoVerifyToken(): AutoVerifyState {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<null | { ok: boolean; message: string }>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) return

    // Audit 2026-08-13 I6: strip the token from the URL *before* firing
    // the request so a browser refresh mid-fetch doesn't leak the token
    // via the Referer header on any subsequent navigation, and so the
    // token doesn't sit in browser history for the full duration of the
    // network call.
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    router.replace(url.pathname + url.search, { scroll: false })

    let cancelled = false
    setVerifying(true)
    setResult(null)

    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.ok && data.verified) {
          // Flip the store flag so the EmailVerifyBanner disappears
          // everywhere in the same SPA tick.
          const user = useStore.getState().user
          if (user) {
            useStore.setState({ user: { ...user, emailVerified: true } })
          }
          // Audit 2026-08-13 I6: token was already stripped before fetch;
          // here we only need to add ?verified=1 so a refresh doesn't
          // re-trigger. (router.replace here is also defensive in case
          // the URL had the token and the pre-fetch strip failed.)
          const url = new URL(window.location.href)
          url.searchParams.delete('token')
          url.searchParams.set('verified', '1')
          router.replace(url.pathname + url.search, { scroll: false })
          setResult({ ok: true, message: DEFAULT_OK_MESSAGE })
        } else {
          setResult({
            ok: false,
            message: data.error || DEFAULT_ERR_MESSAGE,
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        setResult({ ok: false, message: 'Error de conexión. Intenta de nuevo.' })
      })
      .finally(() => {
        if (!cancelled) setVerifying(false)
      })

    return () => {
      cancelled = true
    }
    // searchParams identity changes on every nav — fine for this hook,
    // we only re-fetch when ?token= appears again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return { verifying, result, dismissResult: () => setResult(null) }
}
