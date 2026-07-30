import type { Config } from 'tailwindcss'

const config: Config = {
  // Dark mode disabled — see app/providers.tsx for the runtime guard.
  // To re-enable: restore `darkMode: 'class'` and uncomment the
  // <ThemeToggle /> import + render in SiteHeader.tsx
  // darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
          // Bumped from #F97316 (orange-500, 2.8:1 vs white) to #C2410C
          // (orange-700, 5.4:1 vs white) so bg-primary + text-white passes
          // WCAG AA contrast (4.5:1). This affects every `bg-primary` and
          // `text-primary` site-wide.
          DEFAULT: '#C2410C',
        },
        secondary: {
          DEFAULT: '#FB923C',
          light: '#FDBA74',
          dark: '#EA580C',
        },
        background: {
          cream: '#FFFBEB',
          warm: '#FEF7ED',
          dark: '#1C1917',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F5F5F4',
        },
        accent: '#EF4444',
        muted: '#78716C',
      },
      fontFamily: {
        display: ['Bricolage Grotesque', 'sans-serif'],
        sans: ['Bricolage Grotesque', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(0,0,0,0.08), 0 4px 16px -4px rgba(0,0,0,0.06)',
        'card': '0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.05)',
        'card-hover': '0 4px 12px rgba(249,115,22,0.12), 0 8px 24px rgba(249,115,22,0.08)',
        'glow': '0 0 20px rgba(249,115,22,0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        // Existing — kept
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',

        // NEW — microinteractions batch (2026-07-21)
        'shimmer': 'shimmer 1.6s linear infinite',
        'heart-pop': 'heartPop 0.45s cubic-bezier(0.16,1,0.3,1)',
        'cart-bounce': 'cartBounce 0.55s ease-out',
        'badge-pop': 'badgePop 0.4s cubic-bezier(0.16,1,0.3,1)',
        'marker-pulse': 'markerPulse 1.4s ease-in-out infinite',
        'ripple': 'ripple 0.65s linear',
        'fly-out': 'flyOut 0.55s cubic-bezier(0.55,0.06,0.68,0.19) forwards',
        'progress-shrink': 'progressShrink var(--toast-duration,3.5s) linear forwards',
        'shake-x': 'shakeX 0.45s cubic-bezier(0.36,0.07,0.19,0.97)',
        'card-expand': 'cardExpand 0.35s cubic-bezier(0.4,0,0.2,1) forwards',

        // FAB microinteractions — delayed entrance + idle pulse-ring
        // (subtle, ~6s interval) so the button feels alive without nagging.
        'fab-pop-in': 'fabPopIn 0.45s cubic-bezier(0.16,1,0.3,1) 0.5s both',
        'fab-pulse-ring': 'fabPulseRing 2.4s cubic-bezier(0.4,0,0.6,1) infinite',
        // Stagger helper — applied via inline style `animationDelay` for
        // each action chip so they cascade in when the menu expands.
        'fab-stagger-in': 'fabStaggerIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // Sprint 8 5.5: previously `transform: translateY(8px)`, but
        // CSS transforms on the root layout wrapper create a new
        // "containing block" for `position: fixed` descendants. This
        // silently broke every fixed-positioned UI (the floating
        // contact bar in /vendor/[id] had to be portaled to document.body
        // as a workaround). Dropping the transform keeps the fade-in
        // polish without poisoning fixed positioning. Slide-up effect
        // is preserved by `clip-path: inset(0 0 8px 0)` which animates
        // without creating a containing block.
        slideUp: {
          '0%': { opacity: '0', 'clip-path': 'inset(8px 0 0 0)' },
          '100%': { opacity: '1', 'clip-path': 'inset(0 0 0 0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },

        // NEW — microinteractions batch (2026-07-21)
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        heartPop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.4)' },
          '70%': { transform: 'scale(0.92)' },
          '100%': { transform: 'scale(1)' },
        },
        cartBounce: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-12deg)' },
          '50%': { transform: 'rotate(8deg)' },
          '75%': { transform: 'rotate(-4deg)' },
        },
        badgePop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.2)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // Soft ring pulse for the selected Leaflet marker so the user
        // can locate it on the map after the fly-to.
        markerPulse: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.7' },
          '50%': { transform: 'scale(1.6)', opacity: '0' },
        },
        // Click ripple — concentric circle expanding from the click point.
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '0.55' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        // Paper-plane flying away to the top-right (where WhatsApp icon
        // sits in the UI). Combined with the icon-color flash it gives
        // clear feedback without interrupting the navigation.
        flyOut: {
          '0%': { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: '1' },
          '70%': { opacity: '1' },
          '100%': { transform: 'translate(60px,-80px) rotate(20deg) scale(0.4)', opacity: '0' },
        },
        // Toast progress bar — shrinks width linearly over the toast
        // lifetime. `toast-duration` is set inline via a CSS var on each
        // toast root so the same animation works for any duration.
        progressShrink: {
          '0%': { transform: 'scaleX(1)' },
          '100%': { transform: 'scaleX(0)' },
        },
        // Horizontal shake for error toasts — short and crisp.
        shakeX: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        // Product card expand — height grows from collapsed to auto.
        // Uses grid-template-rows trick (0fr → 1fr) so the height
        // transitions to actual content height, not a fixed value.
        cardExpand: {
          '0%': { gridTemplateRows: '0fr', opacity: '0' },
          '100%': { gridTemplateRows: '1fr', opacity: '1' },
        },

        // FAB delayed entrance — pops in from below with a slight overshoot
        // (cubic-bezier with bounce) AFTER 500ms so the page content
        // settles first and the FAB doesn't fight the initial paint.
        fabPopIn: {
          '0%':   { opacity: '0', transform: 'translateY(20px) scale(0.7)' },
          '60%':  { opacity: '1', transform: 'translateY(-3px) scale(1.05)' },
          '100%': { opacity: '1', transform: 'translateY(0)    scale(1)' },
        },
        // Idle halo behind the FAB — concentric ring that grows & fades.
        // Goes behind the button (z-index lower) so it reads as a soft
        // pulse, not a blinking alarm. Synced to a 2.4s cycle.
        fabPulseRing: {
          '0%':   { transform: 'scale(1)',   opacity: '0.45' },
          '70%':  { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        // Single action chip — fade + slide + slight overshoot. The
        // actual stagger (per-item delay) is set inline via style so we
        // don't need N animation classes for N actions.
        fabStaggerIn: {
          '0%':   { opacity: '0', transform: 'translateY(6px) scale(0.85)' },
          '60%':  { opacity: '1', transform: 'translateY(-1px) scale(1.04)' },
          '100%': { opacity: '1', transform: 'translateY(0)    scale(1)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
