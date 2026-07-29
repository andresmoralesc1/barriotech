import type { Metadata } from 'next'

// Metadata for the buyer /map segment. The page itself is 'use client'
// (Leaflet can't SSR), so the metadata has to live in a sibling
// 'use server' module — which is exactly what a layout.tsx is for.
export const metadata: Metadata = {
  title: 'Mapa — Vendedores en vivo cerca de ti',
  description:
    'Explora vendedores informales activos en tiempo real. Comida callejera, frutas, artesanías y más — actualizados al instante en el mapa de tu ciudad.',
  alternates: {
    canonical: '/map',
  },
  openGraph: {
    title: 'BarrioTech — Mapa de vendedores en vivo',
    description:
      'Vendedores informales activos cerca de ti, en tiempo real. Comida, frutas, artesanías.',
    url: 'https://barriotech.com.co/map',
    images: [
      { url: '/hero.jpg', width: 1200, height: 630, alt: 'Mapa de vendedores BarrioTech' },
    ],
  },
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children
}
