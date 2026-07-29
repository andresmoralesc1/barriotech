/**
 * PM2 ecosystem file for GPS Street Sellers.
 *
 * Why this file exists:
 * - Next.js doesn't auto-load .env.local at PM2 start unless you point PM2 at it
 *   explicitly via `env_file`. Without that, env precedence puts .env.local on top
 *   at runtime but the shell-launched process never sees it.
 * - The previous "just npm start" approach broke whenever someone needed to change
 *   env (had to pm2 kill the whole daemon, which was scary with other services).
 *   This file makes restarts surgical: `pm2 reload gps` is enough.
 *
 * Usage:
 *   pm2 start ecosystem.config.js             # first-time start
 *   pm2 reload gps                            # after code changes (zero-downtime)
 *   pm2 restart gps                           # hard restart (faster than reload)
 *   pm2 logs gps                              # tail logs
 *   pm2 save                                  # persist current process list across reboots
 *   pm2 resurrect                             # restore on server boot (after `pm2 save`)
 *
 * Safe: only this app is managed. n8n, twenty, minio, postgres, redis, caddy
 * are all separate (systemd / docker / standalone) and are NOT touched.
 */

module.exports = {
  apps: [
    {
      name: 'gps',
      script: 'npm',
      args: 'start -- -p 3005',
      cwd: '/home/telchar/gps-street-sellers/apps/web',
      exec_mode: 'fork',
      autorestart: true,
      // PM2 will respawn the app if it crashes. With max_restarts=10 inside
      // min_uptime=30s, a flaky process gives up after 10 quick failures.
      max_restarts: 10,
      min_uptime: '30s',
      // Auto-restart if RSS exceeds 500 MB. Sellers running GPS for hours on
      // mobile can leak memory via the SSE stream; this keeps the box healthy.
      max_memory_restart: '500M',
      // Graceful shutdown: PM2 sends SIGINT first, waits `kill_timeout` for the
      // process to drain, then SIGKILL. Our instrumentation.ts catches SIGTERM
      // and closes the pg pool + cron intervals before exit.
      kill_signal: 'SIGINT',
      kill_timeout: 8000,
      wait_ready: false,
      // Load .env explicitly so the port and secrets are present at process start.
      // We only need the file; Next.js itself reads .env.local with higher priority
      // inside the app, so we don't override anything here.
      env: {
        NODE_ENV: 'production',
        PORT: '3005',
        // Must match the public site Origin. If this stays at localhost,
        // requireSameOrigin() 403s every upload / profile PATCH from
        // https://barriotech.com.co (browsers send that Origin).
        // Tier 14: barriotech.com.co is now the primary brand; the old
        // gps.andresmorales.com.co subdomain still responds on :3005 but
        // its Origin header won't match, which 403s the request —
        // acceptable for the transition window.
        APP_ORIGIN: 'https://barriotech.com.co',
      },
      // Out-of-band log files. pm2-logrotate watches these and rotates when
      // either exceeds 50M. We keep 10 compressed copies.
      out_file: '/home/telchar/.pm2/logs/gps-out.log',
      error_file: '/home/telchar/.pm2/logs/gps-error.log',
      merge_logs: false,
      time: true,
    },
  ],
}