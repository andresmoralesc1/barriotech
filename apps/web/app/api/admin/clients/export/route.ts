/**
 * GET /api/admin/clients/export — CSV download of clients matching the
 * same filters as GET /api/admin/clients.
 *
 * Hard cap: 5000 rows (matches vendors/export). See that route for the
 * rationale.
 *
 * Stats (order/favorite/review counts) are computed via three correlated
 * subqueries — orders.buyer_id and favorites.buyer_id reference
 * profiles.id (NOT users.id), while reviews.user_id references users.id.
 * Two distinct join paths required.
 *
 * Admin-only. Audits with `export_clients_csv`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'
import { toCsv } from '@/lib/csv'

const MAX_EXPORT_ROWS = 5000

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_export_clients',
    5,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas exportaciones', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const url = new URL(req.url)
  const active = url.searchParams.get('active')
  const verified = url.searchParams.get('verified')
  const q = url.searchParams.get('q')?.trim()
  const cityId = url.searchParams.get('cityId')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')

  const conditions: string[] = ['u.role = $1']
  const params: unknown[] = ['buyer']

  if (active === 'true') conditions.push('u.is_active = true')
  else if (active === 'false') conditions.push('u.is_active = false')
  if (verified === 'true') conditions.push('u.email_verified = true')
  else if (verified === 'false') conditions.push('u.email_verified = false')
  if (cityId) {
    params.push(cityId)
    conditions.push(`u.city_id = $${params.length}`)
  }
  if (since) {
    params.push(since)
    conditions.push(`u.created_at >= $${params.length}`)
  }
  if (until) {
    params.push(until)
    conditions.push(`u.created_at < $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  try {
    const result = await pool.query(
      `SELECT
         u.id, u.email, u.name, u.phone, u.city_id, c.name AS city_name,
         u.is_active, u.email_verified, u.email_verified_at,
         u.last_login_at, u.created_at,
         (SELECT COUNT(*) FROM orders o
            JOIN profiles prf ON prf.id = o.buyer_id
            WHERE prf.user_id = u.id)::int AS order_count,
         (SELECT COUNT(*) FROM favorites f
            JOIN profiles prf ON prf.id = f.buyer_id
            WHERE prf.user_id = u.id)::int AS favorite_count,
         (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id)::int AS review_count
       FROM users u
       LEFT JOIN cities c ON c.id = u.city_id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT ${MAX_EXPORT_ROWS}`,
      params
    )

    const headers = [
      'id', 'email', 'name', 'phone', 'city_id', 'city_name',
      'is_active', 'email_verified', 'email_verified_at',
      'last_login_at', 'created_at',
      'order_count', 'favorite_count', 'review_count',
    ]

    const rows = result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      city_id: r.city_id,
      city_name: r.city_name,
      is_active: r.is_active ? 'true' : 'false',
      email_verified: r.email_verified ? 'true' : 'false',
      email_verified_at: r.email_verified_at,
      last_login_at: r.last_login_at,
      created_at: r.created_at,
      order_count: r.order_count,
      favorite_count: r.favorite_count,
      review_count: r.review_count,
    }))

    const csv = toCsv(headers, rows)

    logAdminAction(auth.userId, 'export_clients_csv', req, {
      metadata: { filters: { active, verified, q, cityId, since, until }, rows: rows.length },
    })

    const datestamp = new Date().toISOString().slice(0, 10)
    const filename = `clientes-${datestamp}.csv`

    return new NextResponse('﻿' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    logger.error(serializeErr(err), 'admin client export error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
