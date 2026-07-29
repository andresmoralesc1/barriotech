import type { Metadata } from 'next'
import { ContactoView } from '@/components/marketing/ContactoView'

export const metadata: Metadata = {
  title: 'Contacto — Habla con el equipo de BarrioTech',
  description:
    '¿Tienes preguntas o sugerencias sobre BarrioTech? Escríbenos y te responderemos lo antes posible por correo electrónico, teléfono o mediante el formulario en línea.',
  alternates: {
    canonical: 'https://barriotech.com.co/contacto',
  },
}

export default function ContactPage() {
  return <ContactoView />
}
