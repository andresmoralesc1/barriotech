import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { isTokenRevoked } from '@/lib/auth-db'
import pool from '@/lib/db'


// GET /api/vendors/[id]/stats — owner-only vendor stats
export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise

  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
    const userId = auth.userId

    const vendorId = params.id

    // 1) Verify ownership + fetch vendor fields needed for the ranking query.
    //    We fold the rating lookup into the same query that already hits the
    //    vendors table, saving one round-trip.
    const ownerCheck = await pool.query(
      `SELECT id, name, description, category, city_id, rating, review_count, photo_url
       FROM vendors
       WHERE id = $1
         AND deleted_at IS NULL
         AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [vendorId, userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 })
    }
    const vendor = ownerCheck.rows[0]

    // 2) Fire the four independent COUNTs in parallel — each only depends on
    //    vendorId, none on each other. The ranking query is conditional on
    //    city_id existing, so it's started in the same Promise.all.
    const [
      ordersResult,
      viewsTodayResult,
      weeklyViewsResult,
      weeklyOrdersResult,
      rankingResult,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM orders
         WHERE vendor_id = $1 AND status != 'cancelled'`,
        [vendorId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM vendor_views
         WHERE vendor_id = $1 AND DATE(viewed_at) = CURRENT_DATE`,
        [vendorId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM vendor_views
         WHERE vendor_id = $1 AND viewed_at > NOW() - INTERVAL '7 days'`,
        [vendorId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM orders
         WHERE vendor_id = $1
           AND status != 'cancelled'
           AND created_at > NOW() - INTERVAL '7 days'`,
        [vendorId]
      ),
      vendor.city_id
        ? pool.query(
            `WITH vendor_scores AS (
              SELECT
                v.id,
                (
                  COALESCE((
                    SELECT COUNT(*) FROM orders o
                    WHERE o.vendor_id = v.id AND o.status != 'cancelled' AND o.created_at > NOW() - INTERVAL '7 days'
                  ), 0) * 2
                  + COALESCE((
                    SELECT COUNT(*) FROM vendor_views vv
                    WHERE vv.vendor_id = v.id AND vv.viewed_at > NOW() - INTERVAL '7 days'
                  ), 0) * 0.1
                  + COALESCE(v.rating, 0) * 5
                ) AS score
              FROM vendors v
              WHERE v.category = $1 AND v.city_id = $2 AND v.is_active = TRUE AND v.deleted_at IS NULL
            ),
            ranked AS (
              SELECT id, score,
                PERCENT_RANK() OVER (ORDER BY score ASC) AS pct_rank
              FROM vendor_scores
            )
            SELECT pct_rank FROM ranked WHERE id = $3`,
            [vendor.category, vendor.city_id, vendorId]
          )
        : Promise.resolve({ rows: [] as Array<{ pct_rank: number | null }> }),
    ])

    let rankPercentile: number | undefined
    if (vendor.city_id && rankingResult.rows.length > 0) {
      const pct = Number(rankingResult.rows[0].pct_rank)
      // pct_rank: 0 = lowest score (worst), 1 = highest (best). Invert so
      // rankPercentile: 1% = top, 50% = median.
      rankPercentile = Math.round((1 - pct) * 100) || 1
    }

    return NextResponse.json({
      vendorName: vendor.name,
      description: vendor.description,
      category: vendor.category,
      photoUrl: vendor.photo_url,
      totalOrders: Number(ordersResult.rows[0].total),
      viewsToday: Number(viewsTodayResult.rows[0].total),
      weeklyViews: Number(weeklyViewsResult.rows[0].total),
      weeklyOrders: Number(weeklyOrdersResult.rows[0].total),
      rating: Number(vendor.rating ?? 0),
      reviewCount: Number(vendor.review_count ?? 0),
      rankPercentile,
    })
  } catch (err) {
    logger.error(serializeErr(err), 'Stats error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}