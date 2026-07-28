/**
 * DELETE /api/admin/notes/[id] — soft-delete a note.
 *
 * Any admin can delete any note (we don't restrict to author) — a
 * typo or wrong-target note should be easy to clean up. The action
 * is audit-logged with the note's target and author so the cleanup
 * is itself visible.
 *
 * Body: none. Idempotent: deleting an already-deleted note returns
 * 404 (the row is invisible to this query).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireSameOrigin } from '@/lib/csrf'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    'admin_note_action',
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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  try {
    // Read the row first so we can include target_type/author_id in
    // the audit log. Using a single UPDATE...RETURNING would also work
    // but we'd lose the row visibility on a 404 case.
    const existing = await pool.query(
      `SELECT id, target_type, target_id, author_id
         FROM admin_notes
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
    }

    await pool.query(
      `UPDATE admin_notes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )

    const meta = existing.rows[0]
    logAdminAction(auth.userId, 'delete_admin_note', req, {
      targetType: meta.target_type as 'user' | 'vendor',
      targetId: meta.target_id,
      metadata: { noteId: id, authorId: meta.author_id },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error(serializeErr(err), 'admin note delete error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
