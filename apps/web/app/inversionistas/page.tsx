import type { Metadata } from 'next'
import { InversionistasView } from '@/components/marketing/InversionistasView'

export const metadata: Metadata = {
  title: 'Inversionistas — Oportunidad de mercado en economía informal',
  description:
    'BarrioTech desarrolla una plataforma de geolocalización y promoción para vendedores de calle. Conoce el MVP, el modelo de negocio y la oportunidad de mercado.',
  alternates: {
    canonical: 'https://barriotech.com.co/inversionistas',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'Inversionistas — BarrioTech',
    description:
      'Una plataforma de geolocalización y promoción para conectar vendedores locales con compradores cercanos.',
    images: ['/hero.jpg'],
    type: 'website',
    locale: 'es_CO',
  },
}

export default function InversionistasPage() {
  return <InversionistasView />
}
