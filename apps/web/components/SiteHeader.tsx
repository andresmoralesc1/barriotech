'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, MapPin, User, LogIn, LogOut, ChevronDown } from 'lucide-react'
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
    // Solution: use `window.location.replace('/?logged_out=1')` so the
    // page navigates with a query param that tells the AuthInitializer
    // (and any in-flight 401 handler) "this is a deliberate logout, do
    // not redirect to ?expired=1". After navigation, replace the URL
    // with a clean one so the param doesn't linger in the user's URL
    // bar or browser history.
    setJustLoggedOut(true)
    await storeLogout()
    const target = '/?logged_out=1'
    window.location.replace(target)
    // Note: the replaceState below is best-effort. If the browser blocks
    // it (e.g. on the initial about:blank doc), the param stays in the
    // URL until the user navigates again. authedFetch clears the flag
    // after the AuthInitializer runs, so future requests in this session
    // behave normally.
  }

  const isLoggedIn = _hasHydrated && !!user

  const navLinks = [
    { href: '/map', label: 'Explorar' },
    { href: '/nosotros', label: 'Nosotros' },
    { href: '/contacto', label: 'Contacto' },
  ]

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
