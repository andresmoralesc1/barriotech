import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Accept absolute http(s) URLs OR relative paths starting with `/`.
const URL_RE = /^https?:\/\/[^\s]{1,2048}$|^\/[^\s\\]{0,2047}$/

const MAX_PHOTOS_PER_PRODUCT = 6

/**
 * GET /api/products/[id]/photos — list all photos for a product.
 * POST /api/products/[id]/photos — add a photo (owner-only).
 * DELETE /api/products/[id]/photos — remove a photo (owner-only).
 */

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    if (!params.id || !UUID_RE.test(params.id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const result = await pool.query(
      'SELECT id, url, position, created_at FROM product_photos WHERE product_id = $1 ORDER BY position ASC, created_at ASC',
      [params.id]
    )
    return NextResponse.json({ photos: result.rows })
  } catch (err) {
    logger.error(serializeErr(err), 'GET photos error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const params = await paramsPromise
  try {
    if (!params.id || !UUID_RE.test(params.id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // P1-1 (audit 2026-07-27): require verified email before adding a
    // product photo (creating new content). The dashboard banner promises
    // this gate.
    const auth = await requireVerifiedEmail(req)
  if (auth instanceof NextResponse) return auth

  // Audit 2026-08-14 (Important #16): defense-in-depth role gate.
  if (auth.role !== 'seller' && auth.role !== 'service') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 })
  }

  // Per-user rate limit. 10/min — sellers rarely add 10+ photos/minute.
  // /api/upload has the 20/hr cap on the binary itself; this caps the
  // metadata row inserts which can also be abused.
  const rl = await checkRateLimitByUser(req, 'add_product_photo', 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

    // Verify ownership: product must belong to a vendor owned by this user.
    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       WHERE p.id = $1 AND v.profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as { url?: unknown } | null
    if (!body || typeof body.url !== 'string') {
      return NextResponse.json({ error: 'Falta campo url' }, { status: 400 })
    }
    const url = body.url.trim()
    if (!url || !URL_RE.test(url)) {
      return NextResponse.json(
        { error: 'URL inválida (debe empezar con http(s):// o /)' },
        { status: 400 }
      )
    }

    // Atomic insert with photo-cap guard: a single statement that returns the
    // photo only if the product has < 6 photos at insert time. Eliminates the
    // race window where two concurrent POSTs both read count=5 and both
    // succeed, leaving the product with 7 photos.
    const inserted = await pool.query(
      `INSERT INTO product_photos (product_id, url, position)
       SELECT $1, $2, COALESCE(MAX(position) + 1, 0)
       FROM product_photos
       WHERE product_id = $1
       HAVING COUNT(*) < $3
       RETURNING *`,
      [params.id, url, MAX_PHOTOS_PER_PRODUCT]
    )

    if (inserted.rows.length === 0) {
      return NextResponse.json(
        { error: `Máximo ${MAX_PHOTOS_PER_PRODUCT} fotos por producto` },
        { status: 400 }
      )
    }

    const newPhoto = inserted.rows[0]
    const isFirstPhoto = newPhoto.position === 0

    // If this is the first photo, also set products.photo_url for legacy
    // readers. Best-effort: if it fails, the new photo is still saved.
    if (isFirstPhoto) {
      try {
        await pool.query(
          'UPDATE products SET photo_url = $1 WHERE id = $2 AND photo_url IS NULL',
          [url, params.id]
        )
      } catch (updateErr) {
        logger.warn(serializeErr(updateErr), 'Non-fatal: failed to sync products.photo_url')
      }
    }

    return NextResponse.json({ photo: newPhoto }, { status: 201 })
  } catch (err) {
    logger.error(serializeErr(err), 'POST photos error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  // B-031: deprecated — use /api/products/[id]/photos/[photoId] (new
  // route) which puts the resource id in the URL path. Some CDNs strip
  // DELETE bodies. Kept for one release in case any external caller still
  // hits the old shape; will be removed next sprint if no traffic.
  const params = await paramsPromise
  try {
    if (!params.id || !UUID_RE.test(params.id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       WHERE p.id = $1 AND v.profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    let body: { photo_id?: unknown } | null = null
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido en body' }, { status: 400 })
    }
    const photoId = body?.photo_id
    if (typeof photoId !== 'string' || !UUID_RE.test(photoId)) {
      return NextResponse.json({ error: 'photo_id inválido' }, { status: 400 })
    }

    const del = await pool.query(
      'DELETE FROM product_photos WHERE id = $1 AND product_id = $2 RETURNING id, position',
      [photoId, params.id]
    )
    if (del.rows.length === 0) {
      return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 })
    }

    // If we just removed position 0 (the legacy "main" photo), promote the
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
    logger.error(serializeErr(err), 'DELETE photos error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * PATCH /api/products/[id]/photos — bulk reorder photos.
 * Body: { order: string[] } — UUIDs of all photos for this product,
 * in the desired display order. Validation:
 *   - order is an array of strings (UUIDs)
 *   - every UUID in order must belong to this product (no orphans)
 *   - the array must contain exactly the photos that exist (no extra,
 *     no missing)
 *
 * On success: rewrites position 0..N-1 and, if the position-0 photo
 * changed, syncs products.photo_url so the card thumbnail matches.
 */
export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    if (!params.id || !UUID_RE.test(params.id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       WHERE p.id = $1 AND v.profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    let body: { order?: unknown } | null = null
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido en body' }, { status: 400 })
    }

    const order = body?.order
    if (!Array.isArray(order) || order.length === 0 || order.length > MAX_PHOTOS_PER_PRODUCT) {
      return NextResponse.json(
        { error: `order debe ser un array de 1-${MAX_PHOTOS_PER_PRODUCT} UUIDs` },
        { status: 400 }
      )
    }
    if (!order.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
      return NextResponse.json({ error: 'Todos los IDs deben ser UUIDs válidos' }, { status: 400 })
    }

    // Verify every supplied UUID belongs to this product (no orphans) AND
    // that we got all of them (no missing photos).
    const existing = await pool.query(
      'SELECT id FROM product_photos WHERE product_id = $1 ORDER BY position ASC',
      [params.id]
    )
    const existingIds: Set<string> = new Set<string>(
      (existing.rows as Array<{ id: string }>).map((r) => r.id)
    )
    const suppliedIds: Set<string> = new Set<string>(order as string[])
    let allInSupplied = true
    existingIds.forEach((id: string) => {
      if (!suppliedIds.has(id)) allInSupplied = false
    })
    // Audit 2026-08-14: symmetric check. Old code only verified
    // existing ⊆ supplied — supplied UUIDs from another product passed
    // through, and the newFirstRes SELECT WHERE product_id=…
    // returned null for the foreign UUID, causing products.photo_url
    // to be set to NULL for the legit cover photo. Now we reject
    // any supplied id that doesn't belong to THIS product.
    suppliedIds.forEach((id: string) => {
      if (!existingIds.has(id)) allInSupplied = false
    })
    if (!allInSupplied) {
      return NextResponse.json(
        { error: 'La lista debe incluir exactamente todas las fotos existentes del producto' },
        { status: 400 }
      )
    }

    // Capture the URL of the new position-0 photo so we can sync
    // products.photo_url after the reorder.
    const newFirstRes = await pool.query(
      'SELECT url FROM product_photos WHERE id = $1 AND product_id = $2',
      [order[0], params.id]
    )
    const newFirstUrl = newFirstRes.rows[0]?.url ?? null

    // Reorder. CASE expression sets position = its index in `order`.
    // Each photo id is unique within a product so this is safe.
    const ids = order as string[]
    const caseExpr = ids
      .map((id, idx) => `WHEN id = $${idx + 1}::uuid THEN ${idx}`)
      .join(' ')
    const paramsForCase = [...ids, params.id]
    await pool.query(
      `UPDATE product_photos SET position = CASE ${caseExpr} END
       WHERE product_id = $${paramsForCase.length}`,
      paramsForCase
    )

    // Sync products.photo_url so the card thumbnail matches the new
    // primary photo. If the URL didn't change we still issue the UPDATE
    // (cheap) to keep the two in lock-step.
    await pool.query(
      'UPDATE products SET photo_url = $1 WHERE id = $2',
      [newFirstUrl, params.id]
    )

    return NextResponse.json({ ok: true, order: ids })
  } catch (err) {
    logger.error(serializeErr(err), 'PATCH photos error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}