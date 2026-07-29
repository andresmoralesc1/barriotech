import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Script from 'next/script'
import pool from '@/lib/db'
import { isUuid } from '@/lib/core/utils/slug'
import { getCityById } from '@/lib/core/constants/cities'
import { getCategoryInfo } from '@/lib/core/constants/categories'
import { VendorDetailClient } from '@/components/vendor/VendorDetailClient'

/**
 * Public catalog page at /vendedor/[slug].
 *
 * Shared with the buyer-only /vendor/[id] route via VendorDetailClient —
 * the difference is only the URL shape:
 *   - /vendor/[id]    accepts a UUID id (deep-link, signed messages)
 *   - /vendedor/[slug]  is the human-friendly shareable URL
 *
 * Server resolves the slug to the canonical UUID before rendering so the
 * client always sees a valid UUID for API calls.
 *
 * Tier 16: this server component also fetches the SEO-relevant slice
 * of the vendor row in generateMetadata + the page body so that:
 *   1. <title>, <meta description>, og:title, og:description, og:image
 *      and <link rel="canonical"> are unique per vendor (Google
 *      differentiates each /vendedor/[slug] in the SERP rather than
 *      ranking all 487 vendors under one snippet).
 *   2. LocalBusiness + BreadcrumbList JSON-LD are emitted per page so
 *      Google can render rich results (vendor name, photo, city, rating,
 *      opening hours) directly in the search result.
 *
 * The client component still does its own /api/vendors/[id] fetch for
 * products, reviews, etc. — this server lookup is SEO-only and does not
 * shortcut the existing data flow.
 */

type SeoVendor = {
  id: string
  slug: string
  name: string
  description: string | null
  category: string | null
  city_id: string | null
  photo_url: string | null
  phone: string | null
  rating: number | string | null
  review_count: number | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  is_verified: boolean
  business_hours_enabled: boolean | null
  business_hours_start: string | null
  business_hours_end: string | null
  business_days: string[] | null
  vehicle_type: string | null
}

const BASE_URL = 'https://barriotech.com.co'

async function fetchVendorBySlug(slug: string): Promise<SeoVendor | null> {
  if (isUuid(slug)) {
    const { rows } = await pool.query<SeoVendor>(
      `SELECT id, slug, name, description, category, city_id, photo_url, phone,
              rating, review_count, latitude, longitude, is_active, is_verified,
              business_hours_enabled, business_hours_start, business_hours_end,
              business_days, vehicle_type
       FROM vendors WHERE id = $1 LIMIT 1`,
      [slug],
    )
    return rows[0] ?? null
  }
  const { rows } = await pool.query<SeoVendor>(
    `SELECT id, slug, name, description, category, city_id, photo_url, phone,
            rating, review_count, latitude, longitude, is_active, is_verified,
            business_hours_enabled, business_hours_start, business_hours_end,
            business_days, vehicle_type
     FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug],
  )
  return rows[0] ?? null
}

/** Map a "HH:MM" / "HH:MM:SS" to just "HH:MM" without seconds. */
function trimTime(s: string | null): string | null {
  if (!s) return null
  const m = /^(\d{1,2}:\d{2})(:\d{2})?$/.exec(s.trim())
  return m ? m[1] : null
}

/** Map `mon,tue,wed,...` to the schema.org OpeningHoursSpecification dayOfWeek. */
function schemaOrDays(days: string[] | null): string[] {
  const map: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  }
  if (!days) return []
  return days
    .map((d) => map[String(d).toLowerCase().trim()])
    .filter((d): d is string => !!d)
}

function buildLocalBusinessJsonLd(vendor: SeoVendor): Record<string, unknown> {
  const city = getCityById(vendor.city_id ?? '')
  const category = vendor.category ? getCategoryInfo(vendor.category as Parameters<typeof getCategoryInfo>[0]) : null
  const ratingNum = vendor.rating == null ? 0 : Number(vendor.rating)
  const reviewCount = vendor.review_count ?? 0

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${BASE_URL}/vendedor/${vendor.slug}`,
    name: vendor.name,
    url: `${BASE_URL}/vendedor/${vendor.slug}`,
    image: vendor.photo_url ? `${BASE_URL}${vendor.photo_url}` : `${BASE_URL}/hero.jpg`,
    description: vendor.description ?? `Vendedor informal en ${city?.name ?? 'Colombia'}.`,
    telephone: vendor.phone ?? undefined,
    address: city
      ? {
          '@type': 'PostalAddress',
          addressLocality: city.name,
          addressRegion: city.department,
          addressCountry: 'CO',
        }
      : { '@type': 'PostalAddress', addressCountry: 'CO' },
    priceRange: '$$',
    // category is among the supported LocalBusiness categories ("FoodEstablishment",
    // "Store", etc.) — we tag it as a generic AdditionalProperty so Google's
    // classifier picks up the right rich-result type later.
    additionalType: category?.label ?? undefined,
  }

  // Geo: only emit when we have real coordinates. CI test vendors share
  // (4.65, -74.05) Bogotá which would be misleading for real ones if
  // copied back via a stale record.
  if (vendor.latitude != null && vendor.longitude != null) {
    ld.geo = {
      '@type': 'GeoCoordinates',
      latitude: vendor.latitude,
      longitude: vendor.longitude,
    }
  }

  // aggregateRating: only when there's at least one review. Zero-state
  // carries no signal and Google may flag it as content-free.
  if (ratingNum > 0 && reviewCount > 0) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: ratingNum.toFixed(1),
      reviewCount,
      bestRating: 5,
      worstRating: 1,
    }
  }

  // Opening hours: only when explicitly enabled + start/end set.
  if (
    vendor.business_hours_enabled &&
    vendor.business_hours_start &&
    vendor.business_hours_end
  ) {
    const start = trimTime(vendor.business_hours_start)
    const end = trimTime(vendor.business_hours_end)
    const days = schemaOrDays(vendor.business_days)
    if (start && end && days.length > 0) {
      ld.openingHoursSpecification = {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: days,
        opens: start,
        closes: end,
      }
    }
  }

  return ld
}

function buildBreadcrumbJsonLd(vendor: SeoVendor): Record<string, unknown> {
  const city = getCityById(vendor.city_id ?? '')
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Inicio',
        item: `${BASE_URL}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Vendedores',
        item: `${BASE_URL}/map`,
      },
      ...(city
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: city.name,
              item: `${BASE_URL}/map?city=${city.id}`,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: city ? 4 : 3,
        name: vendor.name,
        item: `${BASE_URL}/vendedor/${vendor.slug}`,
      },
    ],
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const vendor = await fetchVendorBySlug(slug)
  if (!vendor) {
    return {
      title: 'Vendedor no encontrado',
      description: 'Este vendedor no existe o fue removido.',
      robots: { index: false, follow: false },
    }
  }

  const city = getCityById(vendor.city_id ?? '')
  const category = vendor.category ? getCategoryInfo(vendor.category as Parameters<typeof getCategoryInfo>[0]) : null
  const canonicalPath = `/vendedor/${vendor.slug}`
  const title = `${vendor.name} · ${category?.label ?? 'Vendedor'} en ${city?.name ?? 'Colombia'}`
  const description = vendor.description
    ? vendor.description.slice(0, 160)
    : `${vendor.name} — vendedor informal en ${city?.name ?? 'Colombia'}. ${category?.label ?? ''} vía BarrioTech.`
  const imageUrl = vendor.photo_url ? `${BASE_URL}${vendor.photo_url}` : `${BASE_URL}/hero.jpg`

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      type: 'profile',
      locale: 'es_CO',
      siteName: 'BarrioTech',
      images: [{ url: imageUrl, width: 1200, height: 630, alt: vendor.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
  }
}

export default async function VendorPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!slug) redirect('/map')

  const vendor = await fetchVendorBySlug(slug)
  if (!vendor) {
    // Unknown slug → fall back to the map so the user can browse.
    redirect('/map')
  }

  // Emit LocalBusiness + BreadcrumbList JSON-LD even when the vendor
  // is soft-deleted or otherwise flagged for non-indexing — we leave the
  // robots noindex decision to generateMetadata. Structured data is
  // cheap to emit and helps Google disambiguate stale listings.
  const localBusinessJsonLd = buildLocalBusinessJsonLd(vendor)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(vendor)

  return (
    <>
      {/*
        Per Next.js 16 docs, strategy="beforeInteractive" only gets
        injected into the initial HTML when the <Script> lives inside
        the root layout. From a page (where this lives), the JSON-LD
        is emitted via the RSC payload and the client hydrates the
        <script type="application/ld+json"> tag into the DOM before
        paint (because of the beforeInteractive strategy).
        Practical effect: Googlebot (Chrome-based, post-2024) sees
        the JSON-LD after JS execution, so it still gets indexed.
        Crawlers that don't execute JS will NOT see these tags —
        we accept that tradeoff because the alternative (moving the
        JSON-LD to root layout) means we'd have to URL-inspect
        inside the layout to gate it to /vendedor/* only, which adds
        complexity for marginal SEO gain.
      */}
      <Script
        id="vendor-local-business"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(localBusinessJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <Script
        id="vendor-breadcrumb"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <VendorDetailClient vendorId={vendor.id} vendorSlug={vendor.slug} />
    </>
  )
}
