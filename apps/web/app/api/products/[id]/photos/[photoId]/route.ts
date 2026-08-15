/**
 * DELETE /api/products/[id]/photos/[photoId] — remove a photo (owner-only).
 *
 * B-031 fix: replaces the DELETE /api/products/[id]/photos endpoint that
 * took a photo_id in the request body. Some proxies / CDNs strip the body
 * of DELETE requests, breaking the call. REST convention is to put the
 * resource id in the URL path.
 *
 * Same ownership + validation as the old endpoint; just a cleaner URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string; photoId: string }> }
) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const params = await paramsPromise
  try {
    if (!params.id || !UUID_RE.test(params.id)) {
      return NextResponse.json({ error: 'ID de producto inválido' }, { status: 400 })
    }
    if (!params.photoId || !UUID_RE.test(params.photoId)) {
      return NextResponse.json({ error: 'photoId inválido' }, { status: 400 })
    }

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
// Per-user rate limit. 10/min — bursty but bounded.
const rl = await checkRateLimitByUser(req, 'delete_product_photo', 10, 60_000)
if (!rl.allowed) {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  )}


    // Ownership check — same shape as the old endpoint.
    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       AND v.deleted_at IS NULL
       WHERE p.id = $1 AND v.profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const del = await pool.query(
      'DELETE FROM product_photos WHERE id = $1 AND product_id = $2 RETURNING id, position',
      [params.photoId, params.id]
    )
    if (del.rows.length === 0) {
      return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 })
    }

    // If we just deleted the cover photo (position 0), promote the
    // next-lowest position photo to photo_url so the card thumbnail keeps
    // working. Best-effort.
    if (del.rows[0].position === 0) {
      try {
        await pool.query(
          `UPDATE products SET photo_url = (
             SELECT url FROM product_photos
             WHERE product_id = $1
             ORDER BY position ASC LIMIT 1
           ) WHERE id = $1`,
          [params.id]
        )
      } catch (updateErr) {
        logger.warn(serializeErr(updateErr), 'Non-fatal: failed to promote next photo_url')
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error(serializeErr(err), 'DELETE photo error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}