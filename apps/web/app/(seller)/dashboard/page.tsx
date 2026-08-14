'use client';

// Audit 2026-08-14: force-dynamic so the prerendered SSR shell can't
// be served from cache to anonymous users.
export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { DashboardContent, DashboardSkeleton } from '@/components/seller/Dashboard'

export default function SellerDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  )
}