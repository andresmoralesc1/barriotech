import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import pool from '@/lib/db'
import { isUuid } from '@/lib/core/utils/slug'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

type RouteContext = {
  params: Promise<{ id: string }>
}

// PATCH /api/products/[id] — update product fields (seller only, owner only)
//
// CRIT fix: previously the PATCH handler body executed a DELETE, so editing a
// product silently destroyed it. Now it does a proper UPDATE with ownership
// check. Only fields present in the body are touched.
export async function PATCH(req: NextRequest, context: RouteContext) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const { id: productId } = await context.params

    if (!productId || !isUuid(productId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // P1-1 (audit 2026-07-27): require verified email before editing a
    // product. The dashboard banner promises this gate.
    const auth = await requireVerifiedEmail(req)
  if (auth instanceof NextResponse) return auth

  // Per-user rate limit. 20/min — product edits are bursty but rate-bounded.
  const rl = await checkRateLimitByUser(req, 'update_product', 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
    if (auth instanceof NextResponse) return auth

    // Verify ownership
    const check = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       JOIN profiles pr ON pr.id = v.profile_id
       WHERE p.id = $1 AND pr.user_id = $2`,
      [productId, auth.userId]
    )

    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'Producto no encontrado o sin permiso' }, { status: 404 })
    }

    const parsed = await parseJsonBody<{
      name?: string; description?: string; price?: number;
      photo_url?: string | null;
      // Sprint 6 D.1: sellers can publish/unpublish a single product
      // without deleting it. Accepting either camelCase (client) or
      // snake_case (raw API) avoids the migration footgun where the
      // client posts `isActive` but the handler ignored it.
      isActive?: boolean;
      is_active?: boolean;
    }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { name, description, price, photo_url } = parsed.body
    // isActive wins over is_active if both are sent (defensive — the
    // client should only send one, but if a stale caller mixes them we
    // want the snake_case from the raw API path to still be respected).
    const isActiveRaw =
      parsed.body.isActive !== undefined ? parsed.body.isActive : parsed.body.is_active

    // Build dynamic SET clause from provided fields only
    const setClauses: string[] = []
    const params: unknown[] = []

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Nombre inválido' }, { status: 400 })
      }
      params.push(name.trim())
      setClauses.push(`name = $${params.length}`)
    }
    if (description !== undefined) {
      if (typeof description !== 'string') {
        return NextResponse.json({ error: 'Descripción inválida' }, { status: 400 })
      }
      params.push(description)
      setClauses.push(`description = $${params.length}`)
    }
    if (price !== undefined) {
      const p = Number(price)
      if (!Number.isFinite(p) || p <= 0 || p > 99999999.99) {
        return NextResponse.json(
          { error: 'Precio inválido (debe ser > 0 y menor a 100,000,000 COP)' },
          { status: 400 }
        )
      }
      params.push(p)
      setClauses.push(`price = $${params.length}`)
    }
    if (photo_url !== undefined) {
      // Allow null to clear photo, or a non-empty http(s) URL to set it.
      if (photo_url !== null && (typeof photo_url !== 'string' || !/^https?:\/\//i.test(photo_url.trim()))) {
        return NextResponse.json({ error: 'URL de foto inválida (debe ser http:// o https://)' }, { status: 400 })
      }
      params.push(photo_url === null ? null : photo_url.trim())
      setClauses.push(`photo_url = $${params.length}`)
    }
    // Sprint 6 D.1: per-product publish/unpublish. Strict boolean — anything
    // other than a real boolean is rejected so a typo (e.g. the string
    // "true") doesn't silently fall back to either value.
    if (isActiveRaw !== undefined) {
      if (typeof isActiveRaw !== 'boolean') {
        return NextResponse.json(
          { error: 'isActive debe ser booleano (true o false)' },
          { status: 400 },
        )
      }
      params.push(isActiveRaw)
      setClauses.push(`is_active = $${params.length}`)
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 })
    }

    params.push(productId)
    const result = await pool.query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    )

    return NextResponse.json({ product: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'Products PATCH error:')
    // Surface numeric overflow cleanly so the UI can show a useful message
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '22003') {
      return NextResponse.json(
        { error: 'Precio demasiado grande (máx 99,999,999.99)' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// DELETE /api/products/[id] — delete product (seller only, owner only)
export async function DELETE(req: NextRequest, context: RouteContext) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const { id: productId } = await context.params

    if (!productId || !isUuid(productId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    // Verify ownership
    const check = await pool.query(
      `SELECT p.id FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       JOIN profiles pr ON pr.id = v.profile_id
       WHERE p.id = $1 AND pr.user_id = $2`,
      [productId, auth.userId]
    )

    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'Producto no encontrado o sin permiso' }, { status: 404 })
    }

    await pool.query('DELETE FROM products WHERE id = $1', [productId])
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error(serializeErr(err), 'Products DELETE error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}