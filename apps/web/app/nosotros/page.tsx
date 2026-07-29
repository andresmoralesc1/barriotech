import type { Metadata } from 'next'
import { NosotrosView } from '@/components/marketing/NosotrosView'

export const metadata: Metadata = {
  title: 'Nosotros — Nuestra misión y equipo',
  description:
    'BarrioTech conecta compradores con vendedores locales en Colombia. Conoce nuestra misión, valores y equipo.',
  alternates: {
    canonical: 'https://barriotech.com.co/nosotros',
  },
  openGraph: {
    title: 'Nosotros — BarrioTech',
    description: 'Conectando barrios, creando comunidad. Conoce al equipo detrás de BarrioTech.',
    images: ['/nosotros.jpg'],
    type: 'website',
    locale: 'es_CO',
  },
}

export default function AboutPage() {
  return <NosotrosView />
}
