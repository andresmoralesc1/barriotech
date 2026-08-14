'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, MapPin, User, LogIn, LogOut, ChevronDown, Shield } from 'lucide-react'
import { Button } from './ui/Button'
import { NotificationBell } from './notifications/NotificationBell'
import { EmailVerifyBanner } from './EmailVerifyBanner'
// Theme toggle hidden while dark mode is disabled. Component kept in
// repo for easy re-enable later.
// import { ThemeToggle } from './ThemeToggle'
import { useStore } from '@/store/useStore'
import { clsx } from 'clsx'

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, _hasHydrated, logout: storeLogout, setJustLoggedOut } = useStore()
  const pathname = usePathname()

  // Hide the redundant "Ingresar" / "Registrarme" buttons when user is already on those pages
  const isAuthPage = pathname === '/login' || pathname === '/register'
  const onLogin = pathname === '/login'
  const onRegister = pathname === '/register'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = () => setUserMenuOpen(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [userMenuOpen])

  const handleLogout = async () => {
    // Sprint 11 B-AUTH-4 (2026-07-24): the previous implementation
    // redirected via `window.location.href = '/'`, which triggered a full
    // page load. During that load, the AuthInitializer mounts and fires
    // /api/auth/me, which 401s. With no logged-in cookie, the refresh
    // also 401s, and the authedFetch would race the page navigation to
    // redirect to /login?expired=1 — even though the user explicitly
    // clicked "Cerrar sesión".
    //
    // Solution: call `window.location.replace` FIRST, before any
    // async work. Once the browser has committed to a navigation,
    // pending fetch responses can't win the race — the new page
    // load will pick up the `?logged_out=1` query param and any
    // 401 from in-flight requests will be ignored by the authedFetch
    // signal-check.
    //
    // Why this is robust: window.location.replace is synchronous
    // (queues the navigation immediately). Even if a NotificationBell
    // poll fires its 401+refresh+redirect chain 1ms later, the browser
    // has already committed to the navigation. The authedFetch
    // redirect code may still execute, but window.location assignment
    // after we've already assigned it doesn't re-trigger the old URL.
    setJustLoggedOut(true)
    window.location.replace('/?logged_out=1')
    // Fire-and-forget the actual logout: server clears cookies,
    // we clear client state. The browser has already navigated away
    // by the time these resolve — if they fail, the cookies will
    // expire on their own (15 min access, 7 day refresh) and the
    // user is already on '/'.
    // Audit 2026-08-14 (Important #13): the fire-and-forget storeLogout
    // can be killed by navigation before it completes on flaky
    // networks, leaving the client-side localStorage state stale.
    // Use navigator.sendBeacon for the API call (survives navigation)
    // so the server clears cookies even if the page unloads.
    try {
      const csrfToken = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('csrf-token='))
        ?.split('=')[1]
      if (csrfToken && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' })
        navigator.sendBeacon('/api/auth/logout?csrf=' + encodeURIComponent(csrfToken), blob)
      }
    } catch { /* best-effort — server-side expiry handles the rest */ }
    void storeLogout()
  }

  const isLoggedIn = _hasHydrated && !!user

  const navLinks = [
    { href: '/map', label: 'Explorar' },
    // Phase pivot (2026-08-10): services are no longer on the map.
    // /servicios is the dedicated discovery surface (city +
    // category + "a domicilio" filter). Sits next to "Explorar"
    // because they're complementary: the map shows products
    // nearby, /servicios shows services the buyer wants to
    // hire (which often come to them).
    { href: '/servicios', label: 'Servicios' },
    { href: '/nosotros', label: 'Nosotros' },
    { href: '/contacto', label: 'Contacto' },
  ]

  const isAdmin = user?.role === 'admin'

  return (
    <header
      className={`sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-out ${
        scrolled
          ? 'bg-white/85 backdrop-blur-xl shadow-card border-b border-stone-200/50'
          : 'bg-white shadow-soft border-b border-transparent'
      }`}
    >
      <EmailVerifyBanner />
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="relative">
              <Image
                src="/logo.png"
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                className="object-contain transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6"
                priority
              />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-gray-900 text-base tracking-tight">Barrio</span>
              <span className="text-xs text-primary-700 font-bold -mt-0.5">Tech</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          {/* Specific label ("del sitio") so this nav doesn't collide with
              the bottom-nav on /dashboard, which also calls itself
              "Navegación principal". Axe flags two landmarks with the same
              accessible name as redundant. */}
          <nav aria-label="Navegación principal del sitio" className="hidden md:flex items-center gap-1">
            {navLinks.map((l) => {
              const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    'relative px-4 py-2 text-sm font-medium rounded-xl transition-colors ' +
                    (isActive
                      ? 'text-primary-700 bg-primary/5'
                      : 'text-gray-600 hover:text-primary hover:bg-primary/5')
                  }
                >
                  {l.label}
                  <span
                    className={
                      'absolute left-3 right-3 -bottom-0.5 h-0.5 rounded-full bg-primary transition-all duration-300 ' +
                      (isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0')
                    }
                    aria-hidden="true"
                  />
                </Link>
              )
            })}
            {/* Admin link — only for role='admin'. Shield icon signals
                elevated privilege and isn't used elsewhere on the site. */}
            {isAdmin && (
              <Link
                href="/admin"
                aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
                className={
                  'relative px-4 py-2 text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 ' +
                  (pathname.startsWith('/admin')
                    ? 'text-amber-700 bg-amber-50'
                    : 'text-amber-700 hover:text-amber-900 hover:bg-amber-50')
                }
              >
                <Shield size={14} aria-hidden="true" />
                Admin
                <span
                  className={
                    'absolute left-3 right-3 -bottom-0.5 h-0.5 rounded-full bg-amber-500 transition-all duration-300 ' +
                    (pathname.startsWith('/admin') ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0')
                  }
                  aria-hidden="true"
                />
              </Link>
            )}
          </nav>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center gap-2">
            {/* ThemeToggle hidden — dark mode disabled */}
            <NotificationBell />
            {isLoggedIn ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setUserMenuOpen(!userMenuOpen) }}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`Menú de usuario: ${user.fullName || user.email}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-all min-h-[36px]"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User size={15} className="text-primary" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-medium text-gray-700 max-w-[100px] truncate">
                    {user.fullName || user.email}
                  </span>
                  <ChevronDown size={14} className={clsx('text-gray-400 transition-transform', userMenuOpen && 'rotate-180')} aria-hidden="true" />
                </button>
                {userMenuOpen && (
                  <div role="menu" className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                    {user.role === 'seller' && (
                      <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                        Dashboard
                      </Link>
                    )}
                    {/* Mis pedidos is buyer-only — sellers manage incoming orders
                        from /dashboard. Showing it here routed sellers to a page
                        that says "Esta sección es para compradores". */}
                    {user.role === 'buyer' && (
                      <Link href="/orders" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                        Mis pedidos
                      </Link>
                    )}
                    <Link href="/favorites" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Favoritos
                    </Link>
                    <Link href="/settings" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Configuración
                    </Link>
                    <hr className="my-1 border-gray-100" />
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut size={14} />
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            ) : !isAuthPage ? (
              <>
                {!onLogin && (
                  <Link href="/login">
                    <Button size="sm" variant="ghost" className="text-gray-600 gap-1.5">
                      <LogIn size={15} />
                      Ingresar
                    </Button>
                  </Link>
                )}
                {!onRegister && (
                  <Link href="/register">
                    <Button size="sm" className="gap-1.5 shadow-md shadow-primary/20">
                      <User size={15} />
                      Registrarme
                    </Button>
                  </Link>
                )}
              </>
            ) : null}
          </div>

          {/* Mobile hamburger + inline auth CTA. Sprint 5 B-006: dropped the
              inline "Registrarme" button on mobile to reduce crowding.
              Three buttons (notification + login + hamburger) is the
              Apple-recommended max for a header. "Registrarme" stays
              reachable inside the hamburger menu and on every form. */}
          <div className="flex items-center gap-2 md:hidden">
            <NotificationBell />
            {!isLoggedIn && !isAuthPage && !onLogin && (
              <Link
                href="/login"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary active:scale-[0.97] transition-all"
                aria-label="Ingresar"
              >
                <LogIn size={18} aria-hidden="true" />
              </Link>
            )}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl transition-all duration-200 ${
                menuOpen
                  ? 'bg-primary text-white shadow-lg shadow-primary/30'
                  : 'bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary'
              }`}
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="md:hidden pb-4">
            <div className="bg-gray-50 rounded-2xl p-3 space-y-1 border border-gray-100">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:text-primary hover:bg-white rounded-xl transition-all"
                >
                  <MapPin size={16} className="text-primary/70" />
                  {l.label}
                </Link>
              ))}
              {/* Admin link in mobile — same gating as desktop */}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-50 rounded-xl transition-all"
                >
                  <Shield size={16} className="text-amber-700" />
                  Admin
                </Link>
              )}
            </div>

            {isLoggedIn ? (
              <div className="mt-3 bg-gray-50 rounded-2xl p-3 space-y-1 border border-gray-100">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {user.fullName || user.email}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  </div>
                </div>
                {user.role === 'seller' && (
                  <Link
                    href="/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:text-primary hover:bg-white rounded-xl transition-all"
                  >
                    <MapPin size={16} className="text-primary/70" />
                    Dashboard
                  </Link>
                )}
                {/* Mis pedidos is buyer-only — see desktop comment above. */}
                {user.role === 'buyer' && (
                  <Link
                    href="/orders"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:text-primary hover:bg-white rounded-xl transition-all"
                  >
                    <MapPin size={16} className="text-primary/70" />
                    Mis pedidos
                  </Link>
                )}
                <Link
                  href="/favorites"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:text-primary hover:bg-white rounded-xl transition-all"
                >
                  <MapPin size={16} className="text-primary/70" />
                  Favoritos
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 hover:text-primary hover:bg-white rounded-xl transition-all"
                >
                  <MapPin size={16} className="text-primary/70" />
                  Configuración
                </Link>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    handleLogout()
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-all"
                >
                  <LogOut size={16} />
                  Cerrar sesión
                </button>
              </div>
            ) : !isAuthPage ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {!onLogin && (
                  <Link href="/login" onClick={() => setMenuOpen(false)}>
                    <Button size="sm" variant="outline" className="w-full justify-center gap-1.5">
                      <LogIn size={14} /> Ingresar
                    </Button>
                  </Link>
                )}
                {!onRegister && (
                  <Link href="/register" onClick={() => setMenuOpen(false)}>
                    <Button size="sm" className="w-full justify-center gap-1.5">
                      <User size={14} /> Registrarme
                    </Button>
                  </Link>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </header>
  )
}
