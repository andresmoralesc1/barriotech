/**
 * Vendor filter parser + SQL builder for /api/vendors GET.
 *
 * Centralizes the WHERE-clause construction so the list query and the
 * count query can share filter logic without duplication. Before this
 * helper existed (2026-07-21 refactor), the count query re-built the
 * filter list inline, with a comment "keep this in sync with the filter
 * block above" — which was a classic copy-paste smell.
 */

export interface VendorFilters {
  category: string | null
  active: string | null
  withLocation: boolean
  cityId: string | null
  vehicleType: string | null
  bbox: string | null
  // Migration 102 (services) Phase A2: filter to vendors that have at
  // least one active service offering with the given modality. Only
  // matters for service categories (clases/bienestar/belleza/hogar/
  // eventos); a `comida` vendor with no services returns 0 rows
  // when modality is set, which is the correct behavior — the chip
  // is implicitly a service-only filter.
  modality: 'on_site' | 'travels' | 'remote' | null
  // Phase D1: free-text search. Today the client (MapView) does an
  // in-memory filter on vendor.name only. Server-side expansion:
  // match `q` against (a) vendor.name + description, and (b) the
  // name of any of the vendor's active products/services. Typing
  // "salsa" now finds "Academia Baquiano" because their offering
  // is called "Clases de salsa".
  q: string | null
}

/**
 * Parse filter values from URLSearchParams.
 * Returns plain values (already coerced) for use in buildVendorWhereClause.
 */
export function parseVendorFilters(searchParams: URLSearchParams): VendorFilters {
  const rawModality = searchParams.get('modality')
  const modality: 'on_site' | 'travels' | 'remote' | null =
    rawModality === 'on_site' || rawModality === 'travels' || rawModality === 'remote'
      ? rawModality
      : null
  return {
    category: searchParams.get('category'),
    active: searchParams.get('active'),
    withLocation: searchParams.get('withLocation') === 'true',
    cityId: searchParams.get('cityId'),
    vehicleType: searchParams.get('vehicleType'),
    bbox: searchParams.get('bbox'),
    modality,
    q: (() => {
      const raw = searchParams.get('q')
      return raw && raw.trim() ? raw.trim() : null
    })(),
  }
}

interface WhereClause {
  /** SQL fragment starting with " AND ..." — concatenate after "WHERE 1=1". */
  where: string
  /** Positional params matching the `$N` placeholders in `where`. */
  args: unknown[]
}

/**
 * Build a WHERE clause fragment from vendor filters.
 *
 * Returns the fragment WITH a leading " AND" so it can be appended to
 * "WHERE 1=1" safely (returns "" if no filters apply, which still parses).
 *
 * @param filters  parsed filter values
 * @param startAt  the `$N` number to start placeholders at (defaults to 1).
 *                 Use a higher number when concatenating after other
 *                 placeholders in the same query.
 */
export function buildVendorWhereClause(filters: VendorFilters, startAt = 1): WhereClause {
  const w: string[] = []
  const a: unknown[] = []
  let i = startAt

  if (filters.category) {
    w.push(`AND v.category = $${i}`)
    a.push(filters.category)
    i++
  }
  if (filters.active === 'true') {
    // SPRINT 11 B-AUTH-3 (2026-07-24): reverted the GPS-004 location_fresh
    // requirement on the `active=true` filter. The original reasoning was
    // sound (don't show vendors whose phone has been backgrounded for
    // hours), but the implementation broke the seller funnel:
    //   1. A new seller registers and the auto-bootstrap creates a vendor
    //      row with `is_active = false` and no GPS ping.
    //   2. The onboarding flow toggles the vendor `is_active = true` so
    //      the buyer map can see them — but no GPS ping has happened yet.
    //   3. The previous filter `is_active AND location_updated_at >= now-5m`
    //      hid the seller from the map forever, until they happened to
    //      get a GPS signal (which on a 3G phone in a barrio might take
    //      ages).
    // The "online recently" concern is now exposed separately as
    // `locationFresh` in the response (see GET handler map). The map UI
    // uses that for the "Online" badge; the public listing is filtered on
    // the seller's manual toggle alone.
    w.push(`AND v.is_active = true`)
  }
  if (filters.withLocation) {
    // Phase E1: vendors without a fixed location can still appear on
    // the map if they're a service vendor with modality=travels or
    // modality=remote. A mobile hairdresser who travels to the client
    // doesn't need to publish their home address to be discoverable,
    // and a remote tutor doesn't have a "location" at all. Both
    // get rendered at the city center on the map (see MapView
    // city-wide pin handling).
    //
    // Product vendors (frutas/comida/etc) still REQUIRE a fixed
    // location — a fruit cart without a GPS ping has no map
    // presence, which is the right UX (the buyer can't walk to a
    // pin that's not on the map).
    w.push(`AND (
      (v.latitude IS NOT NULL AND v.longitude IS NOT NULL)
      OR v.category IN ('clases','bienestar','belleza','hogar','eventos')
    )`)
  }
  if (filters.cityId) {
    w.push(`AND v.city_id = $${i}`)
    a.push(filters.cityId)
    i++
  }
  if (filters.vehicleType) {
    w.push(`AND v.vehicle_type = $${i}`)
    a.push(filters.vehicleType)
    i++
  }
  if (filters.bbox) {
    const parts = filters.bbox.split(',').map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [minLat, minLng, maxLat, maxLng] = parts
      if (minLat <= maxLat && minLng <= maxLng) {
        a.push(minLat, maxLat, minLng, maxLng)
        const base = i + (a.length - 4) // placeholder index for first bbox param
        w.push(`AND v.latitude BETWEEN $${base} AND $${base + 1}`)
        w.push(`AND v.longitude BETWEEN $${base + 2} AND $${base + 3}`)
      }
    }
  }
  if (filters.modality) {
    // EXISTS subquery (not a JOIN) so the count query and the list
    // query both see the same vendor row count — no DISTINCT needed.
    // The correlated subquery is fast for the typical map viewport
    // (≤500 vendors) because `idx_products_vendor_id` already
    // exists from the original products indexing pass.
    w.push(`AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.vendor_id = v.id
        AND p.is_active = true
        AND p.kind = 'service'
        AND p.modality = $${i}
    )`)
    a.push(filters.modality)
    i++
  }
  if (filters.q) {
    // Phase D1: free-text search. Matches vendor name + description
    // OR any of the vendor's active products/services. Uses ILIKE
    // (case-insensitive) on both sides so a buyer typing "Salsa"
    // finds a vendor named "academia Baquiano" with an offering
    // called "Clases de salsa". The first OR matches the vendor
    // itself; the EXISTS subquery matches via products.
    //
    // Cost: EXISTS is an index hit on `idx_products_vendor_id`
    // plus a row-level ILIKE per product. Acceptable for the
    // ≤500-vendor cap. Could later swap to `to_tsquery` + GIN
    // index when the catalog grows past a few thousand offerings.
    w.push(`AND (
      v.name ILIKE $${i} OR v.description ILIKE $${i}
      OR EXISTS (
        SELECT 1 FROM products p
        WHERE p.vendor_id = v.id
          AND p.is_active = true
          AND p.name ILIKE $${i}
      )
    )`)
    a.push(`%${filters.q}%`)
    i++
  }
  return { where: w.join(' '), args: a }
}
