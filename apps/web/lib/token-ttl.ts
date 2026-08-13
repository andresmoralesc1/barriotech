/**
 * Centralized token TTL constants + label helpers.
 *
 * Audit 2026-08-13 M7: TTLs used to live inline at each call site (24h for
 * email verification in lib/email.ts; 1h for password reset in
 * app/api/auth/forgot-password/route.ts). Consolidating here means:
 *
 *   1. The copy the user sees ("El enlace expira en 24 horas" /
 *      "El enlace expira en 1 hora") can never drift from the actual TTL.
 *   2. Tuning the TTL is a one-line change.
 *   3. Tests can import the constants directly without parsing route files.
 *
 * Human-readable labels live next to each constant because the email copy
 * uses them verbatim. Don't paraphrase in the templates.
 */

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
export const EMAIL_VERIFICATION_TTL_LABEL = '24 horas'

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
export const PASSWORD_RESET_TTL_LABEL = '1 hora'