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
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      // Tolerate up to 5s of clock drift between the issuer (PM2 process)
      // and the verifier. Caddy/PM2/NTP usually stay within 1s, but a
      // 5s cushion prevents a stray "Token inválido" at the boundary.
      clockTolerance: 5,
    })
    return payload as unknown as TokenPayload
  } catch {
    if (previousKey) {
      try {
        const { payload } = await jwtVerify(token, previousKey, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          clockTolerance: 5,
        })
        return payload as unknown as TokenPayload
      } catch {
        return null
      }
    }
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