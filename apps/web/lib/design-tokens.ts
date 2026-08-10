/**
 * Design tokens — single source of truth for the parts of the
 * visual system that Tailwind config can't express (compound
 * gradients, ad-hoc neutrals rule, semantic status colors that
 * span multiple Tailwind shades).
 *
 * Phase I4: this file is the landing pad for the design
 * vocabulary the audit called out as inconsistent:
 *   - 9+ distinct gradient recipes across the codebase
 *   - `font-display` slot in tailwind.config.ts that was
 *     identical to `font-sans` (dead surface)
 *   - mixed `gray-*` / `stone-*` neutrals with no rule
 *   - 4 places where status colors live (Tailwind `accent`,
 *     Toast COLORS map, Input error class, ad-hoc `red-*` /
 *     `green-*` callsites)
 *
 * What's IN this file:
 *   1. Gradient vocabulary — named compound gradients so
 *      components don't invent their own.
 *   2. Neutrals rule — `STONE` is the default; `GRAY` is for
 *      neutral UI chrome that should look "colder" (admin
 *      surface, legacy data tables). Components should pick
 *      deliberately, not by inertia.
 *   3. Status color map — `STATUS` keyed by semantic meaning
 *      (success / warning / error / info / sponsored) so
 *      components that want a status color pick by name.
 *   4. H1 scale — a single name that pages reference via
 *      `h1-page` (defined in globals.css).
 *
 * What's NOT in this file:
 *   - Component variants (Button/Card/Badge live in
 *     components/ui/* and use Tailwind directly).
 *   - Per-category colors (lib/core/constants/categories.ts
 *     is the canonical home for the 11 category colors).
 *   - The `accent` Tailwind token (defined in
 *     tailwind.config.ts).
 *
 * Reference: apps/web/app/globals.css + tailwind.config.ts
 * for the Tailwind-side tokens this file complements.
 */

// ─── 1. Gradient vocabulary ────────────────────────────────────────
//
// Three named gradients cover every compound gradient recipe in
// active use today. New gradients require adding an entry here
// — components should not introduce ad-hoc recipes. Each entry
// is a complete Tailwind class string ready to drop into a
// `className`.
//
// Naming convention: <surface>-<intensity>.
//   - hero-soft: page-level hero gradient (low contrast).
//   - chip-active: chip selected state (subtle but visible).
//   - accent-strong: CTA emphasis (use sparingly — high visual
//     weight can fight the rest of the brand).
export const GRADIENTS = {
  heroSoft: 'bg-gradient-to-br from-primary via-primary-600 to-secondary',
  chipActive: 'bg-gradient-to-r from-orange-500 to-pink-500',
  accentStrong: 'bg-gradient-to-b from-primary to-primary-600',
} as const

// ─── 2. Neutrals rule ────────────────────────────────────────────
//
// The app uses two neutral families:
//   - STONE (warm gray, default). The home, vendor detail,
//     map, dashboard, and most surfaces use this.
//   - GRAY (cooler gray, admin / data tables only). The admin
//     palette was realigned to stone in Phase I3; if a future
//     surface needs the cooler feel, use one of these tokens
//     instead of typing `gray-XXX` inline.
// Components should pick deliberately via the token names,
// not by inlining `text-stone-700` or `text-gray-700`.
// If you need a new shade (e.g. `text-stone-450`) you almost
// certainly should extend the Tailwind theme instead.
export const STONE = {
  text: 'text-stone-700',
  textMuted: 'text-stone-500',
  textStrong: 'text-stone-900',
  bg: 'bg-stone-50',
  bgMuted: 'bg-stone-100',
  border: 'border-stone-200',
} as const

export const GRAY = {
  text: 'text-gray-700',
  textMuted: 'text-gray-500',
  textStrong: 'text-gray-900',
  bg: 'bg-gray-50',
  bgMuted: 'bg-gray-100',
  border: 'border-gray-200',
} as const

// ─── 3. Status colors ────────────────────────────────────────────
//
// Each entry is the full Tailwind class string for a colored
// surface + its dark variant. Components pick by semantic
// meaning, not by hex. New status types require adding a key
// here.
export const STATUS = {
  success: 'border-primary bg-primary/5 text-primary-700',
  warning: 'border-amber-400 bg-amber-50 text-amber-800',
  error: 'border-accent bg-accent/5 text-accent',
  info: 'border-stone-300 bg-white text-stone-700',
  // "sponsored" is a paid-feature signal, not a system status.
  // We use amber (yellow family) for it so the user can tell
  // it apart from organic status indicators. The companion
  // text color is amber-700.
  sponsored: 'bg-amber-100 text-amber-700',
  // "ready" / order in pickup state — admin uses a soft purple.
  // Kept purple because the admin status palette (purple = ready,
  // green = delivered, amber = pending, red = cancelled) is
  // semantic and a future commit can introduce an explicit
  // `orderStatus` map. Until then, the colors live here.
  orderReady: 'bg-purple-100 text-purple-800',
  orderDelivered: 'bg-green-100 text-green-800',
  orderPending: 'bg-amber-100 text-amber-800',
  orderCancelled: 'bg-red-100 text-red-800',
} as const

// ─── 4. H1 scale ─────────────────────────────────────────────────
//
// One canonical name. Pages reference it via the `h1-page`
// class in globals.css. Don't use `text-Xxl font-bold` inline
// — go through the class so a future scale adjustment is one
// diff.
//
// The class itself is defined in globals.css; this constant is
// the source-of-truth pointer (a string export so components
// can reference it without importing the CSS).
export const H1_PAGE_CLASS = 'h1-page'
