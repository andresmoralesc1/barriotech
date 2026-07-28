/**
 * GET   /api/admin/vendors/[id] — full vendor detail (admin only).
 * PATCH /api/admin/vendors/[id] — admin actions:
 *   { isActive: true|false }       — activate/deactivate
 *   { emailVerified: true|false }   — override email verification
 * DELETE /api/admin/vendors/[id]    — soft-delete (sets deleted_at = NOW()).
 *
 * Soft-deleted vendors are hidden by default (?includeDeleted=true to see them).
 *
 * POST is intentionally not exported; admin actions are mutually
 * exclusive state transitions, not creates.
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

  // Soft-deleted rows are visible only when explicitly requested — the
  // typical admin path doesn't want a deleted vendor to show up under
  // their finger when they paste a stale link.
  const includeDeleted = new URL(req.url).searchParams.get('includeDeleted') === 'true'

  try {
    const result = await pool.query(
      `SELECT
         v.id, v.name, v.slug, v.category, v.description, v.phone,
         v.city_id, v.latitude, v.longitude, v.vehicle_type, v.vehicle_photo_url,
         v.business_hours_enabled, v.business_hours_start, v.business_hours_end,
         v.business_days, v.station_type, v.geo_mode,
         v.is_active, v.is_verified,
         v.photo_url, v.created_at, v.location_updated_at, v.deleted_at,
         p.id AS profile_id, p.name AS owner_name,
         u.id AS owner_id, u.email, u.phone, u.email_verified,
         u.created_at AS owner_created_at, u.last_login_at,
         (SELECT COUNT(*) FROM products WHERE vendor_id = v.id) AS product_count
       FROM vendors v
       JOIN profiles p ON p.id = v.profile_id
       JOIN users u ON u.id = p.user_id
       WHERE v.id = $1
         ${includeDeleted ? '' : 'AND v.deleted_at IS NULL'}`,
      [id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
    }

    const r = result.rows[0]

    // Drill-down enrichment: reviews (top 5 + all-time stats), active
    // sponsorship, and last-30-day order counts. All run as parallel
    // independent queries against indexes (idx_reviews_vendor_id,
    // idx_sponsorships_vendor_active, idx_orders_vendor_id), so a
    // drawer open is at most ~5 small SELECTs — no risk of a slow
    // response for a vendor with 10k reviews.
    const [
      recentReviewsRes,
      reviewStatsRes,
      activeSponsorshipRes,
      orderStatsRes,
    ] = await Promise.all([
      pool.query(
        `SELECT id, rating, comment, author_name, user_id, created_at
           FROM reviews
          WHERE vendor_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(AVG(rating)::numeric(10,2), 0) AS avg_rating,
                COUNT(*) FILTER (WHERE rating = 1)::int AS r1,
                COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
                COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
                COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
                COUNT(*) FILTER (WHERE rating = 5)::int AS r5
           FROM reviews
          WHERE vendor_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, plan, amount_cents, starts_at, ends_at, status,
                GREATEST(0, EXTRACT(DAY FROM (ends_at - NOW()))::int) AS days_remaining
           FROM sponsorships
          WHERE vendor_id = $1 AND status = 'active' AND ends_at > NOW()
          ORDER BY ends_at DESC
          LIMIT 1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS last_30
           FROM orders
          WHERE vendor_id = $1`,
        [id]
      ),
    ])

    const reviewStatsRow = reviewStatsRes.rows[0] || {
      total: 0, avg_rating: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0,
    }

    const vendor = {
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      description: r.description,
      phone: r.phone,
      cityId: r.city_id,
      latitude: r.latitude,
      longitude: r.longitude,
      vehicleType: r.vehicle_type,
      vehiclePhotoUrl: r.vehicle_photo_url,
      businessHours: {
        enabled: r.business_hours_enabled,
        start: r.business_hours_start,
        end: r.business_hours_end,
        days: r.business_days,
      },
      stationType: r.station_type,
      geoMode: r.geo_mode,
      isActive: r.is_active,
      isVerified: r.is_verified,
      photoUrl: r.photo_url,
      createdAt: r.created_at,
      locationUpdatedAt: r.location_updated_at,
      deletedAt: r.deleted_at,
      productCount: parseInt(r.product_count, 10),
      owner: {
        id: r.owner_id,
        profileId: r.profile_id,
        name: r.owner_name,
        email: r.email,
        phone: r.phone,
        emailVerified: r.email_verified,
        createdAt: r.owner_created_at,
        lastLoginAt: r.last_login_at,
      },
      recentReviews: recentReviewsRes.rows.map((rv) => ({
        id: rv.id,
        rating: rv.rating,
        comment: rv.comment,
        authorName: rv.author_name,
        userId: rv.user_id,
        createdAt: rv.created_at,
      })),
      reviewStats: {
        total: reviewStatsRow.total,
        averageRating: parseFloat(reviewStatsRow.avg_rating),
        distribution: {
          1: reviewStatsRow.r1,
          2: reviewStatsRow.r2,
          3: reviewStatsRow.r3,
          4: reviewStatsRow.r4,
          5: reviewStatsRow.r5,
        },
      },
      activeSponsorship: activeSponsorshipRes.rows[0]
        ? {
            id: activeSponsorshipRes.rows[0].id,
            plan: activeSponsorshipRes.rows[0].plan,
            amountCents: parseInt(activeSponsorshipRes.rows[0].amount_cents, 10),
            startsAt: activeSponsorshipRes.rows[0].starts_at,
            endsAt: activeSponsorshipRes.rows[0].ends_at,
            status: activeSponsorshipRes.rows[0].status,
            daysRemaining: activeSponsorshipRes.rows[0].days_remaining,
          }
        : null,
      orderStats: {
        total: orderStatsRes.rows[0]?.total ?? 0,
        last30Days: orderStatsRes.rows[0]?.last_30 ?? 0,
      },
    }

    logAdminAction(auth.userId, 'view_vendor_detail', req, {
      targetType: 'vendor',
      targetId: id,
    })

    return NextResponse.json({ vendor })
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor detail error')
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
    'admin_vendor_action',
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

      // Look up the vendor's owner (profile.user_id) so we can flip
      // email_verified on users, not on vendors. Refuse to act on a
      // soft-deleted vendor — the admin must restore first via the
      // dedicated endpoint.
      const vendorRow = await client.query(
        `SELECT v.id, v.profile_id, v.is_active, v.deleted_at, p.user_id, u.email_verified
         FROM vendors v
         JOIN profiles p ON p.id = v.profile_id
         JOIN users u ON u.id = p.user_id
         WHERE v.id = $1
           AND v.deleted_at IS NULL
         FOR UPDATE`,
        [id]
      )
      if (vendorRow.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: 'Vendedor no encontrado o eliminado' },
          { status: 404 }
        )
      }
      const ownerUserId = vendorRow.rows[0].user_id

      const actions: Array<{ action: 'activate_vendor' | 'deactivate_vendor' | 'override_email_verification'; metadata: Record<string, unknown> }> = []

      if (typeof body.isActive === 'boolean') {
        const next = body.isActive
        const prev = vendorRow.rows[0].is_active
        if (prev !== next) {
          await client.query('UPDATE vendors SET is_active = $1 WHERE id = $2', [next, id])
          actions.push({
            action: next ? 'activate_vendor' : 'deactivate_vendor',
            metadata: { previous: prev, next },
          })
        }
      }

      if (typeof body.emailVerified === 'boolean') {
        const next = body.emailVerified
        const prev = vendorRow.rows[0].email_verified
        if (prev !== next) {
          await client.query(
            'UPDATE users SET email_verified = $1 WHERE id = $2',
            [next, ownerUserId]
          )
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

      // Fetch the updated state to return.
      const updated = await client.query(
        `SELECT v.is_active, u.email_verified FROM vendors v
         JOIN profiles p ON p.id = v.profile_id
         JOIN users u ON u.id = p.user_id
         WHERE v.id = $1`,
        [id]
      )

      await client.query('COMMIT')

      // Audit AFTER commit so a rolled-back transaction leaves no trace.
      for (const a of actions) {
        await logAdminAction(auth.userId, a.action, req, {
          targetType: 'vendor',
          targetId: id,
          metadata: a.metadata,
        })
      }

      return NextResponse.json({
        ok: true,
        vendor: {
          isActive: updated.rows[0].is_active,
          ownerEmailVerified: updated.rows[0].email_verified,
        },
        actions: actions.map((a) => a.action),
      })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor action error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/vendors/[id] — soft-delete.
 *
 * Sets `deleted_at = NOW()`. The vendor stays in the table so historical
 * products, orders, reviews, favorites, and sponsorships are intact, but
 * they vanish from every public read. Restoring goes through the
 * dedicated POST /api/admin/vendors/[id]/restore endpoint.
 *
 * Idempotent: a second DELETE against a soft-deleted vendor returns 200
 * without writing a new deleted_at timestamp or audit row. Returning 200
 * (not 410) keeps client retries safe.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_vendor_delete',
    20,
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

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const cur = await client.query(
        `SELECT v.id, v.deleted_at FROM vendors v WHERE v.id = $1 FOR UPDATE`,
        [id]
      )
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
      }

      if (cur.rows[0].deleted_at) {
        // Already soft-deleted — return success, no audit row.
        await client.query('ROLLBACK')
        return NextResponse.json({ ok: true, alreadyDeleted: true })
      }

      await client.query(
        `UPDATE vendors SET deleted_at = NOW() WHERE id = $1`,
        [id]
      )

      await client.query('COMMIT')

      logAdminAction(auth.userId, 'soft_delete_vendor', req, {
        targetType: 'vendor',
        targetId: id,
      })

      return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor soft-delete error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
