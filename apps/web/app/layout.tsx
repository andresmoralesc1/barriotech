import type { Metadata } from 'next'
import { Providers } from './providers'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { OnboardingTour } from '@/components/OnboardingTour'
import { ToastContainer } from '@/components/ui/Toast'
import { UmamiAnalytics } from '@/components/UmamiAnalytics'
import { SellerOnboardingBanner } from '@/components/SellerOnboardingBanner'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://barriotech.com.co'),
  title: {
    default: 'BarrioTech — Vendedores informales en tu barrio, en tiempo real',
    template: '%s',
  },
  alternates: {
    canonical: '/',
  },
  description: 'Encuentra vendedores informales cerca de ti en Colombia. Comida, frutas, artesanías y más — en tiempo real. Mapa en vivo, GPS, favoritos y reseñas.',
  keywords: ['vendedores informales colombia', 'comida callejera', 'frutas', 'artesanías', 'gps', 'mapa', 'barrio', 'comprar local', 'street food colombia', 'vendedores ambulantes'],
  authors: [{ name: 'BarrioTech' }],
  icons: {
    // SVG first for browsers that prefer it (modern Firefox, Safari 14+).
    // .ico is the universal fallback. apple is iOS bookmark icon.
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BarrioTech',
  },
  openGraph: {
    title: 'BarrioTech — Vendedores informales en tu barrio',
    description: 'Encuentra vendedores informales cerca de ti en Colombia. Comida, frutas, artesanías y más — en tiempo real.',
    type: 'website',
    locale: 'es_CO',
    siteName: 'BarrioTech',
    images: [
      {
        url: '/hero.jpg',
        width: 1200,
        height: 630,
        alt: 'BarrioTech — vendedores informales Colombia',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BarrioTech — Vendedores en tu barrio',
    description: 'Encuentra vendedores informales cerca de ti en Colombia.',
    images: ['/hero.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  other: {
    'theme-color': '#F97316',
    'mobile-web-app-capable': 'yes',
    'format-detection': 'telephone=no',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // JSON-LD structured data for SEO — Organization + WebSite.
  // This makes Google rich results show our logo, name, and search sitelinks.
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'BarrioTech',
    url: 'https://barriotech.com.co',
    logo: 'https://barriotech.com.co/logo.png',
    description:
      'Plataforma para conectar compradores con vendedores informales en Colombia.',
    sameAs: [
      // Add social profiles here when available
    ],
  }
  const siteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'BarrioTech',
    url: 'https://barriotech.com.co',
    inLanguage: 'es-CO',
    // SearchAction enables the Google sitelinks search box for our brand.
    // Even without an internal search engine, declaring a target that's
    // useful (the map) signals our canonical entry point for "find
    // vendors near me" queries.
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://barriotech.com.co/map?city={search_term_string}',
      },
      // Query-input intent for the placeholder text Google shows.
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <html lang="es">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>
      <body className="bg-background-cream min-h-screen flex flex-col">
        <Providers>
          <SiteHeader />
          <SellerOnboardingBanner />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <OnboardingTour />
          <ToastContainer />
          <UmamiAnalytics />
        </Providers>
      </body>
    </html>
  )
}
