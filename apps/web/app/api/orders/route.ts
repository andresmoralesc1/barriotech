import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { isUuid } from '@/lib/core/utils/slug'
import { parseJsonBody } from '@/lib/parse-json'
import pool from '@/lib/db'
import { checkRateLimit, checkRateLimitByUser } from '@/lib/rate-limit'
import { requireSameOrigin } from '@/lib/csrf'


/**
 * GET /api/orders — list the calling user's orders.
 *
 * Buyers see orders they placed; vendors see orders placed at their stores.
 * The role check below branches the query so a buyer can never see another
 * vendor's order and a vendor can never see another vendor's orders.
 *
 * Bug history: this file used to export a single handler called `GET`
 * whose body did the POST flow (insert order + items). Calling it as GET
 * with a body would 500 from a body-parse failure. We now expose both
 * verbs explicitly.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
    const userId = auth.userId

    const profileRes = await pool.query(
      'SELECT id, role FROM profiles WHERE user_id = $1',
      [userId]
    )
    if (profileRes.rows.length === 0) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })
    }
    const profile = profileRes.rows[0]

    let result
    if (profile.role === 'buyer') {
      // Orders this buyer placed.
      result = await pool.query(
        `SELECT o.id, o.vendor_id, o.status, o.total, o.created_at,
                v.name AS vendor_name, v.slug AS vendor_slug, v.photo_url AS vendor_photo_url
         FROM orders o
         JOIN vendors v ON v.id = o.vendor_id
         WHERE o.buyer_id = $1
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [profile.id]
      )
    } else if (profile.role === 'seller') {
      // Orders received at any of this seller's vendor rows.
      result = await pool.query(
        `SELECT o.id, o.vendor_id, o.status, o.total, o.created_at,
                v.name AS vendor_name, v.slug AS vendor_slug, v.photo_url AS vendor_photo_url,
                o.buyer_id
         FROM orders o
         JOIN vendors v ON v.id = o.vendor_id
         WHERE v.profile_id = $1
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [profile.id]
      )
    } else {
      return NextResponse.json({ orders: [] })
    }

    return NextResponse.json({ orders: result.rows })
  } catch (err) {
    logger.error(serializeErr(err), 'Orders GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// POST /api/orders — create order (buyer only)
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    // Per-user rate limit on order creation. 20/min — generous for legit
    // multi-vendor ordering, blocks runaway bots from creating orders.
    const rl = await checkRateLimitByUser(req, 'create_order', 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    const userId = auth.userId

    // Get buyer profile from userId
    const profileRes = await pool.query(
      'SELECT id, role FROM profiles WHERE user_id = $1',
      [userId]
    )
    if (profileRes.rows.length === 0) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })
    }
    const profile = profileRes.rows[0]

    // SECURITY: trust the JWT role, not the DB profile.role. A seller whose
    // profile role was somehow flipped, or a JWT issued before a role change,
    // could otherwise bypass the buyer-only check here.
    if (auth.role !== 'buyer' || profile.role !== 'buyer') {
      return NextResponse.json({ error: 'Solo compradores pueden crear órdenes' }, { status: 403 })
    }

    const parsed = await parseJsonBody<{ vendorId?: string; items?: { productId?: unknown; quantity?: unknown }[] }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { vendorId, items } = parsed.body

    if (!vendorId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }
    // CRIT-26: validate UUID early to prevent 500 on syntax error from Postgres.
    if (!isUuid(vendorId)) {
      return NextResponse.json({ error: 'vendorId debe ser un UUID válido' }, { status: 400 })
    }

    // Validate item shape: each item must have productId (UUID) and quantity (1-999).
    for (const item of items) {
      const { productId, quantity } = item
      if (
        typeof productId !== 'string' ||
        !isUuid(productId) ||
        typeof quantity !== 'number' ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 999
      ) {
        return NextResponse.json(
          { error: 'Cada item debe tener productId (UUID) y quantity (1-999, entero)' },
          { status: 400 }
        )
      }
    }

    // SECURITY: fetch real prices + validate ownership in one query.
    // We DO NOT trust item.price from the client.
    const productIds = items.map((i) => i.productId as string)
    // Audit 2026-08-14 (ORD-4): dedupe productIds so legitimate
    // double-tap (same product twice) doesn't trigger the "product not
    // found" branch. Old code compared rows.length to productIds.length
    // and Any() de-duplicates server-side — mismatch gave a misleading
    // error.
    const dedupedProductIds = Array.from(new Set(productIds))
    const productsRes = await pool.query(
      `SELECT id, vendor_id, price
       FROM products
       WHERE id = ANY($1::uuid[])`,
      [dedupedProductIds]
    )

    if (productsRes.rows.length !== dedupedProductIds.length) {
      return NextResponse.json({ error: 'Uno o más productos no existen' }, { status: 400 })
    }

    // Audit 2026-08-14 (ORD-5): pre-check vendor existence for a
    // cleaner error path. Without this, a non-existent vendorId falls
    // through to the per-product ownership check and returns "no
    // pertenece al vendedor" — misleading.
    const vendorCheck = await pool.query(
      'SELECT id FROM vendors WHERE id = $1 AND deleted_at IS NULL',
      [vendorId]
    )
    if (vendorCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
    }

    // Build a price map AND validate ownership
    const priceMap = new Map<string, { price: number; vendorId: string }>()
    for (const p of productsRes.rows) {
      priceMap.set(p.id, {
        price: parseFloat(p.price),
        vendorId: p.vendor_id,
      })
    }

    // Compute total server-side using DB prices
    let total = 0
    for (const item of items) {
      const productId = item.productId as string
      const product = priceMap.get(productId)
      if (!product) {
        return NextResponse.json({ error: `Producto ${productId} no encontrado` }, { status: 400 })
      }
      if (product.vendorId !== vendorId) {
        return NextResponse.json({ error: `Producto ${productId} no pertenece al vendedor` }, { status: 400 })
      }
      total += product.price * (item.quantity as number)
    }

    // Transaction: create order + insert items atomically
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const orderResult = await client.query(
        `INSERT INTO orders (buyer_id, vendor_id, total) VALUES ($1, $2, $3) RETURNING *`,
        [profile.id, vendorId, total]
      )
      const order = orderResult.rows[0]

      // Build items insert using server-side prices
      const itemsValues: unknown[] = []
      const placeholders: string[] = []
      let paramIdx = 1
      for (const item of items) {
        const productId = item.productId as string
        const quantity = item.quantity as number
        const serverPrice = priceMap.get(productId)!.price
        placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`)
        itemsValues.push(order.id, productId, quantity, serverPrice)
        paramIdx += 4
      }

      const itemsResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ${placeholders.join(', ')} RETURNING *`,
        itemsValues
      )

      await client.query('COMMIT')

      return NextResponse.json({ order: { ...order, items: itemsResult.rows } }, { status: 201 })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'Orders POST error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}