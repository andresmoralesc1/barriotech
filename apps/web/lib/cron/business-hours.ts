import pool from '@/lib/db'
import { logger, serializeErr } from '@/lib/logger'
import { recordJobRun } from '@/lib/job-status'

/**
 * N11 — Business hours auto-toggle.
 * Runs every 5 minutes. For vendors with business_hours_enabled = TRUE:
 *   - Inside window + matching day  → is_active = TRUE
 *   - Outside window OR non-matching day → is_active = FALSE
 *
 * Uses setInterval (no node-cron dependency).
 */

async function run() {
  try {
    const sql = `
      WITH now_local AS (
        SELECT
          TRIM(LOWER(TO_CHAR((NOW() AT TIME ZONE 'America/Bogota'), 'dy'))) AS dow_name,
          TO_CHAR((NOW() AT TIME ZONE 'America/Bogota'), 'HH24:MI') AS hm
      )
      UPDATE vendors v
      SET is_active = (
        v.business_hours_enabled = TRUE
        AND EXISTS (
          SELECT 1 FROM now_local n
          WHERE n.dow_name = ANY(v.business_days)
            AND v.business_hours_start::time <= n.hm::time
            AND (v.business_hours_end::time IS NULL OR v.business_hours_end::time > n.hm::time)
        )
      )
      WHERE v.business_hours_enabled = TRUE
    `
    const result = await pool.query(sql)
    const updated = result.rowCount ?? 0
    await recordJobRun('business-hours', { updated, ts: new Date().toISOString() })
    logger.info(`[business-hours] Updated ${updated} vendors`)
  } catch (err) {
    logger.error(serializeErr(err), '[business-hours] Error:')
    await recordJobRun('business-hours', { error: String(err) })
  }
}

// Audit 2026-08-14 (CRON-2): timer handle moved to module scope so
// stopBusinessHoursCron() can clear it. The previous "Future: wire
// stopBusinessHoursCron() when it becomes stateful" comment is now
// resolved.
let timer: NodeJS.Timeout | null = null

export function startBusinessHoursCron() {
  if (process.env.NODE_ENV !== 'production') return
  // Run every 5 minutes. Skip when running in build context.
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (timer) return // already scheduled
  timer = setInterval(run, 5 * 60 * 1000)
  // Don't keep the process alive just for this timer.
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('[business-hours] Cron scheduled (every 5 min)')
}

export function stopBusinessHoursCron() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}