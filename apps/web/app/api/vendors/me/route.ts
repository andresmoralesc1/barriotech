import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import pool from '@/lib/db'
import { COLOMBIA_CITIES } from '@/lib/core/constants/cities'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'

const VALID_CITY_IDS = new Set(COLOMBIA_CITIES.map((c) => c.id))

/**
 * GET /api/vendors/me
 *
 * Returns the calling seller's vendor(s), if any. Used by the dashboard to
 * pick the active vendor and populate the seller profile.
 *
 * Auth: required (seller). Non-sellers get 403; sellers with no vendor yet
 * get an empty `vendors` array (the dashboard then redirects to /onboarding).
 *
 * Shape (camelCase, matches what the dashboard reads in
 * apps/web/app/(seller)/dashboard/page.tsx):
 *   { vendors: Array<{ id, name, slug, category, description, photoUrl, ... }> }
 *
 * Note: prior version of this file exported a single handler named `GET` that
 * was actually a PATCH (it called req.json() and ran an UPDATE). Calling it as
 * GET returned HTTP 500 because the body parse failed. This file now exports
 * two distinct handlers: GET (read) and PATCH (update).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    if (auth.role !== 'seller') {
      return NextResponse.json({ error: 'Solo vendedores pueden acceder' }, { status: 403 })
    }

    // Join through profiles to filter vendors owned by this user. Returned in
    // created_at DESC so the dashboard's "pick first" logic surfaces the most
    // recently created vendor by default.
    const result = await pool.query(
      `SELECT v.id, v.name, v.slug, v.description, v.category, v.phone,
              v.photo_url, v.vehicle_type, v.vehicle_photo_url, v.station_type,
              v.is_active, v.is_verified, v.business_hours_enabled,
              v.business_hours_start, v.business_hours_end, v.business_days,
              v.latitude, v.longitude, v.city_id,
              v.created_at, v.location_updated_at,
              v.geo_mode, v.geo_zone_lat, v.geo_zone_lng, v.geo_zone_radius_m
       FROM vendors v
       JOIN profiles p ON p.id = v.profile_id
       WHERE p.user_id = $1
       ORDER BY v.created_at DESC`,
      [auth.userId]
    )

    // Map snake_case → camelCase for the client. Anything not listed here is
    // intentionally omitted (e.g. internal flags, raw IDs).
    //
    // Sprint 4 (UX mobile finishing, B6): each mapped vendor now carries a
    // `completionPercent` and `missingFields[]` so the SellerOnboardingBanner
    // (apps/web/components/SellerOnboardingBanner.tsx) can show "Tu puesto
    // está 40% completo — falta descripción y foto" instead of a generic
    // "completá el registro" CTA. The seller in the street doesn't have
    // bandwidth to open the dashboard and figure out what's missing.
    //
    // Scoring weights sum to 100. Anything that's checked but NULL on a
    // placeholder vendor counts as missing.
    const vendors = result.rows.map((v) => {
      const checks: Array<[string, boolean]> = [
        ['name', typeof v.name === 'string' && !v.name.startsWith('Mi negocio de ')],
        ['description', typeof v.description === 'string' && v.description.length >= 20],
        ['category', typeof v.category === 'string' && v.category.length > 0],
        ['phone', typeof v.phone === 'string' && v.phone.length >= 7],
        ['photo', typeof v.photo_url === 'string' && v.photo_url.length > 0],
        ['city', typeof v.city_id === 'string' && v.city_id.length > 0],
        ['location', typeof v.latitude === 'number' && typeof v.longitude === 'number'],
      ]
      const missingFields = checks.filter(([, ok]) => !ok).map(([name]) => name)
      const completionPercent = Math.round(
        ((checks.length - missingFields.length) / checks.length) * 100,
      )
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        description: v.description,
        category: v.category,
        phone: v.phone,
        photoUrl: v.photo_url,
        vehicleType: v.vehicle_type,
        vehiclePhotoUrl: v.vehicle_photo_url,
        stationType: v.station_type,
        isActive: v.is_active,
        isVerified: v.is_verified || false,
        businessHoursEnabled: v.business_hours_enabled || false,
        businessHoursStart: v.business_hours_start,
        businessHoursEnd: v.business_hours_end,
        businessDays: v.business_days || [],
        latitude: v.latitude,
        longitude: v.longitude,
        cityId: v.city_id,
        createdAt: v.created_at,
        locationUpdatedAt: v.location_updated_at,
        // Geo mode + zone (added so the dashboard can show the active GPS
        // cadence badge and so the client can pass the zone center back to
        // the periodic pinger without a second round-trip).
        geoMode: v.geo_mode || 'precise',
        geoZoneLat: v.geo_zone_lat,
        geoZoneLng: v.geo_zone_lng,
        geoZoneRadiusM: v.geo_zone_radius_m,
        // Sprint 4 additions — see comment block above.
        completionPercent,
        missingFields,
      }
    })

    return NextResponse.json({ vendors })
  } catch (err) {
    logger.error(serializeErr(err), 'Vendors/me GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

/**
 * PATCH /api/vendors/me
 *
 * Update the calling seller's vendor profile. The currently selected vendor
 * is used; multi-vendor users can pass ?vendorId=<uuid> but ownership is
 * still verified against the calling user.
 *
 * Body (all fields optional — only what you send gets updated):
 *   name, description, category, phone, cityId, isActive, photoUrl,
 *   vehicleType, vehiclePhotoUrl, stationType
 *
 * 'is_verified' is intentionally NOT here — only admins can verify vendors.
 */
export async function PATCH(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // M7 (audit 2026-07-27): cap vendor updates at 30/min per IP. The seller
  // dashboard's autosave-on-blur can spin several updates per session, but
  // any genuine edit loop is well under 30/min. Caps scripted abuse that
  // could reach for a credential-stuffing or geo-rotation DoS via the
  // self-update path.
  const ip = getClientIp(req)
  const { allowed, retryAfter } = await checkRateLimit(ip, 'vendor-update-self', 30, 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas actualizaciones. Intenta de nuevo en un momento.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  try {
    // P1-1 (audit 2026-07-27): require verified email before letting a
    // seller publish/edit a vendor profile. The EmailVerifyBanner on the
    // dashboard promises this gate; previously nothing enforced it, so a
    // freshly-registered user could publish a vendor the instant they
    // hit the form, banner still showing.
    const auth = await requireVerifiedEmail(req)
    if (auth instanceof NextResponse) return auth

    if (auth.role !== 'seller') {
      return NextResponse.json({ error: 'Solo vendedores pueden editar su perfil' }, { status: 403 })
    }

    // Resolve which vendor to update: explicit ?vendorId= must belong to the
    // caller; otherwise fall back to the first vendor they own.
    const url = new URL(req.url)
    const requestedVendorId = url.searchParams.get('vendorId')

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
    }

    // CRIT-18: validate city_id against the canonical list. Prevents typos or
    // missing values that would silently leave a vendor out of every city's
    // stream.
    if (body.cityId !== undefined && body.cityId !== null &&
        !VALID_CITY_IDS.has(body.cityId as string)) {
      return NextResponse.json(
        { error: 'cityId no válido. Debe ser uno de los códigos de ciudad soportados.' },
        { status: 400 }
      )
    }

    // Geo mode validation: only the two known values are accepted. Anything
    // else is silently dropped by the clientToDb map below, which would let
    // a typo (e.g. 'precisee') persist the old value without telling the
    // seller something went wrong.
    if (body.geoMode !== undefined && body.geoMode !== null &&
        body.geoMode !== 'precise' && body.geoMode !== 'battery') {
      return NextResponse.json(
        { error: 'geoMode debe ser "precise" o "battery"' },
        { status: 400 }
      )
    }

    // Validate zone radius range (matches DB CHECK constraint 100–5000).
    if (body.geoZoneRadiusM !== undefined && body.geoZoneRadiusM !== null) {
      const r = body.geoZoneRadiusM as number
      if (typeof r !== 'number' || r < 100 || r > 5000) {
        return NextResponse.json(
          { error: 'geoZoneRadiusM debe estar entre 100 y 5000 metros' },
          { status: 400 }
        )
      }
    }

    // Client camelCase → DB snake_case. Keys not in this map are ignored.
    const clientToDb: Record<string, string> = {
      name: 'name',
      description: 'description',
      category: 'category',
      phone: 'phone',
      cityId: 'city_id',
      isActive: 'is_active',
      photoUrl: 'photo_url',
      vehicleType: 'vehicle_type',
      vehiclePhotoUrl: 'vehicle_photo_url',
      stationType: 'station_type',
      // Geo mode (added in geo-mode sprint). Mode controls the periodic GPS
      // cadence on the dashboard; zone center + radius define the boundary
      // for battery mode (crossing it triggers an update).
      geoMode: 'geo_mode',
      geoZoneLat: 'geo_zone_lat',
      geoZoneLng: 'geo_zone_lng',
      geoZoneRadiusM: 'geo_zone_radius_m',
      // Lat/lng persisted when the seller places their pin in the manual
      // location picker on /profile/edit. Distinct from `geo_zone_lat/lng`
      // (battery mode anchor) — this is the vendor's own position.
      latitude: 'latitude',
      longitude: 'longitude',
    }

    const updates: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    for (const [clientKey, dbField] of Object.entries(clientToDb)) {
      if (body[clientKey] !== undefined) {
        updates.push(`${dbField} = $${paramIndex}`)
        values.push(body[clientKey])
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No se proporcionaron campos para actualizar' }, { status: 400 })
    }

    // Resolve vendor id with ownership check. We do it in SQL so a wrong
    // ?vendorId= from a non-owner never reaches the UPDATE.
    let vendorId: string | null = null
    if (requestedVendorId) {
      const ownerCheck = await pool.query(
        `SELECT v.id FROM vendors v
         JOIN profiles p ON p.id = v.profile_id
         WHERE v.id = $1 AND p.user_id = $2`,
        [requestedVendorId, auth.userId]
      )
      if (ownerCheck.rows.length === 0) {
        return NextResponse.json(
          { error: 'Vendedor no encontrado o no te pertenece' },
          { status: 404 }
        )
      }
      vendorId = ownerCheck.rows[0].id
    } else {
      const anyCheck = await pool.query(
        `SELECT v.id FROM vendors v
         JOIN profiles p ON p.id = v.profile_id
         WHERE p.user_id = $1
         ORDER BY v.created_at DESC
         LIMIT 1`,
        [auth.userId]
      )
      if (anyCheck.rows.length === 0) {
        return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
      }
      vendorId = anyCheck.rows[0].id
    }

    values.push(vendorId)
    const query = `UPDATE vendors SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`

    const result = await pool.query(query, values)
    return NextResponse.json({ vendor: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'Vendors/me PATCH error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
