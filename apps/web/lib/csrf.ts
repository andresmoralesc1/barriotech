/**
 * CSRF defense via Origin / Referer header check (S3-SEC-4).
 *
 * Browsers automatically include `Origin` on cross-origin POST/PATCH/DELETE
 * requests (and `Referer` as a fallback when Origin is missing, e.g. in some
 * Same-Origin POSTs). For state-mutating endpoints we verify the Origin
 * matches the configured app origin. This blocks classic CSRF attacks where
 * a malicious site submits a hidden form or fetch to our API on behalf of a
 * logged-in user.
 *
 * This is defense in depth on top of:
 *   1. `SameSite=strict` on auth cookies (S3-SEC-3) — modern browsers drop
 *      cookies on cross-site requests entirely. Older browsers and some
 *      iframe-included requests still leak cookies.
 *   2. The cookies themselves are `httpOnly` and our auth model is bearer-
 *      token in cookie (not Authorization header), so the tokens are sent.
 *
 * Why not a CSRF token? Inertia + Next.js means every React state-mutating
 * call is a fetch from the same JavaScript context — generating a per-tab
 * token would require reading it from a cookie on every render. The Origin
 * check is simpler, equally effective for state-mutating endpoints, and
 * doesn't break idempotency (GET requests are unaffected).
 *
 * Operating modes (`CSRF_ALLOW_MISSING_ORIGIN`):
 *   - unset / "0" (default for production): require Origin OR Referer
 *     matching getAppOrigin(). Reject cross-origin and missing-origin.
 *   - "1" (set in .env.test): allow missing-origin, but still reject
 *     cross-origin. Use this only in test/CI environments.
 *
 * Edge cases:
 *   - For `unsafe` methods (GET/HEAD/OPTIONS) the function returns null.
 *   - For methods that need the body (POST/PUT/PATCH) we short-circuit
 *     BEFORE reading the body — attackers can't waste CPU.
 */
import { NextResponse } from 'next/server'

/**
 * Canonical app origin from environment. Must NOT have a trailing slash.
 * Order of preference:
 *   1. APP_ORIGIN (operational env, what we set in Caddy vhost `Host` match)
 *   2. NEXT_PUBLIC_APP_URL (client-visible, also trusted server-side)
 *   3. NEXTAUTH_URL (legacy NextAuth convention)
 *   4. localhost default (dev only)
 */
let cachedOrigin: string | null = null

export function getAppOrigin(): string {
  if (cachedOrigin) return cachedOrigin

  const fromEnv = (
    process.env.APP_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    ''
  ).replace(/\/+$/, '')

  if (fromEnv) {
    cachedOrigin = fromEnv
    return cachedOrigin
  }

  // In production we'd rather fail loudly than guess. In dev/test the
  // 127.0.0.1:3005 default matches what `next start` uses locally.
  //
  // S3-SEC-4: returning an empty string would silently pass every
  // cross-origin request as "same-origin". That's worse than failing. So
  // we throw ONLY in production, and ONLY on the first call (cached after
  // that). The throw becomes a 500, which is loud and surfaces the
  // misconfiguration immediately during deploy.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[CSRF] No APP_ORIGIN configured. Set APP_ORIGIN=https://barriotech.com.co in prod.',
    )
  }
  // Dev/test fallback, intentionally permissive to match `next start` default.
  cachedOrigin = 'http://127.0.0.1:3005'
  return cachedOrigin
}

/** Methods that mutate state. GET/HEAD/OPTIONS bypass the check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'] as const)

type Result = NextResponse | null

/**
 * Returns null if the request passes, or a 403 NextResponse if it must be
 * rejected. Use as the FIRST line of any mutating route handler:
 *
 *   export async function POST(req: NextRequest) {
 *     const csrf = requireSameOrigin(req); if (csrf) return csrf
 *     ...
 *   }
 *
 * Why first? Reading the body can be expensive; rejecting a cross-origin
 * attacker ASAP saves CPU and prevents body-parser noise in logs.
 */
export function requireSameOrigin(req: Request): Result {
  const method = req.method.toUpperCase()
  if (SAFE_METHODS.has(method as 'GET' | 'HEAD' | 'OPTIONS')) return null

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const candidate = origin ?? (referer ? safeOriginFromReferer(referer) : null)

  // Cross-origin present? Reject outright.
  if (candidate && candidate !== getAppOrigin()) {
    return NextResponse.json(
      { error: 'CSRF: cross-origin request blocked' },
      { status: 403 },
    )
  }

  // No Origin / Referer at all.
  if (!candidate) {
    const allowMissing =
      process.env.CSRF_ALLOW_MISSING_ORIGIN === '1' ||
      process.env.CSRF_ALLOW_MISSING_ORIGIN === 'true'

    if (allowMissing) {
      return null // test/CI: allow
    }

    // Production: require at least a Referer to confirm same-origin intent.
    return NextResponse.json(
      { error: 'CSRF: missing Origin and Referer headers' },
      { status: 403 },
    )
  }

  return null
}

/**
 * Strip query string and hash from a Referer URL to get the bare origin.
 * Returns null if the Referer is malformed (defensive — never throw here,
 * because this runs in the hot path of every mutating request).
 */
function safeOriginFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}
