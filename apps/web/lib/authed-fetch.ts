/**
 * Auth-aware fetch wrapper (Sprint 7 B-AUTH-2).
 *
 * Why this exists:
 *   - The access token cookie expires after 15 minutes.
 *   - The refresh-token cookie lasts 7 days and is sent to /api/auth/refresh
 *     to mint a new access token. Both cookies are httpOnly + SameSite=strict
 *     so the browser sends them on every same-origin POST automatically.
 *   - Before Sprint 7, no client code called /api/auth/refresh. After 15 min
 *     of idle, every authenticated fetch returned 401 and the user had to
 *     log in again — a constant source of complaints.
 *
 * What this does:
 *   - Wraps every `fetch()` that goes through `authedFetch()`.
 *   - If the response is 401 (token expired OR refresh-token expired),
 *     tries one silent refresh, retries the original request once.
 *   - If the refresh itself fails, clears the user state and redirects to
 *     /login so the user can re-authenticate. We don't throw — the caller
 *     will get whatever the retry returned (401 or 200), and pages that
 *     care about auth state re-read it from the store.
 *
 * Why not a service worker or middleware interceptor?
 *   - Next.js Edge middleware can't read httpOnly cookies from a server-side
 *     fetch (the cookie is opaque to JS). It can only redirect. The actual
 *     refresh round-trip has to happen from client code.
 *
 * Pitfalls:
 *   - We MUST NOT call /api/auth/refresh on a request that itself was the
 *     refresh attempt (would infinite-loop). The `retried` flag prevents that.
 *   - On mobile a flaky network can cause a 401 even when the cookie is
 *     valid (e.g. race with another tab's logout). We retry the request
 *     after refresh but if the refresh also fails, we give up cleanly — never
 *     bounce the user to /login mid-task on a one-off transient error.
 */

import { useStore } from '@/store/useStore'

const REFRESH_PATH = '/api/auth/refresh'

type FetchOptions = RequestInit & { skipAuthRefresh?: boolean }

/**
 * Same-origin fetch that auto-refreshes the access token on 401.
 *
 * The wrapper is intentionally narrow: it only fires on 401 with the
 * "WWW-Authenticate" header missing (most cases). A 401 from a custom
 * endpoint that returns a body error is still surfaced to the caller —
 * we don't want to mask real auth errors as "just an expired token".
 */
export async function authedFetch(
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    // Always include same-origin Origin so the CSRF guard on protected
    // endpoints doesn't reject us. Browsers add this automatically for
    // same-origin fetch, but only on the actual request — including the
    // header explicitly survives any future change to fetch defaults.
    headers: {
      ...(options.headers || {}),
      // Don't override an Origin the caller explicitly set.
      ...(options.headers && (options.headers as Record<string, string>).Origin
        ? {}
        : { Origin: window.location.origin }),
    },
  })

  if (res.status !== 401 || options.skipAuthRefresh) {
    return res
  }

  // Single retry: refresh once, then replay the original request.
  // If the refresh endpoint itself returned 401, the refresh token is
  // gone or revoked — send the user back to /login.
  const refreshed = await tryRefresh()
  if (!refreshed) {
    // Best-effort clear. If the user lands on /login because of a network
    // blip they can retry; we don't want a false positive to lock them out.
    useStore.getState().setUser(null)

    // Sprint 11 B-AUTH-4 (2026-07-24): if the 401 was caused by a
    // deliberate logout, don't redirect to /login?expired=1. Two
    // signals feed this check:
    //   1. The Zustand justLoggedOut flag set by storeLogout().
    //   2. A `?logged_out=1` query param the SiteHeader adds when it
    //      navigates to '/'. This is the more reliable signal because
    //      the page navigation can race with the in-flight 401 chain
    //      (NotificationBell polling, AuthInitializer) and the new page
    //      has a fresh module instance.
    const justLoggedOut = useStore.getState().justLoggedOut
    const fromLogout = typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('logged_out') === '1'
    if (justLoggedOut || fromLogout) {
      return res
    }

    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?expired=1'
    }
    return res
  }

  // Retry the original request with the (newly minted) access cookie.
  return fetch(path, {
    ...options,
    credentials: 'include',
    skipAuthRefresh: true, // already retried; don't loop
  } as FetchOptions)
}

let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const r = await fetch(REFRESH_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
      })
      return r.ok
    } catch {
      return false
    } finally {
      // Release the lock on the next tick so concurrent requests can retry.
      setTimeout(() => { refreshPromise = null }, 0)
    }
  })()
  return refreshPromise
}