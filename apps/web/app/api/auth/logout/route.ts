import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'
import { AUTH_COOKIE_PATH } from '@/lib/auth-cookies'

function clearCookies(response: NextResponse) {
  const isProd = process.env.NODE_ENV === 'production'
  response.cookies.set('__Host-token', '', {
    httpOnly: true,
    // L1 (audit 2026-07-27): must match the issuing path. With
    // AUTH_COOKIE_PATH = '/', the cookie set by /login lives at '/'.
    // Clearing at '/' removes it; a different path would leave a stale
    // cookie under a different name in the browser jar (the browser
    // treats different paths as distinct cookies with the same name).
    path: AUTH_COOKIE_PATH,
    maxAge: 0,
    sameSite: 'strict', // S3-SEC-3 (audit 2026-07-23)
    secure: isProd,
  })
  response.cookies.set('__Host-refresh-token', '', {
    httpOnly: true,
    path: AUTH_COOKIE_PATH,
    maxAge: 0,
    sameSite: 'strict',
    secure: isProd,
  })
}

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Per-user rate limit. 10/min — bursty but bounded.
  const rl = await checkRateLimitByUser(req, 'auth_logout', 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
  try {
    const token = req.cookies.get('token')?.value

    // No token — nothing to revoke
    if (!token) {
      const response = NextResponse.json({ success: true })
      clearCookies(response)
      return response
    }

    const decoded = await verifyToken(token)

    // Invalid/expired token — just clear the cookie
    if (!decoded) {
      const response = NextResponse.json({ success: true })
      clearCookies(response)
      return response
    }

    // Revoke: increment token_version so existing tokens become invalid
    await pool.query(
      'UPDATE profiles SET token_version = token_version + 1 WHERE user_id = $1',
      [decoded.userId]
    )

    const response = NextResponse.json({ success: true })
    clearCookies(response)
    return response
  } catch (err) {
    logger.error(serializeErr(err), 'Logout error:')
    const response = NextResponse.json({ success: true })
    clearCookies(response)
    return response
  }
}
