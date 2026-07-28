/**
 * POST /api/admin/vendors/[id]/restore — undo soft delete.
 *
 * Sets vendors.deleted_at back to NULL. Idempotent: restoring a vendor
 * that isn't soft-deleted returns 200 with no audit row. A vendor that
 * does not exist returns 404. CSRF + same-origin, rate-limited, and
 * audited with `restore_soft_deleted_vendor` on success.
 *
 * Why a dedicated endpoint instead of `PATCH { deletedAt: null }`?
 * Soft delete / restore are mutually exclusive state transitions and
 * deserve their own URL — easier to reason about in the audit trail
 * and easier to rate-limit separately from the lighter PATCH actions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireSameOrigin } from '@/lib/csrf'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_vendor_restore',
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
        `SELECT id, deleted_at FROM vendors WHERE id = $1 FOR UPDATE`,
        [id]
      )
      if (cur.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
      }
      if (!cur.rows[0].deleted_at) {
        // Nothing to restore — return success without an audit row.
        await client.query('ROLLBACK')
        return NextResponse.json({ ok: true, alreadyActive: true })
      }

      // Capture the prior timestamp for the audit metadata.
      const priorDeletedAt = cur.rows[0].deleted_at

      await client.query(
        `UPDATE vendors SET deleted_at = NULL WHERE id = $1`,
        [id]
      )

      await client.query('COMMIT')

      logAdminAction(auth.userId, 'restore_soft_deleted_vendor', req, {
        targetType: 'vendor',
        targetId: id,
        metadata: { priorDeletedAt },
      })

      return NextResponse.json({ ok: true, restoredAt: new Date().toISOString() })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor restore error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
