/**
 * Auth-cookie constants shared across the auth routes.
 *
 * L1 (audit 2026-07-27): all auth cookies (`token`, `refresh-token`)
 * MUST be set AND cleared at the same path. Otherwise:
 *
 *   - Setting at `/api/auth` while clearing at `/` leaves a stale cookie
 *     at `/api/auth` that the browser keeps sending on every request.
 *   - Different paths create DIFFERENT cookies with the same name in the
 *     browser jar, which silently breaks logout semantics.
 *
 * Centralizing the constant in one module enforces "issue and clear at
 * the same scope" by construction — the only way to drift is to write a
 * raw `path: '/'` string, which a grep catches.
 *
 * Keep the Path as wide as the *token needs to be sent to*:
 *   - `/api/auth/*` (login, logout, refresh, register, verify-email, ...)
 *   - Plus any non-auth route that reads the cookie. Currently that's
 *     `/api/account` (DELETE reads `token` to authenticate). The path
 *     must be a prefix common to all those endpoints.
 *
 * If we ever add a public route that needs the cookie, EITHER move the
 * token to a `Authorization` header for that route OR widen this path.
 */

/** Path used when issuing and clearing the `token` and `refresh-token`
 *  cookies. MUST match between the issuing routes (login, register,
 *  refresh) and the clearing routes (logout). */
export const AUTH_COOKIE_PATH = '/api/auth'
