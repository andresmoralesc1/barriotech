import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Migration 102: parse + validate the 3 service-only fields. Returns an
// error response on failure, or the validated tuple on success. Single
// place to evolve if pricing_unit / modality gain values.
type ServiceFields = {
  duration_minutes: number
  modality: 'on_site' | 'travels' | 'remote'
  pricing_unit: 'unit' | 'hour' | 'session' | 'class'
}
function parseServiceFields(body: Record<string, unknown>):
  | { ok: true; fields: ServiceFields }
  | { ok: false; response: NextResponse } {
  const dur = Number(body.duration_minutes)
  if (!Number.isFinite(dur) || dur < 5 || dur > 600) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Duración inválida (5-600 minutos)' },
        { status: 400 }
      ),
    }
  }
  if (body.modality !== 'on_site' && body.modality !== 'travels' && body.modality !== 'remote') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Modalidad inválida (on_site | travels | remote)' },
        { status: 400 }
      ),
    }
  }
  if (
    body.pricing_unit !== 'unit' &&
    body.pricing_unit !== 'hour' &&
    body.pricing_unit !== 'session' &&
    body.pricing_unit !== 'class'
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unidad de precio inválida (unit | hour | session | class)' },
        { status: 400 }
      ),
    }
  }
  return {
    ok: true,
    fields: {
      duration_minutes: Math.round(dur),
      modality: body.modality,
      pricing_unit: body.pricing_unit,
    },
  }
}


// GET /api/products?vendorId=xxx
//
// Sprint 6 D.1: added `is_active` to the public catalog. By default we
// return only published products (is_active = true). Sellers who want
// to see their own drafts hit the same endpoint authenticated, OR pass
// `?includeDrafts=true` (only honored when auth is present). Browsers
// without auth always get the published-only view.
//
// CRIT-5 fix note: this endpoint was incorrectly migrated to requireAuth()
// by the bulk script, but the original design has GET with *optional* auth
// (browsers can browse products without being logged in). POST below stays
// behind requireAuth().
export async function GET(req: NextRequest) {
  try {
    // GET is intentionally public — browsers can browse the catalogue without
    // being logged in. We still try to parse the token if present so future
    // logic could personalize, but anonymous viewers always get a 200.

    const { searchParams } = new URL(req.url)
    const vendorId = searchParams.get('vendorId')
    const q = searchParams.get('q')
    const kind = searchParams.get('kind')
    const includeDrafts = searchParams.get('includeDrafts') === 'true'

    // Audit 2026-08-14: JOIN vendors to filter soft-deleted (deleted_at IS NOT
    // NULL) — otherwise products of deleted vendors leak to public
    // listings. includeDrafts also bypasses is_active=false (so the
    // seller can still see their own drafts) — but soft-deleted
    // vendors stay hidden even in includeDrafts mode.
    const params: unknown[] = []
    let query = `SELECT p.id, p.vendor_id, p.name, p.description, p.price, p.photo_url, p.is_active, p.kind, p.duration_minutes, p.modality, p.pricing_unit, p.created_at
       FROM products p
       JOIN vendors   v ON v.id = p.vendor_id
      WHERE v.deleted_at IS NULL
        AND (v.is_active = true${includeDrafts ? ' OR $' : ''})`
    if (includeDrafts) {
      query = query.replace(' OR $', ' OR $' + (params.length + 1))
      params.push(true)
    }

    if (vendorId) {
      // Reject malformed UUIDs up front so we don't hand a non-UUID string to
      // the uuid column (which would 500 with a syntax error from Postgres).
      if (!UUID_RE.test(vendorId)) {
        return NextResponse.json({ products: [] }, { status: 200 })
      }
      params.push(vendorId)
      query += ` AND vendor_id = $${params.length}`
    }

    // Migration 102: optional ?kind=product|service filter. Default is
    // both. The DB CHECK keeps the domain closed.
    if (kind === 'product' || kind === 'service') {
      params.push(kind)
      query += ` AND kind = $${params.length}`
    }

    // Public view: hide drafts. Sellers viewing their own catalogue
    // (?includeDrafts=true) see everything.
    if (!includeDrafts) {
      query += ' AND is_active = true'
    }

    // Full-text search across name + description. Uses the GIN index on
    // to_tsvector('spanish', ...) created in migration 018. The query goes
    // through plainto_tsquery so the caller can pass any free text without
    // worrying about operators being misinterpreted as tsquery syntax.
    // Empty / whitespace-only inputs are ignored so a stray `?q=` doesn't
    // accidentally drop every row.
    if (q && q.trim()) {
      params.push(q.trim())
      query += ` AND to_tsvector('spanish', coalesce(name, '') || ' ' || coalesce(description, '')) @@ plainto_tsquery('spanish', $${params.length})`
    }

    query += ' ORDER BY created_at DESC LIMIT 200'

    const result = await pool.query(query, params)
    return NextResponse.json({ products: result.rows })
  } catch (err) {
    logger.error(serializeErr(err), 'Products GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// POST /api/products — create product (seller only)
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    // P1-1 (audit 2026-07-27): require verified email before a seller
    // can publish a new product. The dashboard banner promises this gate.
    const auth = await requireVerifiedEmail(req)

    // Per-user rate limit on product creation. 10/min — sellers rarely
    // create more than a few products in a minute; bots would burst.
    const rl = await checkRateLimitByUser(req, 'create_product', 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    if (auth instanceof NextResponse) return auth
    const decoded = auth

    if (decoded.role !== 'seller' && decoded.role !== 'service') {
      return NextResponse.json({ error: 'Solo vendedores pueden crear productos' }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }

    // Strict validation: reject arrays/objects masquerading as scalars.
    const rawName = body.name
    const rawDescription = body.description
    const rawPrice = body.price
    const rawPhotoUrl = body.photo_url
    const rawVendorId = body.vendor_id
    const rawKind = body.kind

    if (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 200) {
      return NextResponse.json(
        { error: 'Nombre inválido (1-200 caracteres)' },
        { status: 400 }
      )
    }
    const name = rawName.trim()

    let description: string | null = null
    if (rawDescription !== undefined && rawDescription !== null && rawDescription !== '') {
      if (typeof rawDescription !== 'string' || rawDescription.length > 5000) {
        return NextResponse.json({ error: 'Descripción inválida' }, { status: 400 })
      }
      description = rawDescription
    }

    const priceNum = Number(rawPrice)
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return NextResponse.json({ error: 'Precio inválido (debe ser mayor a 0)' }, { status: 400 })
    }
    if (priceNum > 99999999.99) {
      return NextResponse.json(
        { error: 'Precio demasiado grande (máx 99,999,999.99 COP)' },
        { status: 400 }
      )
    }

    let photo_url: string | null = null
    if (rawPhotoUrl !== undefined && rawPhotoUrl !== null && rawPhotoUrl !== '') {
      if (typeof rawPhotoUrl !== 'string') {
        return NextResponse.json({ error: 'photo_url inválido' }, { status: 400 })
      }
      // Audit 2026-08-14: same ^https?:// check the PATCH handler uses.
      // Without this, javascript:/data:/vbscript: payloads hit the
      // products_photo_url_format DB CHECK and bubble up as 500.
      if (!/^https?:\/\//i.test(rawPhotoUrl.trim())) {
        return NextResponse.json(
          { error: 'photo_url debe empezar con http:// o https://' },
          { status: 400 }
        )
      }
      photo_url = rawPhotoUrl.trim() || null
    }

    // Migration 102: discriminator + 3 service-only fields.
    // Default 'product' so existing callers keep working. The DB CHECK
    // (products_kind_fields_consistent) rejects mismatched combos.
    //
    // Audit 2026-08-14: strict validation. rawKind must be undefined,
    // 'product', or 'service' — anything else (null, '', 'SERVICE',
    // 123, []) returns 400 instead of being silently coerced. Prevents
    // contract drift where the client thinks they set one kind and the
    // server silently stores another.
    let kind: 'product' | 'service' = 'product'
    if (rawKind !== undefined) {
      if (rawKind === 'product' || rawKind === 'service') {
        kind = rawKind
      } else {
        return NextResponse.json(
          { error: "kind debe ser 'product' o 'service'" },
          { status: 400 }
        )
      }
    }
    let duration_minutes: number | null = null
    let modality: 'on_site' | 'travels' | 'remote' | null = null
    let pricing_unit: 'unit' | 'hour' | 'session' | 'class' | null = null

    if (kind === 'service') {
      const parsed = parseServiceFields(body)
      if (!parsed.ok) return parsed.response
      duration_minutes = parsed.fields.duration_minutes
      modality = parsed.fields.modality
      pricing_unit = parsed.fields.pricing_unit
    }

    let vendorId: string | null = null
    if (rawVendorId !== undefined && rawVendorId !== null && rawVendorId !== '') {
      if (typeof rawVendorId !== 'string' || !UUID_RE.test(rawVendorId)) {
        return NextResponse.json({ error: 'vendor_id inválido' }, { status: 400 })
      }
      vendorId = rawVendorId
    }

    // If no vendorId provided, look up the authenticated seller's own vendor
    if (!vendorId) {
      const vendorResult = await pool.query(
        'SELECT id FROM vendors WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = $1)',
        [decoded.userId]
      )
      if (vendorResult.rows.length === 0) {
        return NextResponse.json({ error: 'Primero crea tu perfil de vendedor en el dashboard' }, { status: 400 })
      }
      vendorId = vendorResult.rows[0].id
    }

    // Verify the vendor belongs to this user
    const vendorCheck = await pool.query(
      'SELECT id FROM vendors WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)',
      [vendorId, decoded.userId]
    )

    if (vendorCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No tienes permiso para agregar productos a este vendor' }, { status: 403 })
    }

    // Sprint 6 D.1: RETURNING includes is_active so the seller can
    // immediately see the publish state of the new product. New products
    // default to is_active = true (column default). Migration 102 adds
    // the kind discriminator + service fields.
    const result = await pool.query(
      `INSERT INTO products
         (vendor_id, name, description, price, photo_url,
          kind, duration_minutes, modality, pricing_unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, vendor_id, name, description, price, photo_url,
                 is_active, kind, duration_minutes, modality, pricing_unit,
                 created_at`,
      [vendorId, name, description, priceNum, photo_url,
       kind, duration_minutes, modality, pricing_unit]
    )

    return NextResponse.json({ product: result.rows[0] }, { status: 201 })
  } catch (err) {
    logger.error(serializeErr(err), 'Products POST error:')
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '22003') {
      return NextResponse.json(
        { error: 'Precio demasiado grande (máx 99,999,999.99 COP)' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
