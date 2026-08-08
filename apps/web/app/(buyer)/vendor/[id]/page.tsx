import type { Metadata } from 'next'
import { VendorDetailClient } from '@/components/vendor/VendorDetailClient'
import { isUuid } from '@/lib/core/utils/slug'
import pool from '@/lib/db'
import { getCityById } from '@/lib/core/constants/cities'
import { isServiceCategory } from '@/lib/core/types'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const isUuidId = isUuid(id)
  try {
    const result = await pool.query(
      `SELECT v.name, v.category, v.description, v.photo_url, v.city_id
       FROM vendors v
       WHERE ${isUuidId ? 'v.id = $1' : 'v.slug = $1'}
       LIMIT 1`,
      [id]
    )
    if (result.rows.length > 0) {
      const v = result.rows[0]
      const cityName = getCityById(v.city_id)?.name ?? 'Colombia'
      // Migration 102: SEO copy adapts to the vendor's category. Service
      // sellers show up in "Clases de guitarra", "Masajes", "Peluquería"
      // searches — generic "vendedor informal" copy underperforms on
      // those queries. The description flip is the cheap SEO win; the
      // <title> is left stable because Google's title-rewrite already
      // surfaces category from the page itself.
      const offeringNoun = isServiceCategory(v.category) ? 'servicios' : 'productos'
      const title = `${v.name} — ${cityName} · BarrioTech`
      const description = v.description
        ? `${v.description.slice(0, 155)}${v.description.length > 155 ? '…' : ''}`
        : `${v.name} en ${cityName} — ${offeringNoun} en BarrioTech.`
      const images = v.photo_url ? [v.photo_url] : []
      return {
        title,
        description,
        openGraph: {
          title: v.name,
          description,
          type: 'profile',
          images,
          locale: 'es_CO',
        },
        twitter: {
          card: 'summary_large_image',
          title: v.name,
          description,
          images,
        },
      }
    }
  } catch (err) {
    console.error('generateMetadata (vendor) error:', err)
  }
  return {
    title: 'Vendedor — BarrioTech',
    description: 'Vendedor informal en BarrioTech',
  }
}

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Resolve the vendor's UUID once on the server so the client can use it
  // for endpoints that require a UUID (favorites, orders, etc.).
  // The slug stays in the URL for SEO; the UUID is the canonical id.
  const isUuidId = isUuid(id)
  let vendorUuid = id
  let vendorSlug: string | undefined
  try {
    const result = await pool.query(
      `SELECT v.id, v.slug FROM vendors v WHERE ${isUuidId ? 'v.id = $1' : 'v.slug = $1'} LIMIT 1`,
      [id]
    )
    if (result.rows.length > 0) {
      vendorUuid = result.rows[0].id
      vendorSlug = result.rows[0].slug
    }
  } catch {
    // If the lookup fails the client will surface a "not found" state.
  }
  // Only pass the slug to the client when the URL was a UUID. This signals
  // the client to perform a one-time redirect to the canonical slug form.
  // If the URL is already the slug, we skip the redirect to avoid a loop.
  const clientSlug = isUuidId ? vendorSlug : undefined
  return <VendorDetailClient vendorId={vendorUuid} vendorSlug={clientSlug} />
}
