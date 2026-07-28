/**
 * GET /api/admin/orders — admin-only list of all orders.
 *
 * Operators triage orders constantly: refund disputes, lost items,
 * sponsor payouts, fraud checks. Until now there was no admin oversight
 * for orders — everything flowed through the buyer/vendor public
 * routes. This endpoint is the read-side of that oversight.
 *
 * Filters (all optional, AND'd):
 *   ?status=pending|accepted|ready|completed|cancelled
 *   ?vendorId=uuid                — exact match
 *   ?buyerId=uuid                 — exact match
 *   ?since=YYYY-MM-DD             — orders.created_at >= since
 *   ?until=YYYY-MM-DD             — orders.created_at <  until (exclusive)
 *   ?minTotal=15000               — orders.total >= minTotal (in cents)
 *   ?maxTotal=50000               — orders.total <= maxTotal (in cents)
 *   ?q=texto                      — case-insensitive search over
 *                                    buyer.name, buyer.email,
 *                                    vendor.name, vendor.slug
 *   ?limit=50&offset=0            — pagination (default 50, max 200)
 *
 * Returns: { orders, total, limit, offset }
 *   orders[]: id, status, total, createdAt, buyer{id,name,email},
 *             vendor{id,name,slug}, itemCount
 *
 * Admin-only. Read-only — there is no PATCH on this route. Status
 * mutations stay in the buyer/vendor flows; admins document their
 * interventions via /api/admin/notes (target_type='order' is not in
 * scope here, but admin_notes.author_id captures who did what).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
const VALID_STATUSES = ['pending', 'accepted', 'ready', 'completed', 'cancelled'] as const

type OrderStatus = (typeof VALID_STATUSES)[number]

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_order_list',
    60,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const vendorId = url.searchParams.get('vendorId')
  const buyerId = url.searchParams.get('buyerId')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const minTotal = url.searchParams.get('minTotal')
  const maxTotal = url.searchParams.get('maxTotal')
  const q = url.searchParams.get('q')?.trim()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10)

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  // Validate status early — better 400 than a silent no-result set
  if (status && !VALID_STATUSES.includes(status as OrderStatus)) {
    return NextResponse.json(
      { error: 'status inválido', valid: VALID_STATUSES },
      { status: 400 }
    )
  }

  // Validate uuid-shaped filters
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (vendorId && !uuidLike.test(vendorId)) {
    return NextResponse.json({ error: 'vendorId inválido' }, { status: 400 })
  }
  if (buyerId && !uuidLike.test(buyerId)) {
    return NextResponse.json({ error: 'buyerId inválido' }, { status: 400 })
  }

  const conditions: string[] = []
  const params: unknown[] = []

  if (status) {
    params.push(status)
    conditions.push(`o.status = $${params.length}::text`)
  }
  if (vendorId) {
    params.push(vendorId)
    conditions.push(`o.vendor_id = $${params.length}::uuid`)
  }
  if (buyerId) {
    params.push(buyerId)
    conditions.push(`o.buyer_id = $${params.length}::uuid`)
  }
  if (since) {
    params.push(since)
    conditions.push(`o.created_at >= $${params.length}::timestamptz`)
  }
  if (until) {
    params.push(until)
    conditions.push(`o.created_at < $${params.length}::timestamptz`)
  }
  if (minTotal) {
    const n = parseFloat(minTotal)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'minTotal inválido' }, { status: 400 })
    }
    params.push(n)
    conditions.push(`o.total >= $${params.length}::numeric`)
  }
  if (maxTotal) {
    const n = parseFloat(maxTotal)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'maxTotal inválido' }, { status: 400 })
    }
    params.push(n)
    conditions.push(`o.total <= $${params.length}::numeric`)
  }
  if (q) {
    params.push(`%${q}%`)
    const idx = params.length
    conditions.push(`(
      b.name ILIKE $${idx} OR b.email ILIKE $${idx}
      OR v.name ILIKE $${idx} OR v.slug ILIKE $${idx}
    )`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    params.push(limit, offset)
    const result = await pool.query(
      `SELECT
         o.id, o.status, o.total, o.created_at,
         b.id AS buyer_id, b.name AS buyer_name, b.email AS buyer_email,
         v.id AS vendor_id, v.name AS vendor_name, v.slug AS vendor_slug,
         COALESCE(item_stats.count, 0)::int AS item_count,
         COUNT(*) OVER() AS total_count
       FROM orders o
       JOIN profiles b ON b.id = o.buyer_id
       JOIN vendors v ON v.id = o.vendor_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
         FROM order_items oi
         WHERE oi.order_id = o.id
       ) item_stats ON true
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const orders = result.rows.map((r) => ({
      id: r.id,
      status: r.status,
      total: parseFloat(r.total),
      createdAt: r.created_at,
      buyer: {
        id: r.buyer_id,
        name: r.buyer_name,
        email: r.buyer_email,
      },
      vendor: {
        id: r.vendor_id,
        name: r.vendor_name,
        slug: r.vendor_slug,
      },
      itemCount: r.item_count,
    }))

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0

    logAdminAction(auth.userId, 'view_order_list', req, {
      metadata: {
        filters: { status, vendorId, buyerId, since, until, minTotal, maxTotal, q },
        limit, offset, returned: orders.length,
      },
    })

    return NextResponse.json({ orders, total, limit, offset })
  } catch (err) {
    logger.error(serializeErr(err), 'admin order list error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}