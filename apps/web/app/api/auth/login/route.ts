import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_PATH } from '@/lib/auth-cookies'
import { logger, serializeErr } from '@/lib/logger'
import { withRequest, withRequestIdHeader, getRequestId, jsonWithRequestId } from '@/lib/request-context'
import { captureApiError, readRequestId } from '@/lib/sentry-helpers'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { signTokenSync } from '@/lib/auth'
import { checkRateLimit, checkRateLimitByIdentifier } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { isEmail, normalizeEmail, normalizePhone } from '@/lib/auth-helpers'
import { parseJsonBody } from '@/lib/parse-json'
import { hashForAudit } from '@/lib/audit-hash'

// Defense against user-enumeration via response timing:
// On startup we hash a fixed string with bcrypt cost 12 so the dummy-hash path
// takes ~as long as a real compare. Module-level memoization — runs once per
// process. The hash itself is throwaway (we never check what it produces).
let DUMMY_HASH_PROMISE: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  if (!DUMMY_HASH_PROMISE) {
    DUMMY_HASH_PROMISE = bcrypt.hash('dummy-not-a-real-password', 12)
  }
  return DUMMY_HASH_PROMISE
}

export async function POST(req: NextRequest) {
  // Sprint 9 C.2: child logger with the request id, so every line emitted
  // by this handler shares the same correlation token. The id is also
  // echoed back on the response so the client (and a log aggregator) can
  // correlate browser + server logs for a single request.
  const log = withRequest(req, 'POST /api/auth/login')
  const ip = getClientIp(req)
  const { allowed, remaining, retryAfter } = await checkRateLimit(ip, 'login', 10, 15 * 60 * 1000)
  if (!allowed) {
    return jsonWithRequestId(req, 
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const parsed = await parseJsonBody<{ identifier?: string; password?: string }>(req)
    if (!parsed.ok) {
      return jsonWithRequestId(req, { error: parsed.error }, { status: 400 })
    }
    const { identifier, password } = parsed.body

    if (!identifier || !password) {
      return jsonWithRequestId(req, { error: 'Faltan credenciales' }, { status: 400 })
    }

    const id = identifier.trim()

    // S1-SEC-1 (audit 2026-07-22): per-account rate limit so an attacker who
    // rotates IPs (Tor, botnet, IPv6 prefix sweep) still can't brute-force
    // one specific account. 5 attempts / 15min per normalized identifier.
    // We always burn the bucket regardless of validity — otherwise an attacker
    // can probe by enumerating identifiers with low confidence.
    //
    // Tier 21: store the hash in rate_limit_attempts.identifier column so
    // the IP and identifier throttle dimensions are independent — see
    // lib/rate-limit.ts. Old rows that stuffed the email into the `ip`
    // column were migrated by sql/101.
    const accountKey = id.toLowerCase()
    const accountLimit = await checkRateLimitByIdentifier(
      req,
      accountKey,
      'login_account',
      5,
      15 * 60 * 1000
    )
    if (!accountLimit.allowed) {
      return jsonWithRequestId(req, 
        { error: 'Demasiados intentos para esta cuenta. Intenta más tarde.', retryAfter: accountLimit.retryAfter },
        { status: 429, headers: { 'Retry-After': String(accountLimit.retryAfter) } }
      )
    }

    // Detect whether the identifier is an email or a phone. The helper rules
    // are shared with /api/auth/register so users can log in with whichever
    // they registered with.
    let lookupColumn: 'email' | 'phone'
    let lookupValue: string

    if (isEmail(id)) {
      lookupColumn = 'email'
      const normalized = normalizeEmail(id)
      if (!normalized) {
        // Shouldn't happen given isEmail() passed, but be defensive.
        return jsonWithRequestId(req, { error: 'Credenciales inválidas' }, { status: 401 })
      }
      lookupValue = normalized
    } else {
      // Try to interpret as phone. If it doesn't even look like a phone,
      // return 401 (don't leak whether the format is wrong vs the user doesn't exist).
      const normalized = normalizePhone(id)
      if (!normalized) {
        return jsonWithRequestId(req, { error: 'Credenciales inválidas' }, { status: 401 })
      }
      lookupColumn = 'phone'
      lookupValue = normalized
    }

    // Lookup by either email or phone.
    // CRIT-13: branch on the column NAME explicitly instead of interpolating
    // `u.${lookupColumn}` into the SQL. The whitelist type guard makes the
    // current code safe, but a single mis-edit to widen the union type would
    // silently become a SQL injection vector. The explicit branches below are
    // static SQL — pg-parameterized only on the value side.
    let result
    if (lookupColumn === 'email') {
      result = await pool.query(
        `SELECT u.*, p.token_version FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.email = $1`,
        [lookupValue]
      )
    } else {
      result = await pool.query(
        `SELECT u.*, p.token_version FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.phone = $1`,
        [lookupValue]
      )
    }

    // Defense against user-enumeration via response timing:
    // if no row, still hash a dummy password so the request takes ~as long as a
    // real bcrypt compare (~250ms with cost 12). The error message stays the
    // same ("Credenciales inválidas") so neither path leaks which field is wrong.
    if (result.rows.length === 0) {
      await bcrypt.compare(password, await getDummyHash())
      // L5 (audit 2026-07-27): structured audit log so SIEM can spot
      // brute-force attempts by IP. The identifier is hashed (NOT logged
      // in clear) to avoid leaking which accounts attackers are probing.
      log.warn({
        event: 'login_failure',
        reason: 'unknown_identifier',
        identifierHash: hashForAudit(lookupValue),
        channel: lookupColumn,
        ip: getClientIp(req),
      }, 'login failure')
      return jsonWithRequestId(req, { error: 'Credenciales inválidas' }, { status: 401 })
    }

    const user = result.rows[0]

    if (!user.is_active) {
      // Same timing even for inactive users — hash to mask the deactivated branch.
      await bcrypt.compare(password, user.password_hash)
      // L5: deactivated accounts emit a separate audit tag so SIEM can
      // spot attempts to brute-force suspended users specifically.
      log.warn({
        event: 'login_failure',
        reason: 'account_inactive',
        userId: user.id,
        ip: getClientIp(req),
      }, 'login failure (account inactive)')
      return jsonWithRequestId(req, { error: 'Credenciales inválidas' }, { status: 401 })
    }

    const validPassword = await bcrypt.compare(password, user.password_hash)

    if (!validPassword) {
      // L5: wrong-password failure. Don't include the userId — at this
      // point the "user" is identified only by the hashed identifier.
      log.warn({
        event: 'login_failure',
        reason: 'wrong_password',
        identifierHash: hashForAudit(lookupValue),
        channel: lookupColumn,
        ip: getClientIp(req),
      }, 'login failure (wrong password)')
      return jsonWithRequestId(req, { error: 'Credenciales inválidas' }, { status: 401 })
    }

    // Access token (15 min) — used by middleware + API routes.
    // Refresh token (7 days) — used only by /api/auth/refresh.
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.token_version || 1,
    }
    const token = signTokenSync(tokenPayload, '15m')
    const refreshToken = signTokenSync(tokenPayload, '7d')

    // Token is set via httpOnly cookies only — never echo it in the body
    // (avoids leaking it to browser history, extensions, server logs).
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email || '',
        fullName: user.name,
        role: user.role,
        avatarUrl: '',
        phone: user.phone || '',
        cityId: user.city_id || '',
        // email_verified lives on the user row; the login route already
        // selected it earlier. Mirror it into the response so the
        // client-side store can render the verify banner without an
        // extra /api/auth/me round-trip.
        emailVerified: user.email_verified,
      }
    }, {
      // Auth responses must not be cached anywhere — a cached Set-Cookie
      // header can be replayed by a shared cache or browser back/forward.
      headers: { 'Cache-Control': 'no-store' },
    })

    const isProd = process.env.NODE_ENV === 'production'
    response.cookies.set('token', token, {
      httpOnly: true,
      // L1 (audit 2026-07-27): scope to /api/auth.
      path: AUTH_COOKIE_PATH,
      maxAge: 60 * 15, // 15 minutes — matches access token expiry
      // S3-SEC-3 (audit 2026-07-23): changed SameSite from 'lax' to 'strict'.
      // Lax allowed the auth cookies to ride along on top-level cross-site
      // GET navigations (e.g. clicking a phishing link in email that 302's
      // to barriotech.com.co). Strict drops the cookies on ANY
      // cross-site request, including GET. The tradeoff: if we add OAuth
      // (Google/Facebook) later, the OAuth callback POST won't include the
      // session cookie — we'd need to either downgrade the relevant cookies
      // to 'lax' temporarily, or use a separate 'csrf' cookie on the
      // callback URL. We have no OAuth today, so strict is the right call.
      // Defense in depth on top of the Origin/Referer CSRF check in
      // lib/csrf.ts (S3-SEC-4 below).
      sameSite: 'strict',
      secure: isProd,
    })
    response.cookies.set('refresh-token', refreshToken, {
      httpOnly: true,
      path: AUTH_COOKIE_PATH,
      maxAge: 60 * 60 * 24 * 7, // 7 days
      // S3-SEC-3 (audit 2026-07-23): changed SameSite from 'lax' to 'strict'.
      // Lax allowed the auth cookies to ride along on top-level cross-site
      // GET navigations (e.g. clicking a phishing link in email that 302's
      // to barriotech.com.co). Strict drops the cookies on ANY
      // cross-site request, including GET. The tradeoff: if we add OAuth
      // (Google/Facebook) later, the OAuth callback POST won't include the
      // session cookie — we'd need to either downgrade the relevant cookies
      // to 'lax' temporarily, or use a separate 'csrf' cookie on the
      // callback URL. We have no OAuth today, so strict is the right call.
      // Defense in depth on top of the Origin/Referer CSRF check in
      // lib/csrf.ts (S3-SEC-4 below).
      sameSite: 'strict',
      secure: isProd,
    })

    log.info({ userId: user.id, role: user.role }, 'login success')

    // L6 (audit 2026-07-27): bump last_login_at on every successful
    // authentication. Best-effort fire-and-forget style — a transient
    // DB error here must not break login itself. The audit value is
    // already captured by the success log line above.
    void pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    ).catch((err) => log.warn(serializeErr(err), 'last_login_at update failed'))

    // Sprint 9 C.2: echo the request id so the client can correlate logs.
    return withRequestIdHeader(response, getRequestId(req))
  } catch (err) {
    // Sprint 10 C.3: forward to Sentry with full context. captureApiError
    // is a no-op when SENTRY_DSN isn't set, so dev/test are unaffected.
    // The `await` ensures the event is queued before we return 500.
    await captureApiError(err, {
      route: 'POST /api/auth/login',
      requestId: readRequestId(req),
      userId: null, // we don't have the user — login failed
      body: null, // never log passwords
    })
    log.error({ err: serializeErr(err) }, 'Login error:')
    const errRes = NextResponse.json({ error: 'Error interno' }, { status: 500 })
    return withRequestIdHeader(errRes, getRequestId(req))
  }
}