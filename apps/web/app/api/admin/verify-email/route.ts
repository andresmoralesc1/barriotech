import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import pool from '@/lib/db'
import { logger, serializeErr } from '@/lib/logger'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitFromRequest } from '@/lib/rate-limit'

/**
 * POST /api/admin/verify-email
 *
 * FIELD-AGENT OVERRIDE — manually mark a seller's email as verified.
 *
 * Why this exists:
 *   P1-1 (audit 2026-07-27) gates every mutating endpoint behind
 *   requireVerifiedEmail(). For a field agent onboarding sellers in
 *   the centro, requiring email verification at the moment of
 *   registration creates a real blocker:
 *     - The seller's phone might not have email configured.
 *     - Brevo delivery can be delayed 5-15 min — the seller walks
 *       away before the email arrives.
 *     - The seller may have typed the wrong email.
 *   The EmailVerifyBanner tells the seller "Resend verification",
 *   which doesn't help when they never got the first one.
 *
 * How it's authorized:
 *   The endpoint requires header `X-Field-Agent-Token` to match
 *   `process.env.FIELD_AGENT_TOKEN`. We use a constant-time compare
 *   (`crypto.timingSafeEqual`) so a timing-attack can't leak the
 *   token. If the env var is unset, the endpoint refuses ALL
 *   requests — fail-closed. There is no role check because the
 *   `users` table has no admin role yet; the token IS the role.
 *
 * How it's guarded against misuse:
 *   - Body requires BOTH userId AND email; we verify the email
 *     matches the user's actual email in DB. Without that check,
 *     anyone with the token could mark any user verified.
 *   - Rate limit: 30 overrides per IP per 15 min (generous — this
 *     is a single operator).
 *   - Every override is logged with userId, email, IP for audit.
 *   - CSRF: same-origin check (the field agent calls this from the
 *     admin UI in the same origin).
 *
 * Errors:
 *   - 503 { error: '...' }                FIELD_AGENT_TOKEN unset.
 *   - 401 { error: 'Token inválido' }     bad / missing header.
 *   - 400 { error: '...' }                body / field validation.
 *   - 404 { error: 'Usuario no encontrado' }  userId doesn't exist.
 *   - 409 { error: 'Email no coincide' }  email ≠ users.email.
 *   - 200 { ok: true, userId, alreadyVerified: boolean }
 */

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual requires equal-length buffers. If lengths
  // differ the strings can't match anyway, but we still need to
  // do a constant-time compare to avoid leaking length info via
  // the early return.
  if (ab.length !== bb.length) {
    // Run a dummy compare against a same-length buffer so the
    // timing of this branch matches the "valid length" branch.
    const filler = Buffer.alloc(Math.max(ab.length, bb.length, 1))
    timingSafeEqual(filler, filler)
    return false
  }
  return timingSafeEqual(ab, bb)
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf

  const configured = process.env.FIELD_AGENT_TOKEN
  if (!configured) {
    logger.warn('[admin/verify-email] FIELD_AGENT_TOKEN not set — refusing request')
    return NextResponse.json(
      { error: 'Override no configurado en este entorno' },
      { status: 503 }
    )
  }

  const supplied = req.headers.get('x-field-agent-token') ?? ''
  if (!supplied || !safeEq(supplied, configured)) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
  }

  const rl = await checkRateLimitFromRequest(req, 'admin_verify_email', 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } }
    )
  }

  let body: { userId?: unknown; email?: unknown; phone?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  // FIELD-FIX (2026-07-27): email is optional now. /api/auth/register
  // allows phone-only signups (RegisterForm lets the seller type
  // either an email OR a phone in the single contact field — see
  // components/auth/RegisterForm.tsx). If the seller registered with
  // phone only, users.email is NULL and the field agent has no email
  // to verify against. We require EITHER userId+email OR userId+phone
  // and match whichever the DB row has.
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : ''
  if (!userId || (!email && !phone)) {
    return NextResponse.json(
      { error: 'userId con email o phone requerido' },
      { status: 400 }
    )
  }
  // Cheap format check BEFORE the DB roundtrip. users.id is a UUID;
  // if the caller hands us "MISS" (e.g. a buggy extraction script) we
  // want a clean 400, not a Postgres 22P02 leaking through as 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json({ error: 'userId inválido' }, { status: 400 })
  }

  try {
    const u = await pool.query(
      'SELECT email, phone, email_verified FROM users WHERE id = $1',
      [userId]
    )
    if (u.rows.length === 0) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }
    const row = u.rows[0]
    const dbEmail = String(row.email ?? '').toLowerCase()
    const dbPhone = String(row.phone ?? '').replace(/\D/g, '')

    // Match whichever field the caller supplied. If both email and
    // phone are given, BOTH must match — defense against a guessed
    // userId being verified via a leaked email alone.
    let matched = false
    if (email && phone) {
      matched = dbEmail === email && dbPhone === phone
    } else if (email) {
      matched = dbEmail === email && dbEmail !== ''
    } else {
      // phone-only path: the seller must have a phone on file.
      matched = dbPhone === phone && dbPhone !== ''
    }
    if (!matched) {
      logger.warn(
        {
          userId,
          suppliedEmail: email || null,
          suppliedPhone: phone || null,
          hasEmail: dbEmail !== '',
          hasPhone: dbPhone !== '',
        },
        '[admin/verify-email] contact mismatch — refusing'
      )
      return NextResponse.json({ error: 'Email o teléfono no coincide' }, { status: 409 })
    }

    const alreadyVerified = row.email_verified === true
    if (!alreadyVerified) {
      await pool.query(
        `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1`,
        [userId]
      )
      // Burn any pending tokens so a leaked old link can't be used.
      await pool.query(
        `UPDATE email_verification_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      )
    }

    logger.info(
      {
        userId,
        email,
        actor: 'field-agent',
        alreadyVerified,
        ip: req.headers.get('x-forwarded-for') ?? null,
      },
      '[admin/verify-email] override applied'
    )

    return NextResponse.json({ ok: true, userId, alreadyVerified })
  } catch (err) {
    logger.error(serializeErr(err), '[admin/verify-email] error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}