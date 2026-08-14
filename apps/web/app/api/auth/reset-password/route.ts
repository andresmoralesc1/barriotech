import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { checkRateLimit, checkRateLimitByIdentifier } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { hashToken } from '@/lib/email'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { isCommonPassword } from '@/lib/common-passwords'

/**
 * POST /api/auth/reset-password
 *
 * Body: { token, password }
 *
 * S1-AUTH-1 (audit 2026-07-22): token is now a single-use random value
 * looked up by its SHA-256 hash in `password_reset_tokens` (was previously
 * a stateless JWT that could be replayed for 1h). Atomic transition:
 * mark used_at + bump profiles.token_version + update password all in
 * one tx with FOR UPDATE on the token row.
 */
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const ip = getClientIp(req)

  const { allowed, retryAfter } = await checkRateLimit(ip, 'reset_password', 10, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  // Audit 2026-08-13 I3: per-token rate limit too. 256-bit tokens aren't
  // brute-forceable, but if a plaintext token leaks (email forwarding,
  // screenshot, accidental paste) + rotating IPs the attacker can retry
  // until expiry. Hash the token first so we don't put plaintexts in
  // rate_limit_attempts.
  //
  // Audit 2026-08-14: moved AFTER the body parse. The original code
  // called parseJsonBody(req) twice — `req.json()` consumes the body
  // stream once, so the second call got an empty stream and rejected
  // every reset with 400 "JSON inválido". Dead-on-arrival for every
  // password-reset link in the wild.
  const client = await pool.connect()
  try {
    const parsed = await parseJsonBody<{ token?: unknown; password?: unknown }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { token, password } = parsed.body
    if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 })
    }

    // Per-token rate limit (defense in depth against leaked tokens +
    // rotating IPs). Hash first so plaintexts never enter the
    // rate_limit_attempts table.
    const tokenHash = hashToken(token)
    const tokenLimit = await checkRateLimitByIdentifier(
      req, tokenHash, 'reset_password_token', 10, 60 * 60 * 1000,
    )
    if (!tokenLimit.allowed) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Intenta más tarde.' },
        { status: 429, headers: { 'Retry-After': String(tokenLimit.retryAfter) } }
      )
    }

    // Same strength rules as register — server enforces, client can't bypass.
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 8 caracteres' },
        { status: 400 }
      )
    }
    if (password.length > 128) {
      return NextResponse.json(
        { error: 'La contraseña es demasiado larga (máx 128 caracteres)' },
        { status: 400 }
      )
    }
    if (isCommonPassword(password)) {
      return NextResponse.json(
        { error: 'Esta contraseña es muy común. Elige otra más segura.' },
        { status: 400 }
      )
    }

    // tokenHash already computed above for the per-token rate limit; reuse it.
    await client.query('BEGIN')

    // Lock the token row to prevent races where two concurrent requests try
    // to consume the same token. Mirrors the pattern in verify-email.
    const tokenRes = await client.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    )

    if (tokenRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'El enlace expiró o no es válido. Solicita uno nuevo.' },
        { status: 400 }
      )
    }

    const row = tokenRes.rows[0]
    if (row.used_at) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'Este enlace ya fue usado. Solicita uno nuevo.' },
        { status: 400 }
      )
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'El enlace expiró. Solicita uno nuevo.' },
        { status: 400 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 13)

    // Audit 2026-08-13 I2: validate the password UPDATE before burning the
    // token. If the user was deactivated (is_active=false) between token
    // issue and consumption, the previous order would burn the token AND
    // fail to reset the password, locking the user out with no error path
    // (forgot-password filters is_active=true too).
    const userUpdate = await client.query(
      `UPDATE users SET password_hash = $1
       WHERE id = $2 AND is_active = true`,
      [passwordHash, row.user_id]
    )
    if (userUpdate.rowCount === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'No se pudo actualizar la contraseña. Contacta a soporte.' },
        { status: 400 }
      )
    }

    // 1) Mark token as used
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    )
    // 3) Revoke all existing sessions for this user. NOTE: relies on
    // requireAuth (lib/auth.ts:159-166) checking profiles.token_version
    // via isTokenRevoked — never call verifyToken() directly here or
    // downstream without that revocation check, or the session-kill claim
    // becomes a lie. (Audit 2026-08-13 I5.)
    await client.query(
      'UPDATE profiles SET token_version = token_version + 1 WHERE user_id = $1',
      [row.user_id]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.',
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error(serializeErr(err), 'Reset password error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  } finally {
    client.release()
  }
}
