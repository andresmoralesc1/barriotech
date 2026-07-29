import type { Metadata } from 'next'
import { FaqView } from '@/components/marketing/FaqView'

export const metadata: Metadata = {
  title: 'Preguntas Frecuentes — Todo sobre BarrioTech',
  description:
    'Respuestas a las preguntas frecuentes sobre BarrioTech: cómo funciona, cómo registrarte como vendedor, privacidad, ciudades disponibles y más.',
  alternates: {
    canonical: 'https://barriotech.com.co/preguntas-frecuentes',
  },
}

export default function FaqPage() {
  return <FaqView />
}
