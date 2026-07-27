/**
 * Top-50 most common passwords leaked in credential dumps.
 *
 * Lowercase; we compare against `password.toLowerCase()` so case variations
 * (e.g. "PASSWORD", "Password1") are still caught.
 * Source: SecLists top-100, trimmed to remove entries >32 chars (already
 * blocked by min-length=8).
 *
 * ONE source of truth — used by both /api/auth/register and
 * /api/auth/reset-password. Before this module the list was duplicated
 * (drift risk: a new entry added to register.ts but not reset-password.ts
 * would let a user reset into a password that registration now rejects).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwertyuiop', 'abc123', 'abc1234', '11111111', '12341234',
  'iloveyou', 'admin', 'admin123', 'administrator', 'root', 'toor', 'pass',
  'pass123', 'pass1234', 'welcome', 'welcome1', 'welcome123', 'monkey', 'dragon',
  'letmein', 'trustno1', 'baseball', 'iloveu', 'master', 'sunshine', 'ashley',
  'michael', 'shadow', 'jordan', 'superman', 'harley', 'fuckme', 'fuckyou', 'pussy',
  '696969', 'hottie', 'loveme', 'football', 'charlie', 'jennifer', 'hunter',
  'buster', 'soccer', 'harry', 'andrew', 'tigger', 'sunshine1', 'iloveyou1',
])

/** Returns true if the candidate (case-insensitive) is in the blocklist. */
export function isCommonPassword(candidate: string): boolean {
  return COMMON_PASSWORDS.has(candidate.toLowerCase())
}
