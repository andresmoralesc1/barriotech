/**
 * Auth helpers — for use in Node.js API routes only.
 *
 * Do NOT import this from middleware.ts (edge runtime).
 * Edge-safe helpers live in lib/auth-edge.ts.
 */

import { jwtVerify } from 'jose'
import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'
import type { TokenPayload } from './auth-edge'
import { isTokenRevoked } from './auth-db'
import pool from './db'

export type { TokenPayload } from './auth-edge'

// Re-export edge-safe helpers so API routes can import everything from one place
export { getTokenFromRequest } from './auth-edge'

const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW) {
  throw new Error('JWT_SECRET environment variable is required. Generate one with: openssl rand -base64 64')
}
const JWT_SECRET: string = JWT_SECRET_RAW
const JWT_SECRET_PREVIOUS: string = process.env.JWT_SECRET_PREVIOUS || ''

const secretKey = new TextEncoder().encode(JWT_SECRET)
const previousKey = JWT_SECRET_PREVIOUS ? new TextEncoder().encode(JWT_SECRET_PREVIOUS) : null

// CRIT-14: pin issuer + audience so tokens minted by another app using the same
// secret (or a stolen token replayed across environments) can't pass verification.
const JWT_ISSUER = 'barriotech.gps'
const JWT_AUDIENCE = 'barriotech.gps.api'

/**
 * Node-runtime token verification. Returns null on failure.
 * Wraps jose's jwtVerify (async) but exposes sync-style via result.
 *
 * CRIT-14: also enforces issuer + audience match so tokens minted with the
 * same secret but for a different app/environment are rejected.
 *
 * NOTE: This is a pure cryptographic check — it does NOT verify revocation.
 * For revocation-aware checks use requireAuth() below.
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const checked = await verifyTokenWithIatCheck(token, secretKey)
  if (checked) return checked
  if (previousKey) {
    return verifyTokenWithIatCheck(token, previousKey)
  }
  return null
}

/**
 * Verify a JWT AND enforce iat ≤ now + tolerance.
 *
 * L9 (audit 2026-07-27): defense against "iat in the future" tokens.
 * If a server's clock is skewed or an attacker mints a token with
 * iat = now() + 24h, the token would otherwise be considered
 * valid for 24h+15min instead of just 15min from the moment it was
 * actually minted. With this guard, any token whose iat is more than
 * `maxIatSkewSec` seconds ahead of the verifier's clock is rejected.
 *
 * The check is wrapped around jwtVerify so future-clock tokens never
 * reach the application payload. clockTolerance (5s above) handles
 * backward skew on the same clock; this guard handles forward skew.
 */
async function verifyTokenWithIatCheck(
  token: string,
  key: Uint8Array
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      // Tolerate up to 5s of clock drift between the issuer (PM2 process)
      // and the verifier. Caddy/PM2/NTP usually stay within 1s, but a
      // 5s cushion prevents a stray "Token inválido" at the boundary.
      clockTolerance: 5,
    })
    // Reject iat drift larger than the clockTolerance window. Use 30s
    // so we don't punish legitimate 5-10s drift at the boundary while
    // still catching 1h+ fakes.
    const nowSec = Math.floor(Date.now() / 1000)
    const maxIatSkewSec = 30
    const iat = (payload as { iat?: number }).iat
    if (typeof iat === 'number' && iat - nowSec > maxIatSkewSec) {
      return null
    }
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
}

/**
 * Synchronous HS256 signer (jsonwebtoken). Issues a token compatible with the
 * existing fleet of tokens already in cookies — same algorithm, same secret.
 *
 * CRIT-14: stamps issuer + audience so verification on the receiving side can
 * confirm the token was minted by this app.
 */
export function signTokenSync(
  payload: Omit<TokenPayload, 'iat' | 'exp'>,
  expiresIn: string | number = '15m'
): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  } as jwt.SignOptions)
}

/**
 * Single source of truth for authenticated API routes.
 *
 * Returns the verified, non-revoked TokenPayload on success.
 * Returns a NextResponse (401) on any failure so callers can:
 *   const auth = await requireAuth(req)
 *   if (auth instanceof NextResponse) return auth
 *   // auth.userId / auth.role are available here
 *
 * Performs ALL of the following in order:
 *   1. Extract token from Authorization header or 'token' cookie
 *   2. Cryptographically verify signature (HS256, current or previous secret)
 *   3. Check that the token has not been revoked by logout/admin action
 *      (compares token_version against profiles.token_version)
 *
 * Pass `{ skipRevocationCheck: true }` for routes that must run BEFORE the
 * user is authenticated (e.g. login, refresh, register) or for routes whose
 * DB call is already an implicit auth check (e.g. /api/account with the
 * correct user_id in the body). Default is to check revocation.
 */
import { NextResponse } from 'next/server'
export interface RequireAuthOptions {
  /**
   * Skip the profiles.token_version check. Use only for:
   *   - Login / register / refresh (user isn't authenticated yet)
   *   - Webhooks that arrive with their own signature
   *   - Routes where the next line is `WHERE user_id = $1` and the DB
   *     acts as the access control (any mismatch returns empty row).
   */
  skipRevocationCheck?: boolean
}

export async function requireAuth(
  req: NextRequest,
  options: RequireAuthOptions = {}
): Promise<TokenPayload | NextResponse> {
  const { getTokenFromRequest } = await import('./auth-edge')
  const token = getTokenFromRequest(req)
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const decoded = await verifyToken(token)
  if (!decoded) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
  }
  if (!options.skipRevocationCheck) {
    const tokenVersion = (decoded as any).tokenVersion ?? (decoded as any).token_version
    if (typeof tokenVersion === 'number') {
      const revoked = await isTokenRevoked(decoded.userId, tokenVersion)
      if (revoked) {
        return NextResponse.json({ error: 'Sesión revocada' }, { status: 401 })
      }
    }
  }
  return decoded
}

/**
 * requireVerifiedEmail(req) — auth + email_verified check.
 *
 * P1-1 (audit 2026-07-27): the EmailVerifyBanner promises "Verifica tu
 * email para crear tu puesto, dejar reseñas y contactar vendedores", but
 * before this fix NOTHING enforced that promise — a freshly registered
 * user could publish products, post reviews, send contact messages, and
 * claim sponsorships all while the banner sat there telling them to
 * verify. The banner copy was a lie.
 *
 * Now every mutating endpoint that "creates content" (vendor profile,
 * products, photos, reviews, contact, sponsorships, favorites) goes
 * through this helper. If the user is authenticated but hasn't verified
 * their email, we return 403 with a copy that the frontend can pair with
 * a "Resend verification" CTA.
 *
 * Endpoints that should NOT use this helper (they must work even for
 * unverified users):
 *   - GET /api/auth/me (used to populate the banner itself)
 *   - GET /api/notifications, /api/orders, /api/favorites — reading
 *     existing state is fine; only CREATING new state needs verification.
 *   - DELETE /api/account — destructive on own data, no need to gate.
 *   - /api/auth/* (login/logout/refresh/verify-email/resend-verification).
 *
 * Implementation note: a single SELECT for `email_verified` adds one DB
 * round-trip per mutating request. We accept that cost (cheap, indexed
 * PK lookup) for the contract clarity. Future optimization: stuff
 * `email_verified` into the JWT payload so the check is local — but
 * then a logout/revoke path that toggles email_verified invalidates
 * tokens, which is a much bigger refactor. Not worth it today.
 */
export interface VerifiedUser {
  userId: string
  role: 'buyer' | 'seller' | 'admin'
  emailVerified: true
}

export async function requireVerifiedEmail(
  req: NextRequest
): Promise<VerifiedUser | NextResponse> {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const result = await pool.query(
    'SELECT email_verified FROM users WHERE id = $1',
    [auth.userId]
  )
  if (result.rows.length === 0 || !result.rows[0].email_verified) {
    return NextResponse.json(
      {
        error: 'Verifica tu email para usar esta función',
        requiresEmailVerification: true,
      },
      { status: 403 }
    )
  }
  return {
    userId: auth.userId,
    role: auth.role as 'buyer' | 'seller' | 'admin',
    emailVerified: true,
  }
}

/**
 * requireAdmin — gates /api/admin/* endpoints.
 *
 * Admins are users with role='admin' (set via migration 027 + manual
 * promotion script, NEVER via self-registration). The register endpoint
 * rejects role='admin' on POST.
 *
 * Email verification is intentionally NOT required — admins are
 * trusted operators, and the field agent who got promoted might not
 * have a verified email yet. The JWT itself is the trust anchor.
 */
export interface AdminUser {
  userId: string
  role: 'admin'
}

export async function requireAdmin(
  req: NextRequest
): Promise<AdminUser | NextResponse> {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  if (auth.role !== 'admin') {
    // Don't disclose whether the role exists vs. the user not being
    // authenticated — same 403 either way to prevent role enumeration.
    return NextResponse.json(
      { error: 'Acceso restringido a administradores' },
      { status: 403 }
    )
  }
  return { userId: auth.userId, role: 'admin' }
}