/**
 * /admin — super admin dashboard (server component).
 *
 * Lists all vendors and clients with filters and infinite-scroll-y
 * pagination. The pages are split into two client components:
 *   - AdminVendorsTab
 *   - AdminClientsTab
 * and the highlight state is a URL query param so the tab survives
 * reload and can be linked.
 *
 * Auth: requireAdmin() runs on the server. A non-admin who tries to
 * GET this page is redirected to /dashboard with a no-op effect.
 * (API routes still return 403 — the page redirect is for UX.)
 */

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { requireAdmin } from '@/lib/auth'
import { AdminPanel } from './admin-panel'

export default async function AdminPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value
  const isAuthed = Boolean(token)
  if (!isAuthed) redirect('/login?next=/admin')

  const auth = await requireAdmin({
    headers: new Headers({ cookie: `token=${token}` }),
  } as any)
  if (auth instanceof Response) {
    // Non-admin (or token now invalid) → bounce to dashboard.
    redirect('/dashboard')
  }

  return <AdminPanel />
}
