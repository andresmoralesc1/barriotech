/**
 * GET   /api/admin/clients/[id] — full client (buyer) detail, admin-only.
 * PATCH /api/admin/clients/[id] — admin actions:
 *   { isActive: true|false }       — activate/deactivate the buyer account
 *   { emailVerified: true|false }   — override email verification
 *
 * Stats included in the GET response:
 *   - orderCount, favoriteCount, reviewCount — counts over the buyer's
 *     full history, useful for spotting fake/abandoned accounts.
 *
 * Every successful action is written to admin_audit_log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  try {
    // Stats join through profiles (orders.buyer_id and favorites.buyer_id
    // both reference profiles.id), while reviews.user_id points straight
    // at users.id. So two different join paths.
    const result = await pool.query(
      `SELECT
         u.id, u.email, u.name, u.phone, u.city_id,
         u.is_active, u.email_verified, u.role,
         u.created_at, u.last_login_at,
         (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = p.id) AS order_count,
         (SELECT COUNT(*) FROM favorites f WHERE f.buyer_id = p.id) AS favorite_count,
         (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.role = 'buyer'`,
      [id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    const r = result.rows[0]
    const client = {
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      cityId: r.city_id,
      isActive: r.is_active,
      emailVerified: r.email_verified,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      stats: {
        orderCount: parseInt(r.order_count, 10),
        favoriteCount: parseInt(r.favorite_count, 10),
        reviewCount: parseInt(r.review_count, 10),
      },
    }

    logAdminAction(auth.userId, 'view_client_detail', req, {
      targetType: 'user',
      targetId: id,
    })

    return NextResponse.json({ client })
  } catch (err) {
    logger.error(serializeErr(err), 'admin client detail error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_client_action',
    30,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas acciones', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const body = parsed.body as Record<string, unknown>

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const userRow = await client.query(
        `SELECT id, is_active, email_verified, role FROM users WHERE id = $1 FOR UPDATE`,
        [id]
      )
      if (userRow.rows.length === 0 || userRow.rows[0].role !== 'buyer') {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
      }

      const actions: Array<{
        action: 'activate_client' | 'deactivate_client' | 'override_email_verification'
        metadata: Record<string, unknown>
      }> = []

      if (typeof body.isActive === 'boolean') {
        const next = body.isActive
        const prev = userRow.rows[0].is_active
        if (prev !== next) {
          await client.query('UPDATE users SET is_active = $1 WHERE id = $2', [next, id])
          actions.push({
            action: next ? 'activate_client' : 'deactivate_client',
            metadata: { previous: prev, next },
          })
        }
      }

      if (typeof body.emailVerified === 'boolean') {
        const next = body.emailVerified
        const prev = userRow.rows[0].email_verified
        if (prev !== next) {
          await client.query('UPDATE users SET email_verified = $1 WHERE id = $2', [next, id])
          actions.push({
            action: 'override_email_verification',
            metadata: { previous: prev, next, target: 'user.email_verified' },
          })
        }
      }

      if (actions.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
      }

      await client.query('COMMIT')

      for (const a of actions) {
        await logAdminAction(auth.userId, a.action, req, {
          targetType: 'user',
          targetId: id,
          metadata: a.metadata,
        })
      }

      return NextResponse.json({
        ok: true,
        actions: actions.map((a) => a.action),
      })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'admin client action error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}