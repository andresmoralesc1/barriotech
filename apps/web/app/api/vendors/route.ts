import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { isOpenNow } from '@/lib/business-hours'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { parseVendorFilters, buildVendorWhereClause } from './filters'
import { generateUniqueSlug } from '@/lib/vendor-slug'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'

// Public: GET /api/vendors
//
// Query params:
//   category       filter by category id
//   active=true    only vendors currently streaming GPS
//   withLocation   only vendors with lat/lng
//   cityId         filter by city
//   vehicleType    filter by vehicle type (bicicleta|moto|carro|pie|triciclo|otro)
//   bbox=lat1,lng1,lat2,lng2   bounding box for map view (minLat,minLng,maxLat,maxLng)
//
// Sponsored vendors (active sponsorships) are returned FIRST.
// Response shape: { vendors: [...], ads: [...], sponsoredCount, totalCount }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    // Filter parsing + WHERE-clause construction are in ./filters — keeps the
    // list and count queries in sync (was previously duplicated with a
    // "keep this in sync" comment that was begging to be refactored).
    const filters = parseVendorFilters(searchParams)

  // Pagination — capped at 500 to keep the map query bounded.
  // Default 200 is what the map page typically renders in a single viewport.
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

  const { where: filterWhere, args: filterArgs } = buildVendorWhereClause(filters)
  // limit/offset placeholders come after the filter args.
  const limitIdx = filterArgs.length + 1
  const offsetIdx = filterArgs.length + 2

  const query = `
    SELECT v.*, c.label AS category_label
    FROM vendors_with_sponsorship v
    LEFT JOIN categories c ON v.category = c.id
    WHERE 1=1 ${filterWhere}
    ORDER BY v.is_sponsored DESC, COALESCE(v.location_updated_at, v.created_at) DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `
  const result = await pool.query(query, [...filterArgs, limit, offset])
    // ads is a VIEW (see migrations/014_ads_view_and_seed.sql) backed by
    // ad_campaigns. Window filter is applied here, not in the view, so admin
    // tooling can still SELECT paused/expired rows.
    const adsResult = await pool.query(`
      SELECT id, brand_name, image_url, target_url
      FROM ads
      WHERE is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
      ORDER BY priority DESC, created_at DESC
      LIMIT 5
    `)
    const ads = adsResult.rows.map((a) => ({
      id: a.id,
      brandName: a.brand_name,
      imageUrl: a.image_url,
      targetUrl: a.target_url,
    }))

    // Phone is public — vendors publish their number so buyers can reach them.
    // No redaction by viewer: if a vendor wants to stay unreachable, they leave
    // `phone` NULL at registration.
    //
    // GPS-005: `isActive` in the response is now derived from BOTH the DB
    // flag AND the recency of the last GPS ping. The DB column tells us
    // "the seller has the toggle on"; the timestamp tells us "they've
    // actually been seen in the last 5 minutes". Returning `true` when
    // one is fresh but the other is stale was the source of the "ghost
    // vendors" bug reported by buyers in the SSE sprint review.
    //
    // `locationFresh` is also exposed so the client can render a separate
    // "online recently" badge distinct from the manual toggle state (e.g.
    // a vendor who toggled off 6 minutes ago should not show up as
    // isActive=true just because their cached coords are still in the
    // DB row).
    // GPS-005 (original): `isActive` was the AND of `is_active` and
    // `locationFresh`. Sprint 11 B-AUTH-3 (2026-07-24): changed to
    // `is_active` alone. The previous AND meant that freshly-registered
    // sellers (who haven't reported a GPS ping yet) never showed up on
    // the buyer map, even after they explicitly toggled themselves
    // active. That's a fundamental funnel break: a seller who finished
    // onboarding but is in a coverage hole would be invisible for hours
    // until their first GPS ping. The new behavior:
    //   - `isActive` = the seller's manual toggle (the DB column)
    //   - `locationFresh` = whether the seller pinged GPS in the last
    //     5 min (an orthogonal concern)
    // The buyer map filters on `isActive` (active vendors show up).
    // The "online recently" badge in the map uses `locationFresh`
    // separately. This decouples "I want to be visible" from "my
    // phone has GPS signal right now".
    const FIVE_MINUTES_MS = 5 * 60 * 1000
    const now = Date.now()
    const vendors = result.rows.map((v) => {
      const lastPingMs = v.location_updated_at
        ? new Date(v.location_updated_at).getTime()
        : 0
      const locationFresh = lastPingMs > 0 && now - lastPingMs < FIVE_MINUTES_MS
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        description: v.description,
        category: v.category,
        categoryLabel: v.category_label,
        latitude: v.latitude,
        longitude: v.longitude,
        isActive: Boolean(v.is_active),
        locationFresh,
        locationUpdatedAt: v.location_updated_at,
        isVerified: v.is_verified,
        rating: v.rating,
        reviewCount: v.review_count,
        photoUrl: v.photo_url,
        phone: v.phone || null,
        cityId: v.city_id,
        vehicleType: v.vehicle_type,
        vehiclePhotoUrl: v.vehicle_photo_url,
        businessHoursEnabled: v.business_hours_enabled,
        businessHoursStart: v.business_hours_start,
        businessHoursEnd: v.business_hours_end,
        businessDays: v.business_days,
        stationType: v.station_type,
        isSponsored: v.is_sponsored,
        isOpenNow: isOpenNow(
          v.business_hours_start,
          v.business_hours_end,
          v.business_days,
        ),
      }
    })

    // Total count: same WHERE clause (already built above), no LIMIT/OFFSET.
  // Reusing buildVendorWhereClause means the count can never drift from the
  // list — the old inline buildWhere was the source of a past "syntax error
  // at or near AND" bug.
  const totalCountResult = await pool.query(
    `SELECT COUNT(*)::int AS n FROM vendors_with_sponsorship v WHERE 1=1 ${filterWhere}`,
    filterArgs
  )

    const sponsoredCount = vendors.filter((v) => v.isSponsored).length

    return NextResponse.json(
      {
        vendors,
        ads,
        sponsoredCount,
        totalCount: totalCountResult.rows[0]?.n ?? vendors.length,
        limit,
        offset,
      },
      {
        // Public listing is cheap to cache; CDNs/edge can serve 60s + SWR 5min.
        // Phone is public on this endpoint (same as /api/vendors/[id]).
        headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300' },
      }
    )
  } catch (err) {
    logger.error(serializeErr(err), 'Vendors GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * POST /api/vendors — create a new vendor owned by the authenticated seller.
 *
 * Auth: seller or admin (requireAuth). Returns 403 for buyers, 401 for anonymous.
 *
 * Body (all required unless marked optional):
 *   {
 *     name:           string (1..80 chars, trimmed)
 *     category:       one of categories.id (server-side validated)
 *     station_type:   'fixed' | 'mobile'  (default: 'mobile')
 *     description?:   string (max 500 chars)
 *     city_id?:       string (cities.id)  — optional but encouraged
 *     phone?:         string (digits, optional — surfaced to buyer map only
 *                                 for the vendor owner)
 *     latitude?:      number (-90..90)
 *     longitude?:     number (-180..180)
 *   }
 *
 * Behavior:
 *   - Resolves the caller's profile_id (vendors.profile_id FKs to profiles.id).
 *   - If the user already owns at least one vendor, returns 409 Conflict (each
 *     seller manages one storefront; multi-vendor is a separate decision and
 *     currently not in scope).
 *   - Generates slug from name + city_id (lowercase, dash-separated, deduped
 *     with a numeric suffix on collision).
 *   - Inserts as `is_active = false` — the vendor starts hidden and the user
 *     opts in via VendorVisibility toggle. This is intentional: forcing
 *     `is_active = true` on creation produced ghost pins in the past.
 *   - Returns the full vendor row so the client can navigate straight to
 *     the dashboard without an extra round-trip.
 *
 * Why this endpoint was missing:
 *   Migration 009 deleted orphan vendors with `profile_id IS NULL`. The 8
 *   surviving vendors are seed/test data with valid profile_ids. No UI path
 *   existed to create a *new* vendor from a freshly registered seller, so
 *   sellers could register but never convert — funnel conversion 0%.
 *   This endpoint closes that hole.
 */
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
    // auth.role is 'buyer' | 'seller' per TokenPayload — only sellers create vendors.
    if (auth.role !== 'seller') {
      return NextResponse.json(
        { error: 'Solo vendedores pueden crear un puesto' },
        { status: 403 }
      )
    }

    // Email verification gate — DISABLED 2026-07-22 (feature-paused, NOT deleted).
    // The original rationale was: vendors are public-facing entities that
    // appear on the map and receive orders; a user squatting on a stranger's
    // email can be removed only by the real owner once they verify.
    // Until verification is re-enabled, new users are created with
    // email_verified=true so this gate is a no-op for them. We still
    // query the column to keep the code path hot in case we want to
    // flip it back on — just don't block on the result.
    //
    // To re-enable: uncomment the `if (verified.rows[0]?.email_verified === false)`
    // branch below.
    // ──────────────────────────────────────────────────────────────────
    // Re-enabled 2026-07-27 (audit C1): email verification is now
    // required to create a vendor profile. Frontend renders the
    // verify-email banner when this returns requiresEmailVerification,
    // so the UX path is already wired.
    const verified = await pool.query(
      'SELECT email_verified FROM users WHERE id = $1',
      [auth.userId]
    )
    if (verified.rows[0]?.email_verified === false) {
      return NextResponse.json(
        {
          error: 'Verifica tu email antes de crear un puesto.',
          requiresEmailVerification: true,
        },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<Record<string, unknown>>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const body = parsed.body
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body debe ser un objeto' }, { status: 400 })
    }
    const bodyObj = body

    // ── Field validation ────────────────────────────────────────────────
    const name = typeof bodyObj.name === 'string' ? bodyObj.name.trim() : ''
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json(
        { error: 'El nombre debe tener entre 1 y 80 caracteres' },
        { status: 400 }
      )
    }

    const category = typeof bodyObj.category === 'string' ? bodyObj.category.trim() : ''
    const categoryCheck = await pool.query(
      'SELECT id FROM categories WHERE id = $1',
      [category]
    )
    if (category.length === 0 || categoryCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Categoría inválida' },
        { status: 400 }
      )
    }

    const rawStationType = (bodyObj.station_type ?? bodyObj.stationType) ?? 'mobile'
    if (rawStationType !== 'fixed' && rawStationType !== 'mobile') {
      return NextResponse.json(
        { error: 'stationType debe ser "fixed" o "mobile"' },
        { status: 400 }
      )
    }
    const stationType = rawStationType

    let description: string | null = null
    if (bodyObj.description !== undefined && bodyObj.description !== null) {
      if (typeof bodyObj.description !== 'string') {
        return NextResponse.json({ error: 'description debe ser texto' }, { status: 400 })
      }
      const trimmed = bodyObj.description.trim()
      if (trimmed.length > 500) {
        return NextResponse.json(
          { error: 'description máximo 500 caracteres' },
          { status: 400 }
        )
      }
      description = trimmed.length > 0 ? trimmed : null
    }

    let cityId: string | null = null
    // Accept both snake_case (city_id) and camelCase (cityId) so callers don't
    // silently drop the field. city_id is REQUIRED by the DB constraint; we
    // validate it here instead of letting Postgres 23514 bubble up as a 500.
    const rawCityId = (bodyObj.city_id ?? bodyObj.cityId) as unknown
    if (rawCityId === undefined || rawCityId === null || rawCityId === '') {
      return NextResponse.json(
        { error: 'cityId es requerido' },
        { status: 400 }
      )
    }
    if (typeof rawCityId !== 'string') {
      return NextResponse.json(
        { error: 'cityId debe ser texto' },
        { status: 400 }
      )
    }
    const cityCheck = await pool.query(
      'SELECT id FROM cities WHERE id = $1',
      [rawCityId]
    )
    if (cityCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Ciudad inválida' },
        { status: 400 }
      )
    }
    cityId = rawCityId

    let phone: string | null = null
    const rawPhone = bodyObj.phone ?? bodyObj.phoneNumber
    if (rawPhone !== undefined && rawPhone !== null && rawPhone !== '') {
      if (typeof rawPhone !== 'string') {
        return NextResponse.json({ error: 'phone debe ser texto' }, { status: 400 })
      }
      const digits = rawPhone.replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) {
        return NextResponse.json(
          { error: 'phone debe tener entre 7 y 15 dígitos' },
          { status: 400 }
        )
      }
      phone = digits
    }

    let latitude: number | null = null
    let longitude: number | null = null
    if (bodyObj.latitude !== undefined && bodyObj.latitude !== null) {
      const lat = Number(bodyObj.latitude)
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return NextResponse.json(
          { error: 'latitude debe estar entre -90 y 90' },
          { status: 400 }
        )
      }
      latitude = lat
    }
    if (bodyObj.longitude !== undefined && bodyObj.longitude !== null) {
      const lng = Number(bodyObj.longitude)
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return NextResponse.json(
          { error: 'longitude debe estar entre -180 y 180' },
          { status: 400 }
        )
      }
      longitude = lng
    }
    // Reject partial coordinate pairs (lat without lng or vice versa)
    if ((latitude === null) !== (longitude === null)) {
      return NextResponse.json(
        { error: 'latitude y longitude deben venir juntos o ambos omitirse' },
        { status: 400 }
      )
    }

    // ── Resolve profile ─────────────────────────────────────────────────
    const profileRes = await pool.query(
      'SELECT id FROM profiles WHERE user_id = $1',
      [auth.userId]
    )
    if (profileRes.rows.length === 0) {
      logger.error(
        { userId: auth.userId },
        'POST /api/vendors: seller has no profile row (data integrity bug)'
      )
      return NextResponse.json(
        { error: 'Perfil no encontrado. Contactá soporte.' },
        { status: 500 }
      )
    }
    const profileId = profileRes.rows[0].id

    // ── Conflict: one vendor per seller (current scope) ─────────────────
    const existing = await pool.query(
      'SELECT id, name FROM vendors WHERE profile_id = $1 LIMIT 1',
      [profileId]
    )
    if (existing.rows.length > 0) {
      return NextResponse.json(
        {
          error: 'Ya tenés un puesto creado',
          vendor: { id: existing.rows[0].id, name: existing.rows[0].name },
        },
        { status: 409 }
      )
    }

    // ── Slug generation ─────────────────────────────────────────────────
    const slug = await generateUniqueSlug(pool, name, cityId)

    // ── Insert ──────────────────────────────────────────────────────────
    const insertSql = `
      INSERT INTO vendors (
        profile_id, name, slug, category, description,
        city_id, latitude, longitude, station_type,
        phone, is_active, is_verified, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, false, NOW())
      RETURNING id, profile_id, name, slug, category, description,
                city_id, latitude, longitude, station_type, phone,
                is_active, is_verified, created_at
    `
    const insertParams = [
      profileId, name, slug, category, description,
      cityId, latitude, longitude, stationType, phone,
    ]
    const result = await pool.query(insertSql, insertParams)
    const v = result.rows[0]

    logger.info(
      { userId: auth.userId, vendorId: v.id, slug: v.slug },
      'vendor.created'
    )

    return NextResponse.json(
      {
        vendor: {
          id: v.id,
          profileId: v.profile_id,
          name: v.name,
          slug: v.slug,
          category: v.category,
          description: v.description,
          cityId: v.city_id,
          latitude: v.latitude,
          longitude: v.longitude,
          stationType: v.station_type,
          phone: v.phone,
          isActive: v.is_active,
          isVerified: v.is_verified,
          createdAt: v.created_at,
        },
      },
      { status: 201 }
    )
  } catch (err) {
    logger.error(serializeErr(err), 'Vendors POST error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Resolve the viewer's profile_id from a token, if present. Used by GET to
 * gate the `phone` field. Returns null when unauthenticated or buyer-only.
 */
async function resolveViewerId(req: NextRequest): Promise<string | null> {
  const { getTokenFromRequest } = await import('@/lib/auth-edge')
  const token = getTokenFromRequest(req)
  if (!token) return null
  try {
    const { verifyTokenEdge } = await import('@/lib/auth-edge')
    const decoded = await verifyTokenEdge(token)
    if (!decoded) return null
    const r = await pool.query('SELECT id FROM profiles WHERE user_id = $1', [decoded.userId])
    return r.rows[0]?.id ?? null
  } catch {
    return null
  }
}

// generateUniqueSlug moved to @/lib/vendor-slug so the register flow can
// reuse it without pulling in the whole /api/vendors route module.
