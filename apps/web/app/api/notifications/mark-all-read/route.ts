import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

/**
 * POST /api/notifications/mark-all-read
 *
 * Marks every unread notification for the calling user as read in a single
 * UPDATE. Cheaper than PATCH /api/notifications/[id] in a loop (one round-trip
 * vs N), and avoids the "click → 1 → click → 1" client-side N+1 that the audit
 * flagged. Body is ignored.
 *
 * Auth: required.
 */
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  // Per-user rate limit. 10/min — bulk mark-read is rare; bots would burst.
  const rl = await checkRateLimitByUser(req, 'mark_all_read', 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
  try {
    // user_id on notifications is the profile id, not users.id. The owner
    // check resolves users.id → profiles.id in the WHERE.
    const result = await pool.query(
      `UPDATE notifications
       SET read = TRUE
       WHERE read = FALSE
         AND user_id IN (SELECT id FROM profiles WHERE user_id = $1)
       RETURNING id`,
      [auth.userId]
    )

    return NextResponse.json({ updated: result.rowCount ?? result.rows.length })
  } catch (err) {
    logger.error(serializeErr(err), 'mark-all-read error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}