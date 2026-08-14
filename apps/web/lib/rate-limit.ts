/**
 * Persistent rate limiter — supports IP, user, and pre-auth identifier keys.
 *
 * Three independent throttle dimensions live in `rate_limit_attempts`:
 *
 *   - ip column      — bucket IP-only (used for unauthenticated traffic where
 *                      there's no account/identity to track — public endpoints,
 *                      anonymous browsing, etc.)
 *
 *   - user_id column — bucket the authenticated user. Solves the NAT problem:
 *                      users behind a corporate VPN / university Wi-Fi / CGNAT
 *                      of mobile carriers no longer share each other's bucket.
 *
 *   - identifier     — bucket a normalized lowercased email/phone hash. Used
 *                      by pre-auth endpoints (login, register, forgot-password)
 *                      so an attacker who rotates IPs (Tor, botnet, IPv6 sweep)
 *                      still can't brute-force one specific account.
 *
 * Exactly one of the three columns is populated per row (enforced by the
 * `rate_limit_attempts_keyed_by_one` CHECK constraint).
 *
 * Tier 21 introduced user_id + identifier columns to replace the old approach
 * of stuffing an email into the ip column (which still appears in older rows
 * but is now deprecated; only `login_account` was migrated, see migration
 * 101_rate_limit_ip_nullable.sql).
 *
 * Usage:
 *   // Per-IP (legacy, still correct for anonymous endpoints)
 *   const { allowed } = await checkRateLimit(ip, 'login', 10, 15 * 60 * 1000)
 *
 *   // Per-user (recommended for authenticated endpoints)
 *   const { allowed } = await checkRateLimitByUser(req, 'admin_orders', 30, 60_000)
 *
 *   // Per-identifier — used by the auth flows themselves
 *   const { allowed } = await checkRateLimitByIdentifier(req, body.email, 'login_account', 5, 15 * 60 * 1000)
 */

import pool from './db'
import { getClientIp } from './trusted-ip'
import { createHash } from 'crypto'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter?: number
}

/**
 * Convenience wrapper that resolves the client IP from a NextRequest
 * (using the trusted-proxy logic) and then calls checkRateLimit.
 * Callers that already have a string IP can still call checkRateLimit
 * directly with the `ip` argument.
 */
export async function checkRateLimitFromRequest(
  req: { headers: Headers },
  bucket: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return checkRateLimit(getClientIp(req as any), bucket, maxAttempts, windowMs)
}

/**
 * Pure IP-based throttle. Use only for endpoints where there's no
 * authenticated identity (anonymous browsing, public map tiles, etc.).
 * For most authenticated endpoints prefer checkRateLimitByUser.
 */
export async function checkRateLimit(
  ip: string,
  bucket: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  return _checkOne({ ip, bucket, maxAttempts, windowMs })
}

/**
 * Per-user rate limit. Resolves the authenticated user from the request's
 * auth cookies and throttles by user_id; falls back to IP if the cookie is
 * missing/invalid (anonymous traffic).
 *
 * This is the recommended replacement for the old IP-based check on every
 * authenticated route — it isolates each user so a single bad actor doesn't
 * poison the bucket for everyone behind the same NAT.
 */
export async function checkRateLimitByUser(
  req: { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } },
  bucket: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const ip = getClientIp(req as any)
  const userId = extractUserIdFromCookie(req)
  if (userId) {
    return _checkOne({ userId, bucket, maxAttempts, windowMs })
  }
  // Anonymous / unauthenticated — keep using IP. Callers who only want to
  // throttle authenticated users should pass maxAttempts=0 here.
  return _checkOne({ ip, bucket, maxAttempts, windowMs })
}

/**
 * Per-identifier rate limit. The caller (typically a login / register /
 * forgot-password handler) already knows the email or phone that's about
 * to be used, and we don't want to base the bucket solely on IP because
 * an attacker can rotate IPs to brute-force a known account.
 *
 * The identifier is hashed (SHA-256, lowercase) before storage so logs
 * and DB queries never see the raw email/phone.
 */
export async function checkRateLimitByIdentifier(
  req: { headers: Headers },
  identifier: string,
  bucket: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!identifier || typeof identifier !== 'string') {
    // Defensive: refuse to proceed without a key. Callers should treat
    // this as "skip the throttle" — the regular validation downstream
    // will reject the request anyway.
    return { allowed: true, remaining: maxAttempts }
  }
  const idHash = hashIdentifier(identifier)
  return _checkOne({ identifier: idHash, bucket, maxAttempts, windowMs })
}

// ---------------------------------------------------------------------------

interface CheckSpec {
  ip?:         string
  userId?:     string
  identifier?: string
  bucket:      string
  maxAttempts: number
  windowMs:    number
}

async function _checkOne(spec: CheckSpec): Promise<RateLimitResult> {
  const { bucket, maxAttempts, windowMs } = spec
  const since = new Date(Date.now() - windowMs)
  const keyValue = spec.userId ?? spec.identifier ?? spec.ip
  if (!keyValue) {
    throw new Error('checkRateLimit: no key provided (need ip, userId, or identifier)')
  }
  const insertColumn: 'ip' | 'user_id' | 'identifier' =
    spec.userId     ? 'user_id'    :
    spec.identifier ? 'identifier' :
                      'ip'

  // CRIT-9 + audit 2026-08-14: short statement timeout so a stuck rate-limit
  // query can't hold a pool connection. Pool-level statement_timeout
  // (configured in lib/db.ts) is enforced by Postgres for every query
  // on every connection — unlike SET LOCAL which had no effect across
  // pool.query() boundaries (different implicit txn, possibly different
  // connection). 5s in db.ts is generous for COUNT + a single index
  // lookup and short enough to fail fast on a stuck DB.
  //
  // Always three positional params: $1 = key, $2 = bucket, $3 = since.
  // Static SQL, no string interpolation of user-controlled values.
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM rate_limit_attempts
      WHERE ${insertColumn} = $1
        AND bucket         = $2
        AND attempted_at  >= $3`,
    [keyValue, bucket, since]
  )
  const count: number = countResult.rows[0].count

  if (count >= maxAttempts) {
    const oldest = await pool.query(
      `SELECT attempted_at FROM rate_limit_attempts
        WHERE ${insertColumn} = $1
          AND bucket         = $2
          AND attempted_at  >= $3
        ORDER BY attempted_at ASC LIMIT 1`,
      [keyValue, bucket, since]
    )
    const retryAfter = oldest.rows.length
      ? Math.ceil((oldest.rows[0].attempted_at.getTime() + windowMs - Date.now()) / 1000)
      : Math.ceil(windowMs / 1000)
    return { allowed: false, remaining: 0, retryAfter }
  }

  await pool.query(
    `INSERT INTO rate_limit_attempts (${insertColumn}, bucket)
     VALUES ($1, $2)`,
    [keyValue, bucket]
  )

  return { allowed: true, remaining: maxAttempts - count - 1 }
}

// ---------------------------------------------------------------------------

/**
 * Decode the user id out of the JWT cookie without verifying the signature.
 *
 * We only need the `sub` (user id) to look the user up — the actual auth
 * check happens later in the route handler. A bad/expired token simply
 * returns null here and the caller falls back to the IP-based path.
 *
 * We use Buffer.from(..., 'base64url') rather than JSON.parse-atob so a
 * malformed payload that passes the URL-safe check still falls back to
 * returning null instead of throwing.
 */
function extractUserIdFromCookie(req: {
  headers: Headers
  cookies?: { get(name: string): { value: string } | undefined }
}): string | null {
  try {
    const tokenCookie = req.cookies?.get?.('token')
    if (!tokenCookie?.value) return null
    const parts = tokenCookie.value.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const obj = JSON.parse(json)
    return typeof obj.sub === 'string' ? obj.sub : null
  } catch {
    return null
  }
}

/**
 * Normalize + hash an identifier for storage. Email/phone go through the
 * same canonicalization that the auth helpers use, then SHA-256 hex. The
 * `audit_hash` table holds the same shape (see lib/audit-hash.ts) — we
 * intentionally use an independent hash for rate-limiting identifiers so
 * that a leaked rate-limit log doesn't double as an account-discovery
 * oracle.
 */
function hashIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase()
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Periodic cleanup — call from a cron job or invoke manually.
 * Removes attempts older than 1 day (anything older is irrelevant for 15-minute
 * sliding windows). Tier 19 added 24h retention; longer windows (e.g. 7 days
 * for bulk admin exports) would need to bump this up.
 */
export async function cleanupRateLimits() {
  await pool.query(
    "DELETE FROM rate_limit_attempts WHERE attempted_at < NOW() - INTERVAL '1 day'"
  )
}
