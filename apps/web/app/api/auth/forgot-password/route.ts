import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { checkRateLimit, checkRateLimitByIdentifier } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { sendPasswordResetEmail, hashToken } from '@/lib/email'
import { randomBytes, createHash } from 'crypto'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'

// Audit 2026-08-13 (batch 1): short hash used in error logs instead of raw
// email — same privacy pattern as login/route.ts. Lets ops correlate by
// identifier without PII in logs.
function hashForAudit(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('base64').slice(0, 12)
}

/**
 * POST /api/auth/forgot-password
 *
 * Body: { email }
 *
 * Always returns 200 with the same generic message — does NOT reveal whether
 * the email exists (prevents user-enumeration via this endpoint).
 *
 * S1-AUTH-1 (audit 2026-07-22): token is now persisted in
 * `password_reset_tokens` with its SHA-256 hash (same pattern as
 * email_verification_tokens). Previously this signed a stateless JWT
 * with purpose='password_reset' — that JWT could be replayed for 1h
 * from any email-log capture. The new flow mints a random token,
 * stores its hash, returns the plaintext only in the email, and marks
 * used_at on consumption.
 */
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const ip = getClientIp(req)

  // Rate limit tighter than login: forgot-password emails are a phishing vector.
  // 5 requests per IP per hour is enough for legitimate use, blocks abuse.
  const { allowed, retryAfter } = await checkRateLimit(ip, 'forgot_password', 5, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const parsed = await parseJsonBody<{ email?: unknown }>(req)
    const email = parsed.ok ? parsed.body.email : undefined
    if (!email || typeof email !== 'string') {
      // Generic OK even on bad input — don't leak whether we expect an email.
      return NextResponse.json({
        message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña.',
      })
    }

    // CRIT-6: per-email rate limit prevents targeting a single victim with a
    // burst of resets (e.g. bombarding one address from rotating IPs).
    // Normalize to lowercase so case variation doesn't bypass.
    //
    // Tier 21: use the identifier column instead of stuffing the email into
    // the `ip` column of rate_limit_attempts. Same semantics, cleaner schema,
    // independent throttling dimension from the IP-based check above.
    const normalizedEmail = email.toLowerCase()
    const emailLimit = await checkRateLimitByIdentifier(
      req,
      normalizedEmail,
      'forgot_password_email',
      3,
      60 * 60 * 1000,
    )
    if (!emailLimit.allowed) {
      return NextResponse.json({
        message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña.',
      }, { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfter) } })
    }

    // Always do a DB lookup so timing is similar whether or not email exists.
    // Doesn't fully prevent enumeration but raises the bar.
    const result = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [email]
    )
    const userId = result.rows[0]?.id as string | undefined

    if (userId) {
      // Audit 2026-08-13 I1: invalidate any prior outstanding reset tokens for
      // this user before issuing a new one. Defense in depth — mirrors the
      // pattern in resend-verification. Limits the number of coexisting
      // valid tokens to one per user, simplifies incident response.
      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      )

      // Mint a random plaintext token, store only its SHA-256 hash, send the
      // plaintext in the email. 1h TTL matches the previous JWT behavior.
      const plaintext = randomBytes(32).toString('base64url')
      const tokenHash = hashToken(plaintext)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt]
      )

      const userResult = await pool.query(
        'SELECT name FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
        [email]
      )
      const name = userResult.rows[0]?.name ?? ''

      // Send via the email helper. We await so failures are logged, but the
      // user-facing response is the same generic message either way (no
      // enumeration).
      try {
        const sendRes = await sendPasswordResetEmail({
          to: email.toLowerCase(),
          name,
          token: plaintext,
        })
        if (!sendRes.ok) {
          // Audit 2026-08-13 M1: log identifier hash, not raw email, so PII
          // doesn't leak to log aggregators.
          logger.error({ id: hashForAudit(email), error: sendRes.error }, '[forgot-password] Email send failed:')
        }
      } catch (emailErr) {
        logger.error(serializeErr(emailErr), '[forgot-password] Email error (non-fatal):')
      }
    }

    return NextResponse.json({
      message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña.',
    })
  } catch (err) {
    logger.error(serializeErr(err), 'Forgot password error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}