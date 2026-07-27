/**
 * User-facing string sanitization.
 *
 * Used for any free-form text the user submits that ends up displayed back
 * to other users (full name, vendor name, product description, etc.). The
 * goal is to prevent display tricks that abuse Unicode:
 *
 *   - Zero-width characters (\u200B..\u200D, \uFEFF) let attackers paste
 *     invisible glyphs that pass length checks but render as something
 *     different on the target's screen.
 *   - Bidi control characters (\u202A..\u202E, \u2066..\u2069) let an
 *     attacker spoof filenames and identifiers (the classic "annoyance.txt"
 *     -> "annoyanceexe.txt" trick).
 *   - Mixed combining marks can render text as visual equivalent of a
 *     different word (homograph attacks). normalize('NFC') collapses
 *     precomposed/decomposed forms into a canonical byte sequence so the
 *     same visible string maps to the same internal representation.
 *
 * This is defense-in-depth, not a complete Unicode confusable detector.
 * For high-risk fields (e.g. admin-visible URL paths) you'd also want
 * a confusable-map lookup, but for human names/déscriptions this is
 * enough to stop the common abuse.
 */

// Characters that look invisible but affect display/ordering.
const ZERO_WIDTH_AND_BIDI = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g

/**
 * Sanitize a display string: strip zero-width + bidi controls, normalize
 * Unicode to canonical composed form, trim, collapse internal whitespace.
 *
 * Returns '' when the input is missing or non-string. Length is unchanged
 * aside from the strips — callers should validate length afterwards.
 */
export function sanitizeDisplayName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(ZERO_WIDTH_AND_BIDI, '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
}
