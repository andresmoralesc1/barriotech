import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { isUuid } from '@/lib/core/utils/slug'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'

/**
 * GET /api/vendors/[id]/catalog — public catalog for sharing via WhatsApp.
 * Returns vendor info + available products in a compact format for wa.me text.
 *
 * No auth required — this is public data intended to be shared.
 * Rate-limited via middleware / proxy at the edge.
 */
export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const vendorId = params.id

  // vendors.id is a UUID column — reject malformed values before the DB
  // throws "invalid input syntax for type uuid" (which would 500).
  if (!isUuid(vendorId)) {
    return NextResponse.json({ error: 'Vendor no encontrado' }, { status: 404 })
  }

  try {
    const vendorRes = await pool.query(
      `SELECT id, name, slug, category, description, phone, city_id, photo_url
       FROM vendors
       WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [vendorId]
    )
    if (vendorRes.rows.length === 0) {
      return NextResponse.json({ error: 'Vendor no encontrado' }, { status: 404 })
    }

    const v = vendorRes.rows[0]

    // Note: products are hard-deleted via DELETE /api/products/[id]; the
// products table has no soft-delete flag. Catalog returns all rows for
// the requested vendor; deleted products simply don't exist anymore.
    const productsRes = await pool.query(
      `SELECT p.id, p.name, p.description, p.price, p.photo_url,
              COALESCE(
                (SELECT json_agg(json_build_object('id', pp.id, 'url', pp.url) ORDER BY pp.position)
                 FROM product_photos pp WHERE pp.product_id = p.id),
                '[]'::json
              ) AS photos
       FROM products p
       WHERE p.vendor_id = $1
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [vendorId]
    )

    return NextResponse.json({
      vendor: {
        id: v.id,
        name: v.name,
        category: v.category,
        description: v.description,
        phone: v.phone,
        city_id: v.city_id,
        photoUrl: v.photo_url,
      },
      products: productsRes.rows,
      shareUrl: `/vendedor/${v.slug ?? v.id}`,
    })
  } catch (err) {
    logger.error(serializeErr(err), 'GET catalog error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}