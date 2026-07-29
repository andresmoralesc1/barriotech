import type { Metadata } from 'next'
import { TerminosView } from '@/components/marketing/TerminosView'

export const metadata: Metadata = {
  title: 'Términos y Condiciones de Uso',
  description:
    'Términos y condiciones de uso de BarrioTech para compradores y vendedores en Colombia.',
  alternates: {
    canonical: 'https://barriotech.com.co/terminos',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function TermsPage() {
  return <TerminosView />
}
