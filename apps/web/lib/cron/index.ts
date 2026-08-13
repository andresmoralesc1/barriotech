import { startBusinessHoursCron } from '@/lib/cron/business-hours'
import { startLocationHistoryPruneCron, stopLocationHistoryPruneCron } from '@/lib/cron/prune-location-history'
import { startEmailTokenPruneCron, stopEmailTokenPruneCron } from '@/lib/cron/prune-email-tokens'

/**
 * Boot file: imports all cron starters.
 * Imported from instrumentation.ts so they only run in production.
 */
export function startCrons() {
  startBusinessHoursCron()
  startLocationHistoryPruneCron()
  // Audit 2026-08-13 M4: daily prune of expired/used email + password-reset
  // tokens. 7-day retention past expiry/use.
  startEmailTokenPruneCron()
}

export function stopCrons() {
  // Future: wire stopBusinessHoursCron() when it becomes stateful.
  stopLocationHistoryPruneCron()
  stopEmailTokenPruneCron()
}