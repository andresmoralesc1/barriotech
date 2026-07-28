/**
 * GET /api/admin/orders/[id] — admin-only order detail.
 *
 * Read-only: returns full order context for the operator — buyer,
 * vendor, item line items, and a snapshot of related activity
 * (sponsorship, review, notes). No PATCH route; status mutations
 * stay in the buyer/vendor flows to preserve the audit trail.
 *
 * Returns: { order, items[], buyer, vendor, related } where
 *   order:   id, status, total, createdAt
 *   items[]: id, productId, productName, quantity, price, subtotal
 *   buyer:   profile id + name + email + phone + isActive
 *   vendor:  id + name + slug + isActive + ownerName
 *   related: count of admin notes targeting this order via vendor or
 *            buyer (the FK chain order → vendor or buyer → profile
 *            means we surface notes by either target, since
 *            admin_notes has no direct order target today)
 *
 * Admin-only. Every call is written to admin_audit_log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_order_detail',
    120,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  try {
    const orderRes = await pool.query(
      `SELECT
         o.id, o.status, o.total, o.created_at,
         b.id AS buyer_id, b.name AS buyer_name, b.email AS buyer_email,
         b.user_id AS buyer_user_id,
         buyer_user.phone AS buyer_phone, buyer_user.is_active AS buyer_is_active,
         v.id AS vendor_id, v.name AS vendor_name, v.slug AS vendor_slug,
         v.is_active AS vendor_is_active,
         owner.name AS owner_name
       FROM orders o
       JOIN profiles b ON b.id = o.buyer_id
       JOIN users buyer_user ON buyer_user.id = b.user_id
       JOIN vendors v ON v.id = o.vendor_id
       LEFT JOIN profiles owner ON owner.id = v.profile_id
       WHERE o.id = $1`,
      [id]
    )
    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    }
    const r = orderRes.rows[0]

    const itemsRes = await pool.query(
      `SELECT
         oi.id, oi.product_id, oi.quantity, oi.price,
         COALESCE(p.name, '(producto eliminado)') AS product_name,
         (oi.quantity * oi.price)::numeric(10,2) AS subtotal
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id ASC`,
      [id]
    )
    const items = itemsRes.rows.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      quantity: it.quantity,
      price: parseFloat(it.price),
      subtotal: parseFloat(it.subtotal),
    }))

    // Related admin notes — by buyer_user_id (target_type='user') OR
    // vendor_id (target_type='vendor'). admin_notes doesn't have a
    // direct order FK, so we surface the surrounding context the
    // operator would actually want.
    const notesRes = await pool.query(
      `SELECT an.id, an.target_type, an.target_id, an.body, an.created_at,
              au.name AS author_name, au.email AS author_email
       FROM admin_notes an
       JOIN users au ON au.id = an.author_id
       WHERE (an.target_type = 'user' AND an.target_id = $1)
          OR (an.target_type = 'vendor' AND an.target_id = $2)
       ORDER BY an.created_at DESC`,
      [r.buyer_user_id, r.vendor_id]
    )
    const relatedNotes = notesRes.rows.map((n) => ({
      id: n.id,
      targetType: n.target_type,
      targetId: n.target_id,
      body: n.body,
      createdAt: n.created_at,
      authorName: n.author_name,
      authorEmail: n.author_email,
    }))

    logAdminAction(auth.userId, 'view_order_detail', req, {
      targetType: 'vendor',
      targetId: r.vendor_id,
      metadata: { orderId: id, itemCount: items.length, relatedNoteCount: relatedNotes.length },
    })

    return NextResponse.json({
      order: {
        id: r.id,
        status: r.status,
        total: parseFloat(r.total),
        createdAt: r.created_at,
      },
      items,
      buyer: {
        id: r.buyer_id,
        name: r.buyer_name,
        email: r.buyer_email,
        phone: r.buyer_phone,
        isActive: r.buyer_is_active,
      },
      vendor: {
        id: r.vendor_id,
        name: r.vendor_name,
        slug: r.vendor_slug,
        isActive: r.vendor_is_active,
        ownerName: r.owner_name,
      },
      related: { notes: relatedNotes },
    })
  } catch (err) {
    logger.error(serializeErr(err), 'admin order detail error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}