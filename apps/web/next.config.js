/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs')

const path = require('path')

const nextConfig = {
  reactStrictMode: true,
  // Disable the X-Powered-By: Next.js header (fingerprinting the stack).
  poweredByHeader: false,

  // Explicit workspace root — Next.js was getting confused by /home/telchar/bun.lock
  // (an orphaned file from a different project) and warning about inferred root.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // ---------------------------------------------------------------------
  // Drop the legacy ES5 polyfills chunk (Pagespeed 2026-08-12).
  //
  // Next.js emits `static/chunks/polyfills-*.js` via CopyFilePlugin from
  // @next/polyfill-nomodule on every build. It's loaded with `<script
  // noModule>` so modern browsers (Chrome 90+, Firefox 90+, Safari 15.4+)
  // skip execution — but they still download it (~40 KiB gzipped). Since
  // we don't support IE 11 (the only browser that actually needs these),
  // we exclude the file from the trace output entirely.
  //
  // Risk: zero. Solo corres riesgo con IE11 que ya no soportamos.
  // ---------------------------------------------------------------------
  outputFileTracingExcludes: {
    '*': ['.next/static/chunks/polyfills-*.js'],
  },

  // ---------------------------------------------------------------------
  // Image optimization (Etapa 13)
  //
  // Whitelist external hosts so <Image src="https://..." /> can optimize.
  // Currently used by product photos uploaded to Supabase Storage.
  // ---------------------------------------------------------------------
  images: {
    // Modern formats first. Browsers pick the best they support; older
    // browsers get a JPEG/PNG fallback. ~30-50% weight reduction on
    // photo-heavy pages.
    formats: ['image/avif', 'image/webp'],
    // Allow explicit quality values via next/image. Default is [75] only.
    // Pagespeed 2026-08-12: HomeView step images use quality=60 to save
    // ~10 KiB per image. Browser-native <img> AVIF preloads use the file
    // directly — this only applies to next/image calls.
    qualities: [60, 75],
    // Minimum cache TTL for optimized images. 1 year is safe because
    // the URL is content-hashed (changing the source = different URL).
    minimumCacheTTL: 60 * 60 * 24 * 365,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.in',
        pathname: '/storage/v1/object/**',
      },
      // Allow Carrd / marketing landing pages hosted externally to render OG previews.
      {
        protocol: 'https',
        hostname: 'andresmorales.com.co',
      },
      // Pexels (illustrative photos for the "Cómo funciona" home blocks).
      // Pagespeed 2026-08-12: serving original JPEG was 84 KiB; next/image
      // auto-converts to WebP and serves responsive sizes.
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
      // Tier 14: barriotech.com.co + www variant. Both serve the same
      // Next.js instance behind Caddy; listed separately so /next/image
      // can optimize OG previews shared from either. www is the canonical
      // redirect target, so this is rarely used in practice but listed
      // for robustness.
      {
        protocol: 'https',
        hostname: 'barriotech.com.co',
      },
      {
        protocol: 'https',
        hostname: 'www.barriotech.com.co',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // Security headers (Etapa 5)
  //
  // Applied to ALL responses — pages, API routes, static assets.
  // Bare minimum OWASP baseline: HSTS, frame-ancestors, nosniff,
  // strict referrer policy, locked-down permissions policy.
  //
  // CSP is intentionally permissive about https: in script-src/img-src
  // because the app pulls product photos from Supabase Storage URLs.
  // Inline styles ('unsafe-inline' in style-src) are required by Tailwind
  // utility classes + some shadcn components. Inline scripts ('unsafe-inline'
  // in script-src) are required by Next.js' dev-mode hydration bootstrap;
  // remove in production once we move to nonce-based.
  // ---------------------------------------------------------------------
  async headers() {
    const isProd = process.env.NODE_ENV === 'production'

    const csp = [
      `default-src 'self'`,
      // sync with /etc/caddy/Caddyfile line 24 (barriotech.com.co block).
      // Caddy overwrites this header in production via header_down, so next.config.js
      // is only authoritative in dev/preview. Keep them in lock-step.
      // S1-SEC-4 (audit 2026-07-22): removed 'unsafe-eval'. Next.js 16 in
      // production does NOT require eval() — it ships pre-compiled bundles.
      // If a hydration/runtime error re-introduces the need, the browser
      // console will show "unsafe-eval required" — re-add then. CSP is
      // emitted only in dev (see headers() below); production CSP comes
      // from Caddy.
      `script-src 'self' 'unsafe-inline' https://umami.andresmorales.com.co`, // Next.js hydration + Umami analytics
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, // Tailwind + Google Fonts CSS
      `style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://images.pexels.com https://barriotech.com.co https://andresmorales.com.co`, // Audit 2026-08-14 (SEC-1 I-1): was `https:` wildcard — any HTTPS image could be loaded via XSS. Restricted to known hosts.
      `font-src 'self' data: https://fonts.gstatic.com`, // Google Fonts files
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fonts.googleapis.com https://umami.andresmorales.com.co`,
      `worker-src 'self'`, // service worker for push notifications
      `manifest-src 'self'`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `object-src 'none'`,
    ].join('; ')

    // Permissions-Policy feature names must match the W3C spec:
    // https://github.com/w3c/webappsec-permissions-policy/blob/main/features.md
    // 'notifications' is NOT a valid feature name (it doesn't exist in spec).
    // Web push does NOT require Permissions-Policy declaration.
    //
    // S3-SEC-1 (audit 2026-07-23): added `interest-cohort=()` to opt out of
    // FLoC / Topics tracking. Without it the browser may cohort the user
    // into a "topic" group based on browsing history, which is a privacy
    // violation under Colombian Habeas Data (Law 1581/2012) and EU GDPR.
    // Always-empty tuple blocks the feature entirely.
    const permissionsPolicy = [
      `geolocation=(self)`, // required for "vendors nearby"
      `camera=()`,
      `microphone=()`,
      `payment=()`,
      `usb=()`,
      `magnetometer=()`,
      `gyroscope=()`,
      `accelerometer=()`,
      `interest-cohort=()`,
    ].join(', ')

    return [
      {
        source: '/(.*)',
        headers: [
          // Strict transport security — 1 year, include subdomains, preload-ready.
          // S3-SEC-2 (audit 2026-07-23): added `preload` so the domain can be
          // submitted to hstspreload.org. The Caddy vhost already emits this
          // header, but Next.js must agree so a misconfigured Caddy reload (or
          // direct hit to the Next.js port during debugging) doesn't drop the
          // security guarantee. `preload` requires `includeSubDomains` and
          // `max-age >= 31536000` — all three are present.
          {
            key: 'Strict-Transport-Security',
            value: isProd
              ? 'max-age=31536000; includeSubDomains; preload'
              : 'max-age=0',
          },
          // Clickjacking protection
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Privacy
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Permissions policy — only what we need
          { key: 'Permissions-Policy', value: permissionsPolicy },
          // S1-SEC-4 (audit 2026-07-22): CSP is set by Caddy ONLY, not Next.js.
          // Having both sources caused the browser to see two CSP headers
          // and Caddy's override was silently dropped. Keeping a single
          // authoritative source (Caddyfile vhost gps block, ~line 26) makes
          // it impossible to drift. The Next.js CSP build variable is
          // preserved for dev-mode preview only.
          ...(isProd ? [] : [{ key: 'Content-Security-Policy', value: csp }]),
          // Cross-origin isolation OFF (no SharedArrayBuffer use case)
          // { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
      // Don't cache HTML pages — they change often (marketing copy, contact info).
      // Static assets in /_next/static/* keep their long cache (hash-based busting).
      {
        source: '/((?!_next/static|sw\\.js|manifest\\.json|favicon).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      // /public/* assets are content-versioned by file path. Cache for 1
      // year so browsers don't re-fetch on every visit. 404s are NOT
      // cached (must-revalidate keeps a missing favicon from sticking).
      {
        source: '/(.*\\.(?:png|jpg|jpeg|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|pdf))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
}

module.exports = withSentryConfig(nextConfig, {
  // Source-map upload config. No-op when SENTRY_AUTH_TOKEN isn't set,
  // so dev builds work without a Sentry account.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  hideSourceMaps: true,
  // disableLogger is deprecated in @sentry/nextjs 10+ — use the
  // webpack treeshake option instead. Equivalent effect: no Sentry
  // debug logs in production builds.
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
})