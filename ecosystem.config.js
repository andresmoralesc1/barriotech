/**
 * PM2 ecosystem file for BarrioTech.
 *
 * Why this file exists:
 * - Next.js doesn't auto-load .env.local at PM2 start unless you point PM2 at it
 *   explicitly via `env_file`. Without that, env precedence puts .env.local on top
 *   at runtime but the shell-launched process never sees it.
 * - The previous "just npm start" approach broke whenever someone needed to change
 *   env (had to pm2 kill the whole daemon, which was scary with other services).
 *   This file makes restarts surgical: `pm2 reload barriotech` is enough.
 *
 * Usage:
 *   pm2 start ecosystem.config.js             # first-time start
 *   pm2 reload barriotech                     # after code changes (zero-downtime)
 *   pm2 restart barriotech                    # hard restart (faster than reload)
 *   pm2 logs barriotech                       # tail logs
 *   pm2 save                                  # persist current process list across reboots
 *   pm2 resurrect                             # restore on server boot (after `pm2 save`)
 *
 * Safe: only this app is managed. n8n, twenty, minio, postgres, redis, caddy
 * are all separate (systemd / docker / standalone) and are NOT touched.
 */

module.exports = {
  apps: [
    {
      name: 'barriotech',
      script: 'npm',
      args: 'start -- -p 3005',
      cwd: '/home/telchar/barriotech/apps/web',
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
      // Next.js itself would also load .env at runtime, but only for vars that
      // are NOT already in process.env — and pm2 currently has stale BREVO_API_KEY
      // / EMAIL_FROM saved from before. Reading the file at process spawn ensures
      // the live values in apps/web/.env always win on a fresh restart.
      env_file: '/home/telchar/barriotech/apps/web/.env',
      env: {
        NODE_ENV: 'production',
        PORT: '3005',
        // Must match the public site Origin. If this stays at localhost,
        // requireSameOrigin() 403s every upload / profile PATCH from
        // https://barriotech.com.co (browsers send that Origin).
        APP_ORIGIN: 'https://barriotech.com.co',
        // 2026-07-30: PM2 7.0.3 caches env_file across `pm2 restart` —
        // changing .env doesn't re-propagate to the running process.
        // Hardcoding here (not in env_file) guarantees the new token
        // wins. Keep in sync with apps/web/.env. Regenerate with:
        //   node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'
        // (also pasted into apps/web/.env as canonical source).
        FIELD_AGENT_TOKEN: 'DPBLq4lHgXRGvpg_xLiZeXfQVpiRPLdf7YpGe46jQBkxDspuXFImifPU285lREeX',
        // 2026-08-13: PM2 7.0.3's daemon inherits env from whoever launched
        // it. If a stale (revoked) BREVO_API_KEY lives in the shell env
        // when pm2 starts, the daemon propagates it to barriotech forks,
        // overriding apps/web/.env — signups then silently fail because
        // Brevo rejects the call with HTTP 401 "Key not found". The fix is
        // to put the canonical (appsweb/.env) key here in `env:` so it
        // wins over inherited shell env. env_file alone is not enough.
        //
        // IMPORTANT: do NOT commit a real Brevo key — GitHub's secret
        // scanner blocks pushes. Copy the value from apps/web/.env and
        // paste it locally; this block is the runtime override.
        BREVO_API_KEY: '<paste from apps/web/.env>',
      },
      // Out-of-band log files. pm2-logrotate watches these and rotates when
      // either exceeds 50M. We keep 10 compressed copies.
      out_file: '/home/telchar/.pm2/logs/barriotech-out.log',
      error_file: '/home/telchar/.pm2/logs/barriotech-error.log',
      merge_logs: false,
      time: true,
    },
  ],
}