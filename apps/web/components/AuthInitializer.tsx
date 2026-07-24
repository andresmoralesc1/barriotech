'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store/useStore'
import { authedFetch } from '@/lib/authed-fetch'

/**
 * Blocks rendering of children until the store has rehydrated AND
 * the user has been restored from the auth cookie.
 *
 * This eliminates the "flash of logged-out state" race condition where:
 * 1. Zustand hydrates with user: null from localStorage
 * 2. React components mount and see user: null
 * 3. onRehydrateStorage fires and calls /api/auth/me
 * 4. User gets set — but components already showed "logged out" UI
 *
 * Fix: components that need auth state wait for _hasHydrated before
 * rendering anything auth-dependent.
 *
 * Sprint 7 B-AUTH-2: switched the initial /api/auth/me call to
 * `authedFetch` so a stale access token (15-min expiry) is
 * silently refreshed from the 7-day refresh-token cookie. Before
 * this, anyone who sat on the page for >15 min without action got
 * logged out on the next API call.
 */
export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const setUser = useStore((s) => s.setUser)
  const setHasHydrated = useStore((s) => s.setHasHydrated)
  // Sprint 11 B-AUTH-4 (2026-07-24): if we landed on a page that
  // expected 401 (i.e. /login), clear justLoggedOut so future logins
  // are intercepted by the normal flow. This also handles the case
  // where a user logs out and the AuthInitializer's fetch lands before
  // the SiteHeader's `handleLogout` redirect completes.
  const setJustLoggedOut = useStore((s) => s.setJustLoggedOut)
  const justLoggedOut = useStore((s) => s.justLoggedOut)

  useEffect(() => {
    // If store already hydrated in a prior render, we're good
    if (useStore.getState()._hasHydrated) {
      setReady(true)
      return
    }

    // Otherwise fetch from cookie and mark hydrated
    setHasHydrated(false)
    authedFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        if (user) {
          setUser(user)
          // Successful /api/auth/me after a logout means the user is
          // re-registered or the cookie wasn't actually cleared. Either
          // way, the justLoggedOut flag is no longer meaningful.
          if (justLoggedOut) setJustLoggedOut(false)
        }
      })
      .catch(() => { /* not logged in */ })
      .finally(() => {
        setHasHydrated(true)
        setReady(true)
        // Sprint 11 B-AUTH-4 (2026-07-24): on /login or /register, the
        // 401 is the expected path. Clear justLoggedOut so a future
        // authedFetch can correctly redirect on a real session expiry.
        if (typeof window !== 'undefined') {
          const p = window.location.pathname
          if (p === '/login' || p === '/register') {
            setJustLoggedOut(false)
          }
          // Clean up the ?logged_out=1 query param the SiteHeader added
          // on logout, so the URL bar doesn't carry it after the user
          // landed on '/'. We use replaceState (not pushState) so the
          // back button doesn't restore the logged_out state.
          if (new URLSearchParams(window.location.search).get('logged_out') === '1') {
            window.history.replaceState(null, '', window.location.pathname)
          }
        }
      })
  }, [setUser, setHasHydrated, setJustLoggedOut, justLoggedOut])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
