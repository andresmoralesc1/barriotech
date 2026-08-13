import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { checkRateLimit, checkRateLimitByIdentifier } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { issueEmailVerificationToken, sendVerificationEmail } from '@/lib/email'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'

/**
 * POST /api/auth/resend-verification
 *
 * Body: { email: string }
 *
 * Issues a new verification token and emails it. Always returns 200 with
 * a generic message (don't reveal whether the email exists). Rate-limited
 * per email AND per IP to prevent abuse.
 *
 * If the user is already verified, we still return 200 (no error) but
 * skip the send. Idempotent.
 */

const TOKEN_TTL_HOURS = 24

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const parsed = await parseJsonBody<{ email?: unknown }>(req)
  const rawEmail = parsed.ok ? parsed.body.email : undefined
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!email) {
    return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
  }

  // Per-IP rate limit (5/hour) — defense in depth, also blocks
  // attackers from enumerating valid emails by observing timing.
  const ip = getClientIp(req)
  const ipLimit = await checkRateLimit(ip, 'resend_verification', 5, 60 * 60 * 1000)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfter) } }
    )
  }

  // Per-email rate limit (3/hour) — even if attacker rotates IPs, they
  // can't hammer a single victim with resend spam.
  // Audit 2026-08-13 C1: was checkRateLimit(email, ...) which was IP-keyed
  // internally — defeating the per-email intent. Use the identifier-keyed
  // helper so the limit is independent of source IP.
  const emailLimit = await checkRateLimitByIdentifier(
    req, email, 'resend_verification_email', 3, 60 * 60 * 1000,
  )
  if (!emailLimit.allowed) {
    // Audit 2026-08-13 M2: return 429 with Retry-After so the client UI can
    // disable the resend button instead of letting the user keep hammering.
    return NextResponse.json(
      { message: 'Si la cuenta existe, recibirás un nuevo email de verificación.' },
      { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfter) } }
    )
  }

  // Look up the user. Same timing whether the email exists or not
  // (DB roundtrip is constant). We don't fail if not found — that
  // would let attackers enumerate valid emails via the response code.
  const result = await pool.query(
    'SELECT id, name, email_verified FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
    [email]
  )

  if (result.rows.length === 0) {
    // Pretend we sent the email so the response time and shape matches
    // the success path.
    return NextResponse.json(
      { message: 'Si la cuenta existe, recibirás un nuevo email de verificación.' }
    )
  }
  const user = result.rows[0]

  // Audit 2026-08-13 C3: collapse the "already verified" branch to the
  // generic message. Previously this leaked the account's verification
  // state (3 distinguishable responses = enumeration oracle). Now the
  // generic message is returned for both "exists + unverified" and
  // "exists + verified" — the only difference is no email is sent in
  // the verified case (which the client can't observe).
  if (user.email_verified) {
    return NextResponse.json(
      { message: 'Si la cuenta existe, recibirás un nuevo email de verificación.' }
    )
  }

  // Invalidate any prior active tokens for this user (defense in depth:
  // only one valid token at a time). Mark used_at on outstanding rows.
  await pool.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id]
  )

  // Issue a fresh token + send the email.
  try {
    const v = issueEmailVerificationToken(user.id)
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, v.tokenHash, v.expiresAt]
    )
    const result = await sendVerificationEmail({
      to: email,
      name: user.name,
      token: v.token,
    })
    if (!result.ok) {
      logger.error({ to: email, error: result.error }, '[resend-verification] Email send failed:')
    }
  } catch (err) {
    logger.error(serializeErr(err), '[resend-verification] error (non-fatal):')
  }

  return NextResponse.json(
    { message: 'Si la cuenta existe, recibirás un nuevo email de verificación.' }
  )
}