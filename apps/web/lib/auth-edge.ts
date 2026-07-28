/**
 * Edge-safe auth helpers — safe to import from middleware (edge runtime).
 *
 * Does NOT import jsonwebtoken (Node-only).
 * Use lib/auth-sign.ts for the sync HS256 signer if you need to issue tokens.
 */

import { jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'

export interface TokenPayload {
  userId: string
  email?: string
  role: 'buyer' | 'seller' | 'admin'
  tokenVersion: number
}

// Don't throw at module load — the middleware runs in edge runtime where
// process.env may not be fully populated at import time. We instead lazily
// resolve the secret on first use, and surface a clear error if it's missing
// (so misconfigured deploys fail fast instead of returning 0-byte responses).
function getSecretKey(): Uint8Array | null {
  const raw = process.env.JWT_SECRET
  if (!raw) return null
  return new TextEncoder().encode(raw)
}
function getPreviousKey(): Uint8Array | null {
  const raw = process.env.JWT_SECRET_PREVIOUS || ''
  if (!raw) return null
  return new TextEncoder().encode(raw)
}

const secretKey = getSecretKey()
const previousKey = getPreviousKey()

// CRIT-14: pin issuer + audience so tokens minted by another app using the same
// secret (or a stolen token replayed across environments) can't pass verification.
// Must stay in sync with lib/auth.ts (issuer/audience literals) so middleware
// and API routes agree on which tokens to accept.
const JWT_ISSUER = 'barriotech.gps'
const JWT_AUDIENCE = 'barriotech.gps.api'

/**
 * Edge-safe token verification (used by middleware).
 * Returns null on any failure (invalid signature, wrong iss/aud, expired, revoked).
 *
 * NOTE: this is signature + iss/aud/exp only. The middleware path has no DB
 * access; the per-profile revocation check happens in `requireAuth` (Node).
 */
export async function verifyTokenEdge(token: string): Promise<TokenPayload | null> {
  if (!secretKey) return null
  const checked = await verifyTokenWithIatCheck(token, secretKey)
  if (checked) return checked
  if (previousKey) {
    return verifyTokenWithIatCheck(token, previousKey)
  }
  return null
}

/**
 * L9 (audit 2026-07-27): extract of verifyTokenWithIatCheck — shared with
 * lib/auth.ts so middleware and API routes reject iat-skewed tokens
 * with the same threshold.
 */
async function verifyTokenWithIatCheck(
  token: string,
  key: Uint8Array
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      // Mirror lib/auth.ts so middleware and API routes agree on the
      // tolerable clock drift. Anything tighter than 5s risks false
      // rejections at the 15-min token boundary.
      clockTolerance: 5,
    })
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
 * Extract token from request headers (Authorization: Bearer ...) or cookie ('token').
 * Works in both edge and node runtime.
 */
export function getTokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return req.cookies.get('token')?.value || null
}