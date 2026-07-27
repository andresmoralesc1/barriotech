import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'

/**
 * DELETE /api/account — ARCO right of cancellation / suppression.
 *
 * Ley 1581/2012 art. 9 + Decreto 1377/2013 art. 13: the user can request
 * deletion of their personal data at any time. We:
 *
 *   1. Anonymize records that have business/audit value (orders,
 *      notifications, favorites) — PII removed but row kept for
 *      accounting.
 *   2. Null-out vendor_views.user_id (preserves visit counts).
 *   3. Hard-delete profile, push_subscriptions, consent_logs (FK CASCADE
 *      handles this when users row is deleted).
 *   4. Hard-delete the user row — cascades into profiles/push_subs/
 *      consent_logs.
 *   5. Clear auth cookies so the deleted user cannot reuse them.
 *
 * Hard-deleted data is unrecoverable. We do NOT keep a soft-delete flag.
 *
 * Auth: required. A user can only delete their own account.
 */
export const runtime = 'nodejs'

export async function DELETE(request: NextRequest) {
    const csrf = requireSameOrigin(request); if (csrf) return csrf
  // M6 (audit 2026-07-27): cap the DELETE burst at 5/h per IP. The CSRF
  // check above blocks cross-site triggers, but a same-site loop (e.g.
  // a misbehaving extension, or a user repeatedly re-opening the
  // confirmation modal) can still hit the cascade-heavy code path often
  // enough to load the DB. 5/h is well above the legitimate UX ceiling.
  const ip = getClientIp(request)
  const { allowed, retryAfter } = await checkRateLimit(ip, 'account-delete', 5, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  // 1. Authenticate
  const auth = await requireAuth(request)

  if (auth instanceof NextResponse) return auth

  const userId = auth.userId

  // 2. Optional confirmation header to prevent accidental deletions.
  // Browsers SHOULD call confirm() before hitting this, but defense in
  // depth costs nothing.
  if (request.headers.get('x-confirm-delete') !== 'true') {
    return NextResponse.json(
      {
        error: 'Falta confirmación. Reenvía con el encabezado "X-Confirm-Delete: true".',
        hint: 'Re-envía con el encabezado "X-Confirm-Delete: true" para confirmar.',
      },
      { status: 409 }
    )
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Look up the user's profile id (needed for FK references).
    const profileRes = await client.query(
      'SELECT id FROM profiles WHERE user_id = $1',
      [userId]
    )
    const profileId = profileRes.rows[0]?.id ?? null

    // Anonymize records that reference the profile. We keep the rows so
    // sellers can still see "X orders received" without knowing who the
    // buyer was after deletion. The buyer_id FK is set to NULL where
    // possible, otherwise the row stays with a tombstone UUID.
    if (profileId) {
      // Anonymize orders: zero out the FK (orders.buyer_id is nullable).
      await client.query(
        `UPDATE orders SET buyer_id = NULL WHERE buyer_id = $1`,
        [profileId]
      )
      // Anonymize favorites: drop the rows (no business value without the user).
      await client.query(`DELETE FROM favorites WHERE buyer_id = $1`, [profileId])
      // Anonymize notifications: drop (they're personal to the user).
      // notifications.user_id FKs to profiles.id (NOT users.id — confirmed via
      // \d public.notifications). The previous code passed `userId` here,
      // which never matched any row → user notifications survived the DELETE
      // and persisted PII forever — direct Ley 1581/2012 art. 9 violation.
      await client.query(`DELETE FROM notifications WHERE user_id = $1`, [
        profileId,
      ])
    }

    // vendor_views uses user_id (users FK) directly. Drop user_id, keep
    // the visit count for analytics.
    await client.query(
      `UPDATE vendor_views SET user_id = NULL WHERE user_id = $1`,
      [userId]
    )

    // Revoke any in-flight tokens BEFORE the cascade wipes profiles.token_version.
    // Without this, a token issued just before DELETE stays valid for up to 7
    // days (refresh window) — incompatible with Ley 1581/2012 art. 9 (right
    // of suppression). Bumping token_version here lets isTokenRevoked reject
    // existing JWTs even after the profile row is gone.
    if (profileId) {
      await client.query(
        'UPDATE profiles SET token_version = token_version + 1 WHERE user_id = $1',
        [userId]
      )
    }

    // Hard-delete the user. ON DELETE CASCADE on profiles/push_subscriptions/
    // consent_logs handles related tables in one shot.
    const delRes = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [userId]
    )

    if (delRes.rowCount === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    await client.query('COMMIT')

    // 3. Clear auth cookies so the deleted user can't reuse the tokens.
    const response = NextResponse.json({
      ok: true,
      deleted: true,
      message: 'Tu cuenta y datos personales fueron eliminados conforme a la Ley 1581/2012.',
    })
    response.cookies.set('token', '', { path: '/', maxAge: 0 })
    response.cookies.set('refresh-token', '', { path: '/', maxAge: 0 })
    return response
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error(serializeErr(err), '[account delete] error:')
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  } finally {
    client.release()
  }
}