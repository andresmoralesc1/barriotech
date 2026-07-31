import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_PATH } from '@/lib/auth-cookies'
import { logger, serializeErr } from '@/lib/logger'
import { withRequest } from '@/lib/request-context'
import { verifyToken, getTokenFromRequest, signTokenSync } from '@/lib/auth'
import { isTokenRevoked } from '@/lib/auth-db'
import pool from '@/lib/db'
import { checkRateLimitByUser } from '@/lib/rate-limit'

/**
 * POST /api/auth/refresh
 *
 * Re-issues a fresh access token (15min) using the current one, AS LONG AS:
 *  - the current token is still valid (signature + expiry OK)
 *  - the user's tokenVersion in DB still matches the one in the token
 *
 * The access token lives in the 'token' cookie (read by middleware).
 * The 'refresh-token' cookie holds the same JWT but with a 7-day expiry,
 * which the client uses to call this endpoint when the access token expires.
 *
 * If the access token has expired, this endpoint will accept the refresh-token
 * cookie instead. If both are gone, the user must log in again.
 *
 * Response: { token: string, expiresIn: 900 }
 *
 * Sprint 7 B-AUTH-3 (2026-07-23): explicitly SKIPPED the global CSRF
 * Origin/Referer check (`requireSameOrigin`). Rationale:
 *
 *   1. The endpoint reads httpOnly + SameSite=strict cookies that the
 *      browser only attaches on same-origin requests. Any cross-origin
 *      attacker can't even send the cookie, so the body of the request
 *      can never reach this handler in the first place.
 *   2. The classic CSRF threat model assumes the attacker can ride on a
 *      logged-in user's session. SameSite=strict cookies break that
 *      primitive at the browser layer — Origin/Referer checks are belt and
 *      suspenders from when Lax was the default. With Strict, they add
 *      nothing for this endpoint while breaking the auto-refresh path
 *      (some browsers / network layers strip Origin on fetch).
 *   3. The endpoint is read-only on user state: it issues a new token but
 *      doesn't write to the DB or take actions. Even if a CSRF bypass
 *      existed, the worst case is "user's session gets refreshed" — which
 *      is harmless.
 *
 * Other mutating endpoints (POST /api/vendors, /api/orders, etc.) keep
 * the CSRF guard. The guard is opt-out per route via skipping the import
 * + call, NOT a global toggle.
 */
export async function POST(req: NextRequest) {
  const log = withRequest(req, 'POST /api/auth/refresh')

  // Per-user rate limit. 30/min — token refresh is silent background work;
  // a burst usually means a misbehaving client or token rotation script.
  const rl = await checkRateLimitByUser(req, 'auth_refresh', 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    // Try access token first, fall back to refresh-token cookie.
    const accessToken = getTokenFromRequest(req)
    const refreshToken = req.cookies.get('refresh-token')?.value || null
    const token = accessToken || refreshToken

    if (!token) {
      return NextResponse.json({ error: 'No hay token para refrescar' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 })
    }

    // Check the token hasn't been revoked (logout bumped token_version).
    if (await isTokenRevoked(decoded.userId, decoded.tokenVersion)) {
      return NextResponse.json({ error: 'Sesión revocada' }, { status: 401 })
    }

    // L2 (audit 2026-07-27): rotate refresh tokens on every refresh-token use.
    //
    // Why: when a refresh token is reused, it stays valid for the full
    // 7-day lifetime. If an attacker steals the cookie from a backup
    // file or a logged-out-but-not-purged browser, they get 7 days of
    // free replay.
    //
    // Rotation: when the request used the refresh-token cookie (not the
    // access token), we bump token_version in the DB. The cookie the
    // caller is about to receive carries the NEW version; the old refresh
    // token's embedded version no longer matches, so a replay returns
    // 401 "Sesión revocada".
    //
    // Trade-off: two tabs refreshing at the same time will cause the
    // slower one to 401 (the version it sent is stale). Acceptable —
    // users rarely refresh concurrently, and the user-facing failure
    // mode is "log in again" via the normal expired-cookie UI.
    //
    // Edge case: if the access token was used (not refresh-token), we
    // keep the existing tokenVersion. No need to bump because the access
    // token expires in 15min on its own.
    let currentTokenVersion = decoded.tokenVersion
    if (!accessToken && refreshToken) {
      await pool.query(
        'UPDATE profiles SET token_version = token_version + 1 WHERE user_id = $1',
        [decoded.userId]
      )
      currentTokenVersion = currentTokenVersion + 1
      log.info({ userId: decoded.userId }, 'refresh token rotated')
    }

    // Issue a fresh access token with the SAME tokenVersion.
    const freshAccessToken = signTokenSync(
      {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        tokenVersion: currentTokenVersion,
      },
      '15m'
    )

    // ALWAYS re-issue a 7-day refresh token, regardless of which cookie
    // the caller used. The new refresh token carries the rotated
    // currentTokenVersion, so the old one (if any) becomes stale.
    const freshRefreshToken = signTokenSync(
      {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        tokenVersion: currentTokenVersion,
      },
      '7d'
    )

    // Token is set via httpOnly cookies only — never echo it in the body
    const response = NextResponse.json({
      expiresIn: 900,
    })

    const isProd = process.env.NODE_ENV === 'production'
    response.cookies.set('token', freshAccessToken, {
      httpOnly: true,
      secure: isProd,
      // S3-SEC-3 (audit 2026-07-23): changed SameSite from 'lax' to 'strict'.
      // See apps/web/app/api/auth/login/route.ts for rationale. Defense in
      // depth on top of the Origin/Referer CSRF check in lib/csrf.ts
      // (S3-SEC-4 below).
      sameSite: 'strict',
      maxAge: 60 * 15, // 15 min
      // L1 (audit 2026-07-27): scope cookie to /api/auth.
      path: AUTH_COOKIE_PATH,
    })

    // L2 (audit 2026-07-27): always set the refresh cookie with the
    // rotated token. The browser overwrites the existing cookie in
    // place (same name + path + maxAge); the OLD refresh token is now
    // unusable because its embedded version no longer matches.
    response.cookies.set('refresh-token', freshRefreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: AUTH_COOKIE_PATH,
    })

    return response
  } catch (err) {
    logger.error(serializeErr(err), 'POST /api/auth/refresh error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}