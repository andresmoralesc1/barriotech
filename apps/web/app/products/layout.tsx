import type { Metadata } from 'next'

// Metadata for the products page. The page itself is 'use client'
// (interactive filters), so metadata lives in this sibling layout.
export const metadata: Metadata = {
  title: 'Productos — Gestiona tu catálogo',
  description:
    'Agrega, edita y organiza los productos de tu tienda en BarrioTech. Sube fotos, define precios y mantén tu catálogo actualizado.',
  alternates: {
    canonical: '/products',
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'BarrioTech — Productos',
    description: 'Gestiona el catálogo de productos de tu tienda.',
    url: 'https://barriotech.com.co/products',
  },
}

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children
}
