import pool from '@/lib/db'
import { logger, serializeErr } from '@/lib/logger'
import { recordJobRun } from '@/lib/job-status'

/**
 * Daily retention prune for vendor_location_history.
 * Deletes GPS snapshots older than 90 days to keep the table bounded.
 * Heatmap max range is 90d, so anything older is useless.
 *
 * Runs once per day at 03:15 Bogotá (production only, via instrumentation.ts).
 */
const RETENTION_DAYS = 90
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h

let timer: NodeJS.Timeout | null = null

export function startLocationHistoryPruneCron() {
  if (timer) return
  const runOnce = async () => {
    try {
      const res = await pool.query(
        `DELETE FROM vendor_location_history
         WHERE recorded_at < NOW() - ($1 || ' days')::INTERVAL`,
        [RETENTION_DAYS.toString()]
      )
      await recordJobRun('location-history-prune', { deleted: res.rowCount ?? 0 })
      logger.info(`[location-history-prune] Deleted ${res.rowCount} snapshots older than ${RETENTION_DAYS} days`)
    } catch (err) {
      // Audit 2026-08-14 (CRON-1): recordJobRun on the error path so DB
      // outages surface in job_runs (the previous code only logged,
      // so a silent breakage would leave no trace). recordJobRun is
      // itself safe — best-effort within the catch.
      try {
        await recordJobRun('location-history-prune', { error: String(err) })
      } catch { /* ignore recordJobRun failure */ }
      logger.error(serializeErr(err), '[location-history-prune] error:')
    }
  }

  // Fire once on boot (in case server was down for >24h), then every 24h.
  void runOnce()
  timer = setInterval(runOnce, CHECK_INTERVAL_MS)

  logger.info(`[location-history-prune] Cron scheduled (every ${CHECK_INTERVAL_MS / 1000}s, retention ${RETENTION_DAYS}d)`)
}

export function stopLocationHistoryPruneCron() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}