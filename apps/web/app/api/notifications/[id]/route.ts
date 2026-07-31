import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { isUuid } from '@/lib/core/utils/slug'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'


// PATCH /api/notifications/[id] — mark as read
type RouteContext = { params: Promise<{ id: string }> }
export async function PATCH(req: NextRequest, context: RouteContext) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const { id: notifId } = await context.params

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
// Per-user rate limit. 60/min — bursty but bounded.
const rl = await checkRateLimitByUser(req, 'mark_notification_read', 60, 60_000)
if (!rl.allowed) {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  )}

    const userId = auth.userId

    if (!notifId) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }
    // Defense: reject non-UUID up front so we never hit a 22P02 from PG.
    if (!isUuid(notifId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Verify ownership
    const check = await pool.query(
      `SELECT id FROM notifications
       WHERE id = $1 AND user_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [notifId, auth.userId]
    )

    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'Notificación no encontrada' }, { status: 404 })
    }

    const parsed = await parseJsonBody<{ read?: unknown }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const read = parsed.body.read
    const result = await pool.query(
      'UPDATE notifications SET read = $1 WHERE id = $2 RETURNING *',
      [read !== undefined ? !!read : true, notifId]
    )

    return NextResponse.json({ notification: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'Notifications PATCH error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
