/**
 * GET / HEAD  /api/uptime
 *
 * Cheap "is the process alive?" ping for uptime monitoring.
 *
 * Why a separate endpoint from /api/health/ready:
 *   - /api/health/ready runs DB queries (latency ~30ms, occasional latency spikes).
 *   - UptimeRobot hits the endpoint every 5min — that's 288 DB probes/day, just
 *     to confirm the Node process hasn't crashed.
 *   - This endpoint does ZERO work; it returns 200 unconditionally.
 *   - If the Node process is down, requests time out / fail → uptime alert fires.
 *
 * Response:
 *   - 200 OK
 *   - body: "ok"
 *   - headers: no-store, no-cache
 *
 * Configure in UptimeRobot as:
 *   type: HTTP (s)
 *   url:  https://barriotech.com.co/api/uptime
 *   interval: 5min  (free tier minimum)
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return new Response('ok', {
    status: 200,
    headers: {
      'content-type': 'text/plain',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  })
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}
