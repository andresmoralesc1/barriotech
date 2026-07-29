import type { Metadata } from 'next'
import { PrivacidadView } from '@/components/marketing/PrivacidadView'

export const metadata: Metadata = {
  title: 'Política de Privacidad y Tratamiento de Datos',
  description:
    'Política de Tratamiento de Datos Personales de BarrioTech conforme a la Ley 1581 de 2012 de Colombia. Cómo recopilamos, usamos y protegemos tu información.',
  alternates: {
    canonical: 'https://barriotech.com.co/privacidad',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PrivacyPage() {
  return <PrivacidadView />
}
