import type { Metadata } from 'next'
import { ComoFuncionaView } from '@/components/marketing/ComoFuncionaView'

export const metadata: Metadata = {
  title: 'Cómo funciona — Para compradores y vendedores',
  description:
    'Aprende cómo BarrioTech conecta compradores con vendedores informales en Colombia. Mapa en tiempo real, favoritos, reseñas y sin comisiones.',
  alternates: {
    canonical: 'https://barriotech.com.co/como-funciona',
  },
}

export default function ComoFuncionaPage() {
  return <ComoFuncionaView />
}
