// Audit 2026-08-14: force-dynamic so the prerendered SSR shell can't
// be served from cache to anonymous users (the proxy gate doesn't run
// on cached responses in Next.js 16).
export const dynamic = 'force-dynamic'

/**
 * /admin — super admin dashboard (server component).
 *
 * Lists all vendors and clients with filters and pagination, with a
 * detail drawer for vendor admin actions.
 *
 * Auth: in a server component we don't have a NextRequest object, so we
 * read the token directly from the cookie store and verify it with the
 * edge-safe helpers (no DB call — the proxy already enforced role on
 * /api/* and the page is read-only). The DB-bound requireAdmin() runs
 * inside the API endpoints that the page fetches, which is the real
 * trust boundary.
 *
 * The 403 here is a UX guard, not a security one — it keeps an
 * unauthenticated user from seeing a flash of the admin shell.
 */

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifyTokenEdge } from '@/lib/auth-edge'
import { AdminPanel } from './admin-panel'

export default async function AdminPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('__Host-token')?.value
  if (!token) redirect('/login?next=/admin')

  const decoded = await verifyTokenEdge(token)
  if (!decoded || decoded.role !== 'admin') {
    // Non-admin (or token now invalid) → bounce to dashboard.
    redirect('/dashboard')
  }

  return <AdminPanel />
}
