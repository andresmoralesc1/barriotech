import type { MetadataRoute } from 'next'

/**
 * robots.txt — controls which URLs the search engine crawler is allowed to hit.
 *
 * Notes:
 *   - We block /api/* and authenticated areas from crawlers (defense in
 *     depth; those routes are also no-store in Cache-Control but crawlers
 *     sometimes ignore HTTP headers).
 *   - /storage/* is the S3-backed public bucket; only Crawl-delay=0 there
 *     so product images show up in image search quickly.
 *   - Sitemap is announced so Google picks up new vendors.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/dashboard',
          '/notifications',
          '/orders',
          '/settings',
          '/favorites',
          '/products',
          '/onboarding',
          '/storage/auth/',
          '/profile/edit',
        ],
      },
      {
        userAgent: 'Googlebot-Image',
        allow: ['/storage/', '/'],
      },
    ],
    sitemap: 'https://barriotech.com.co/sitemap.xml',
    host: 'https://barriotech.com.co',
  }
}
