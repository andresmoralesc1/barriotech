import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getTokenFromRequest, verifyTokenEdge } from '@/lib/auth-edge'
import { getRequestId } from '@/lib/request-context'

// Routes that require SELLER role
const SELLER_ROUTES = ['/dashboard', '/profile/edit', '/products']

// Routes that should redirect to /login if unauthenticated
// Note: /favorites and /orders handle their own unauthenticated state
// in-page (show a "Log in" CTA), so we don't force-redirect from the proxy.
const AUTH_ROUTES = ['/settings', '/notifications', '/onboarding']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Sprint 9 C.2: generate or forward a request id for log correlation.
  // The id is attached to every downstream response and to the request
  // headers (so route handlers can read it via getRequestId(req)).
  const requestId = getRequestId(req)

  // Skip middleware for API routes, static files, and public routes
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public/') ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/map' ||
    pathname === '/onboarding' ||
    pathname === '/' ||
    pathname.startsWith('/nosotros') ||
    pathname.startsWith('/contacto') ||
    pathname.startsWith('/preguntas-frecuentes') ||
    pathname.startsWith('/privacidad') ||
    pathname.startsWith('/terminos') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg'
  ) {
    const passthrough = NextResponse.next()
    passthrough.headers.set('x-request-id', requestId)
    return passthrough
  }

  const token = getTokenFromRequest(req)

  // Redirect unauthenticated users from protected app routes to login
  if (!token) {
    const isProtectedAppRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r))
    if (isProtectedAppRoute) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('redirect', pathname)
      const redirect = NextResponse.redirect(loginUrl)
      redirect.headers.set('x-request-id', requestId)
      return redirect
    }
    const passthrough = NextResponse.next()
    passthrough.headers.set('x-request-id', requestId)
    return passthrough
  }

  const decoded = await verifyTokenEdge(token)

  if (!decoded) {
    // Invalid or revoked token — clear cookie and redirect to login
    const response = NextResponse.redirect(new URL('/login', req.url))
    response.cookies.delete('token')
    response.headers.set('x-request-id', requestId)
    return response
  }

  // Seller-only routes — admins are exempt; they can view the dashboard.
  if (SELLER_ROUTES.some((r) => pathname.startsWith(r))) {
    if (decoded.role !== 'seller' && decoded.role !== 'admin') {
      const redirect = NextResponse.redirect(new URL('/map', req.url))
      redirect.headers.set('x-request-id', requestId)
      return redirect
    }
  }

  // /admin route — admins only. Non-admins get bounced to /dashboard.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (decoded.role !== 'admin') {
      const redirect = NextResponse.redirect(new URL('/dashboard', req.url))
      redirect.headers.set('x-request-id', requestId)
      return redirect
    }
  }

  // Authenticated — attach user info to headers for API routes
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-user-id', decoded.userId)
  requestHeaders.set('x-user-role', decoded.role)
  requestHeaders.set('x-request-id', requestId)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
    // Echo the request id back on the response so the client can see it
    // (and paste it into bug reports alongside the timestamp).
    headers: {
      'x-request-id': requestId,
    },
  })
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - api routes (they handle auth themselves)
     */
    '/((?!_next/static|_next/image|favicon.ico|favicon.svg|sitemap.xml|robots.txt|api/).*)',
  ],
}