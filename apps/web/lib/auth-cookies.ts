/**
 * Auth-cookie constants shared across the auth routes.
 *
 * Cookie `path` rule (CORRECTED 2026-07-27 after P0-1 audit):
 *
 *   The cookies (`token`, `refresh-token`) MUST be set with `path: '/'`
 *   so they are sent on EVERY request to our origin that requires auth.
 *
 *   Why not narrow to `/api/auth` (the L1 original proposal):
 *     - `/api/vendors/me`, `/api/products`, `/api/orders`, `/api/account`,
 *       `/api/favorites`, `/api/notifications`, `/api/reviews`,
 *       `/api/sponsorships`, `/api/contact`, `/api/consent`, `/api/push/*`
 *       all read `req.cookies.get('token')` via `requireAuth(req)`.
 *     - proxy.ts reads the same cookie on EVERY page route
 *       (/dashboard, /profile/edit, /settings, /notifications, /onboarding,
 *       /products) to enforce seller-only / auth-only access BEFORE the
 *       page even renders.
 *     - With Path=/api/auth, the browser would only send the cookie on
 *       requests to URLs starting with /api/auth. Every other request
 *       arrives without the cookie, every `requireAuth` returns 401, every
 *       protected page is unreachable. **Bug P0-1 (audit 2026-07-27) —
 *       users were stuck in a login loop after L1 shipped.**
 *
 *   So we use Path=/ and rely on the layered defenses for CSRF/scoping:
 *     - SameSite=strict (S3-SEC-3) — the cookie does not ride on
 *       cross-site requests at all.
 *     - HttpOnly — JS can't read it; XSS can't steal it.
 *     - requireSameOrigin() CSRF check on every mutating endpoint.
 *     - Secure flag in production.
 *
 *   Centralizing the constant in one module enforces "issue and clear at
 *   the same scope" by construction — the only way to drift is to write a
 *   raw `path: '/somewhere'` string, which a grep catches.
 *
 *   If we ever add a public surface that needs the cookie, keep this at
 *   '/' — the alternatives (Authorization header everywhere, or per-route
 *   cookie mirroring) add real complexity for zero security benefit.
 */

/** Path used when issuing and clearing the `token` and `refresh-token`
 *  cookies. MUST match between the issuing routes (login, register,
 *  refresh) and the clearing routes (logout).
 *  Default '/' so the cookie reaches every authenticated route AND the
 *  proxy.ts middleware. See file header for the full rationale. */
export const AUTH_COOKIE_PATH = '/'
