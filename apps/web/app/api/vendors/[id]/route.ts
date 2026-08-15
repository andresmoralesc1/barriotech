import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { verifyToken, getTokenFromRequest, requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { isUuid } from '@/lib/core/utils/slug'
import { isOpenNow } from '@/lib/business-hours'
import { parseJsonBody } from '@/lib/parse-json'
import { normalizePhone } from '@/lib/auth-helpers'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'


type RouteContext = {
  params: Promise<{ id: string }>
}

// GET /api/vendors/[id]
// Accepts either a vendor UUID (legacy) or a human-friendly slug
// (e.g. "frutas-don-jaime-cali"). UUIDs still work for backward-compat.
//
// Slug column is filled by migration 003_vendor_slugs.sql.
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: param } = await context.params
    const isUuidParam = isUuid(param)

    // If the caller is hitting the page (Accept: text/html) with a UUID,
    // 301-redirect to the canonical slug URL. This is what makes the
    // browser URL bar show the slug version when someone pastes a legacy link.
    const accept = req.headers.get('accept') || ''
    if (isUuidParam && accept.includes('text/html')) {
      const slugResult = await pool.query(
        'SELECT slug FROM vendors WHERE id = $1 AND deleted_at IS NULL',
        [param]
      )
      const slug = slugResult.rows[0]?.slug
      if (slug) {
        const url = new URL(`/vendor/${slug}`, req.url)
        return NextResponse.redirect(url, 301)
      }
    }

    const vendorResult = await pool.query(
      `SELECT v.*, c.label as category_label
       FROM vendors v
       LEFT JOIN categories c ON v.category = c.id
       WHERE ${isUuidParam ? 'v.id = $1' : 'v.slug = $1'}
         AND v.deleted_at IS NULL`,
      [param]
    )

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
    }

    const vendor = vendorResult.rows[0]
    const vendorId: string = vendor.id

    // Phone is always public. BarrioTech's model is that vendors publish their
    // contact info so buyers can reach them — contact-info redaction was
    // over-engineering without a written privacy analysis. If a vendor
    // doesn't want to be reached, they leave `phone` NULL at registration.

    // Fetch products + reviews in parallel (audit 2026-08-14 PERF-2).
    // Was 5 sequential await → 3 rounds. vendor_views INSERT stays
    // fire-and-forget so it doesn't block the response.
    const [productsResult, reviewsResult] = await Promise.all([
      pool.query(
        'SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
        [vendorId]
      ),
      pool.query(
        'SELECT * FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC',
        [vendorId]
      ),
    ])

    // Audit 2026-08-14 (PERF-4 / I4): vendor_views INSERT is now
    // fire-and-forget. Don't block the response on analytics writes
    // (was I4 from the perf audit). The .catch logs nothing —
    // analytics loss is acceptable for this single insert.
    const token = getTokenFromRequest(req)
    if (token) {
      verifyToken(token).then((decoded) => {
        if (!decoded) return
        return pool.query('SELECT 1 FROM consent_logs WHERE user_id = $1 LIMIT 1', [decoded.userId])
          .then((consentRes) => {
            if (consentRes.rows.length === 0) return
            return pool.query(
              'INSERT INTO vendor_views (vendor_id, user_id) VALUES ($1, $2)',
              [vendorId, decoded.userId]
            )
          })
      }).catch(() => {})
    }

    const reviews = reviewsResult.rows
    const avgRating = reviews.length > 0
      ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
      : 0

    // Return vendor in camelCase to match /api/vendors (consistency).
    // products and reviews stay snake_case here; the client already maps them
    // to its own Product/Review types on the way in (see VendorDetailClient.tsx).
    //
    // GPS-005: `isActive` derives from BOTH the toggle flag AND the recency
    // of the last GPS ping (see also /api/vendors/route.ts). Mirrored here
    // so the vendor detail page matches what the map shows — otherwise a
    // buyer could open a vendor card and see "Activo" while their map
    // marker is hidden, and vice versa.
    const FIVE_MINUTES_MS = 5 * 60 * 1000
    const lastPingMs = vendorResult.rows[0]?.location_updated_at
      ? new Date(vendorResult.rows[0].location_updated_at).getTime()
      : 0
    const locationFresh = lastPingMs > 0 && Date.now() - lastPingMs < FIVE_MINUTES_MS
    const vendorRow = vendorResult.rows[0]
    const camelVendor = {
      id: vendorRow.id,
      slug: vendorRow.slug,
      name: vendorRow.name,
      category: vendorRow.category,
      categoryLabel: vendorRow.category_label,
      description: vendorRow.description,
      phone: vendorRow.phone || null,
      photoUrl: vendorRow.photo_url,
      vehicleType: vendorRow.vehicle_type,
      vehiclePhotoUrl: vendorRow.vehicle_photo_url,
      stationType: vendorRow.station_type,
      isActive: (vendorRow.is_active ?? false) && locationFresh,
      locationFresh,
      isVerified: vendorRow.is_verified || false,
      businessHours: {
        enabled: vendorRow.business_hours_enabled || false,
        start: vendorRow.business_hours_start || null,
        end: vendorRow.business_hours_end || null,
        days: vendorRow.business_days || [],
      },
      isSponsored: vendorRow.is_sponsored || false,
      sponsoredUntil: vendorRow.sponsored_until,
      rating: avgRating,
      reviewCount: reviews.length,
      latitude: vendorRow.latitude != null ? Math.round(vendorRow.latitude * 1e6) / 1e6 : null,
      longitude: vendorRow.longitude != null ? Math.round(vendorRow.longitude * 1e6) / 1e6 : null,
      cityId: vendorRow.city_id,
      createdAt: vendorRow.created_at,
      locationUpdatedAt: vendorRow.location_updated_at,
      isOpen: !(vendorRow.business_hours_enabled || false) || isOpenNow(
        vendorRow.business_hours_start,
        vendorRow.business_hours_end,
        vendorRow.business_days
      ),
    }

    return NextResponse.json({
      vendor: camelVendor,
      products: productsResult.rows,
      reviews,
    })
  } catch (err) {
    logger.error(serializeErr(err), 'Vendor GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// PATCH /api/vendors/[id] — update vendor profile (owner only)
export async function PATCH(req: NextRequest, context: RouteContext) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const { id: vendorId } = await context.params

    if (!isUuid(vendorId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
// Per-user rate limit. 10/min — bursty but bounded.
const rl = await checkRateLimitByUser(req, 'delete_vendor', 10, 60_000)
if (!rl.allowed) {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  )}


    // Verify ownership
    const ownerCheck = await pool.query(
      'SELECT id FROM vendors WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)',
      [vendorId, auth.userId]
    )

    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No tienes permiso para editar este perfil' }, { status: 403 })
    }

    const parsed = await parseJsonBody<{
      name?: string; description?: string; category?: string;
      photo_url?: string; phone?: string; is_active?: boolean;
      // Sprint 11 B-AUTH-3 (2026-07-24): accept camelCase too. The frontend
      // (VendorFormSlide) sends `isActive`; the on-call admin tooling
      // sends `is_active`. Both must work.
      isActive?: boolean;
    }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    // isActive wins over is_active if both are sent — defensive against
    // a stale caller mixing them.
    const isActiveRaw =
      parsed.body.isActive !== undefined ? parsed.body.isActive : parsed.body.is_active
    const { name, description, category, photo_url, phone } = parsed.body

    const updates: string[] = []
    const params: unknown[] = []

    if (name !== undefined) {
      params.push(name)
      updates.push(`name = $${params.length}`)
    }
    if (description !== undefined) {
      params.push(description)
      updates.push(`description = $${params.length}`)
    }
    if (category !== undefined) {
      params.push(category)
      updates.push(`category = $${params.length}`)
    }
    if (photo_url !== undefined) {
      // CRIT-25: photo_url is rendered into the page (src=). Allow only http(s)
      // schemes to prevent stored XSS via javascript:/data: URLs. Validate
      // here at the API boundary; the React render already encodes, but defense
      // in depth is cheap.
      if (typeof photo_url !== 'string') {
        return NextResponse.json({ error: 'photo_url debe ser una cadena' }, { status: 400 })
      }
      if (!/^https?:\/\//i.test(photo_url)) {
        return NextResponse.json({ error: 'photo_url debe comenzar con http:// o https://' }, { status: 400 })
      }
      params.push(photo_url)
      updates.push(`photo_url = $${params.length}`)
    }
    if (phone !== undefined) {
      // CRIT-B1 (2026-07-23): sanitize phone on write so vendors.phone is
      // always digit-only in the DB. Call sites (wa.me, SMS, CSV exports)
      // all .replace(/\D/g, '') at read time, but storing dirty data
      // breaks integrations that don't sanitize (future SMS providers,
      // exports to Mercader CRM, etc.). If the user submits an invalid
      // phone we reject with 400 instead of silently dropping the update —
      // better than storing NULL and surprising them.
      if (typeof phone !== 'string') {
        return NextResponse.json({ error: 'phone debe ser una cadena' }, { status: 400 })
      }
      const trimmed = phone.trim()
      const cleanPhone = trimmed === '' ? null : normalizePhone(trimmed)
      if (trimmed !== '' && !cleanPhone) {
        return NextResponse.json(
          { error: 'Ingresa un número de teléfono colombiano válido (10 dígitos)' },
          { status: 400 }
        )
      }
      params.push(cleanPhone)
      updates.push(`phone = $${params.length}`)
    }
    if (isActiveRaw !== undefined) {
      if (typeof isActiveRaw !== 'boolean') {
        return NextResponse.json(
          { error: 'isActive debe ser booleano (true o false)' },
          { status: 400 },
        )
      }
      params.push(isActiveRaw)
      updates.push(`is_active = $${params.length}`)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No hay campos para actualizar' }, { status: 400 })
    }

    params.push(vendorId)
    const result = await pool.query(
      `UPDATE vendors SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    )

    return NextResponse.json({ vendor: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'Vendor PATCH error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
