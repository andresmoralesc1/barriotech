import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { logger, serializeErr } from '@/lib/logger'
import { getTokenFromRequest } from '@/lib/auth-edge'
import { verifyToken } from '@/lib/auth'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitFromRequest } from '@/lib/rate-limit'

// M-001 D: audit trail for vendor contact CTAs (call / WhatsApp / directions).
//
// Fire-and-forget from the client: the user clicks "Llamar" → we log the
// event here, then the browser opens tel:. So this handler MUST be fast,
// fail-safe, and never block the click. We:
//   * Don't wait on user lookup before inserting (best-effort).
//   * Catch all errors and return 204 anyway so the client doesn't retry.
//   * Cap body at 1KB to prevent abuse.
//   * Validate vendor exists before insert — but return 204 even on miss,
//     to avoid leaking vendor-id enumeration via timing.
//
// Auth: optional. Logged-in buyers get their `userId` attached; guests
// log with `ip_address` only. This is privacy-sensitive (Ley 1581) so we
// don't store any PII beyond what's already in the auth cookie / request.

const ALLOWED = new Set(['call', 'whatsapp', 'directions'])

async function optionalBuyerId(req: NextRequest): Promise<string | null> {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = await verifyToken(token).catch(() => null)
  return decoded?.userId ?? null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Per-IP rate limit. 20/min — vendor contact CTAs are a known
  // spam target; legitimate use is 1-2 contacts per session.
  const rl = await checkRateLimitFromRequest(req, 'vendor_contact_log', 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const { id: vendorId } = await params

    // 1. Validate vendor exists (return 204 anyway to avoid leaking info).
    try {
      const vendorCheck = await pool.query<{ id: string }>(
        'SELECT id FROM vendors WHERE id = $1 LIMIT 1',
        [vendorId]
      )
      if (vendorCheck.rows.length === 0) {
        return new NextResponse(null, { status: 204 })
      }
    } catch {
      return new NextResponse(null, { status: 204 })
    }

    // 2. Parse body — small JSON only.
    const raw = await req.text()
    if (raw.length > 1024) {
      return new NextResponse(null, { status: 204 })
    }
    let body: { type?: string } = {}
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    const contactType = String(body.type || '').toLowerCase()
    if (!ALLOWED.has(contactType)) {
      return new NextResponse(null, { status: 204 })
    }

    // 3. Identify the buyer if logged in (optional, never blocks).
    const buyerId = await optionalBuyerId(req)

    // 4. IP + UA.
    const ipHeader =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const userAgent = req.headers.get('user-agent')?.slice(0, 500) || null

    // 5. Insert (fire-and-forget).
    try {
      await pool.query(
        `INSERT INTO vendor_contacts
           (vendor_id, buyer_id, contact_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [vendorId, buyerId, contactType, ipHeader, userAgent]
      )
    } catch (err) {
      logger.error(serializeErr(err), '[contact-log] insert failed:')
    }

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    logger.error(serializeErr(err), '[contact-log] unhandled:')
    return new NextResponse(null, { status: 204 })
  }
}
