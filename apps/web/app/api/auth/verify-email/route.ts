import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { hashToken } from '@/lib/email'
import { checkRateLimitFromRequest } from '@/lib/rate-limit'
import { requireSameOrigin } from '@/lib/csrf'

/**
 * POST /api/auth/verify-email
 *
 * Body: { token: string }
 *
 * The token is the plaintext the user clicked in their email. We SHA-256
 * it, look it up in `email_verification_tokens`, and if the row is still
 * active (not used, not expired) we mark the user as verified and burn
 * the token.
 *
 * Errors:
 *  - 400 { error: 'Token requerido' }   missing field
 *  - 404 { error: 'Token inválido' }     no row matches
 *  - 410 { error: 'Token expirado' }     row exists but expires_at < now()
 *  - 410 { error: 'Token ya usado' }     row exists but used_at IS NOT NULL
 *  - 200 { verified: true, email: '...' } success
 *
 * The 410 distinctions matter for the UI: "expired" → show "Resend",
 * "already used" → show "You're already verified, log in".
 */

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Defense against DoS via connection-pool exhaustion: this endpoint runs
  // BEGIN + SELECT FOR UPDATE + 2 UPDATEs + COMMIT for every request (5
  // round-trips with a row lock). A flood of bogus tokens can saturate the
  // pool even though the SHA-256'd token space is unguessable.
  const rl = await checkRateLimitFromRequest(req, 'verify_email', 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } }
    )
  }

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 })
  }

  const tokenHash = hashToken(token)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    )
    if (result.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Token inválido' }, { status: 404 })
    }
    const row = result.rows[0]
    if (row.used_at) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Token ya usado' }, { status: 410 })
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Token expirado' }, { status: 410 })
    }

    // Mark token as used and user as verified in the same tx.
    await client.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    )
    await client.query(
      `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1`,
      [row.user_id]
    )
    // Audit 2026-08-14: now that the user is verified, flip any
    // pre-existing vendor row to is_active=true. The register route
    // (commit a1cbae9) now creates vendors with is_active=false
    // regardless of role, so the listing doesn't go live until the
    // user clicks the verification email. Sellers can still toggle
    // off later via /api/vendors/me/settings.
    await client.query(
      `UPDATE vendors SET is_active = true, is_verified = true
       WHERE profile_id = (SELECT id FROM profiles WHERE user_id = $1)`,
      [row.user_id]
    )
    await client.query('COMMIT')

    // Look up the email for the success payload (handy for the UI).
    const u = await pool.query('SELECT email FROM users WHERE id = $1', [row.user_id])
    return NextResponse.json({ verified: true, email: u.rows[0]?.email ?? null })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error(serializeErr(err), '[verify-email] error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  } finally {
    client.release()
  }
}