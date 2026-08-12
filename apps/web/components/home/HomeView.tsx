'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Users, TrendingUp, Star, ArrowRight, Clock, Shield, Zap, Quote, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useEffect, useState } from 'react'

// Photos from Pexels (Colombian street food / market scenes)
const HERO_PHOTO = '/hero.jpg'
const HERO_PHOTO_WEBP = '/hero.webp'
const STEPS_PHOTOS = [
  'https://images.pexels.com/photos/8824105/pexels-photo-8824105.jpeg?auto=compress&w=600', // encuentra: persona con mapa
  'https://images.pexels.com/photos/37348090/pexels-photo-37348090.jpeg?auto=compress&w=600', // ordena: vendedor ambulante con piñas
  'https://images.pexels.com/photos/5677994/pexels-photo-5677994.jpeg?auto=compress&w=600', // recibe: frutas en mesa de madera
]

const Heart = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
)

const FEATURES_BUYERS = [
  { icon: MapPin, title: 'Vendedores en tiempo real', desc: 'Consulta quién está activo y encuentra opciones cerca de ti', color: 'bg-orange-100 text-orange-600' },
  { icon: Heart, title: 'Guarda tus favoritos', desc: 'Encuentra fácilmente a los vendedores que más te gustan', color: 'bg-red-100 text-red-500' },
  { icon: Star, title: 'Calificaciones de la comunidad', desc: 'Lee calificaciones y comentarios de otros compradores', color: 'bg-yellow-100 text-yellow-600' },
]
const FEATURES_VENDORS = [
  { icon: TrendingUp, title: 'Haz visible tu negocio', desc: 'Permite que compradores cercanos te encuentren en el mapa', color: 'bg-primary-100 text-primary-600' },
  { icon: Clock, title: 'Tú decides cuándo aparecer', desc: 'Activa o desactiva tu ubicación según tu jornada', color: 'bg-green-100 text-green-600' },
  { icon: Shield, title: 'Sin comisiones por venta', desc: 'Tus ventas son tuyas. La promoción destacada es opcional', color: 'bg-purple-100 text-purple-600' },
]

// ponytail: inline icons to avoid extra deps
const ShoppingBag = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)
const Truck = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
    <path d="M15 18H9" />
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
    <circle cx="17" cy="18" r="2" />
    <circle cx="7" cy="18" r="2" />
  </svg>
)

// Stat card — visual evidence without claiming more than is true.
function StatCard({
  value,
  label,
  sublabel,
  icon,
  tone,
}: {
  value: number | string
  label: string
  sublabel?: string
  icon: React.ReactNode
  tone: 'primary' | 'secondary' | 'amber' | 'purple'
}) {
  const toneClass = {
    primary: 'bg-orange-50',
    secondary: 'bg-blue-50',
    amber: 'bg-yellow-50',
    purple: 'bg-purple-50',
  }[tone]

  return (
    <div className={`text-center p-5 rounded-2xl ${toneClass}`}>
      <div className="inline-flex w-10 h-10 rounded-lg bg-white items-center justify-center mb-3">{icon}</div>
      <div className="text-3xl font-bold text-gray-800 mb-1 tabular-nums">{value}</div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {sublabel && <div className="text-xs text-gray-500 mt-1">{sublabel}</div>}
    </div>
  )
}

export function HomeView() {
  const [stats, setStats] = useState({ vendors: 0, cities: 0 })

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => setStats({ vendors: d.activeVendors, cities: d.activeCities }))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-background-cream">
      {/* Hero */}
      <section className="relative min-h-[580px] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <picture>
            <source srcSet={HERO_PHOTO_WEBP} type="image/webp" />
            <img src={HERO_PHOTO} alt="Vendedores locales en Colombia" className="w-full h-full object-cover object-[right_center] md:object-[center_30%]" width="1920" height="700" />
          </picture>
          <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/75 to-gray-900/30" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 py-20 w-full">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mb-6">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-white/90 text-sm font-medium">
                {stats.vendors > 0 ? `${stats.vendors} vendedores activos` : 'Vendedores activos'}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4">
              Encuentra lo mejor de tu barrio,
              <br />
              <span className="text-secondary-light">en tiempo real.</span>
            </h1>
            <p className="text-lg text-white/95 mb-8">
              Descubre vendedores locales cerca de ti, mira qué ofrecen y contáctalos directamente desde el mapa.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/map">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 shadow-xl w-full sm:w-auto">
                  <MapPin size={20} className="mr-2" />
                  Ver vendedores cercanos
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 w-full sm:w-auto">
                  <Zap size={20} className="mr-2" />
                  Publicar mi negocio
                </Button>
              </Link>
            </div>
            {/* Phase F4: secondary service-discovery CTA. The primary
                hero CTAs ("Ver mapa" / "Publicar mi negocio") are
                product-flavored; this third chip surfaces the
                service-categories feature launched in migration 102
                (clases, bienestar, belleza, hogar, eventos). It's
                white-text on the dark hero overlay so it doesn't
                compete with the primary actions above. */}
            <Link
              href="/servicios"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white underline underline-offset-4 decoration-white/40"
            >
              <Sparkles size={14} aria-hidden="true" />
              ¿Buscas clases, masajes o peluquería a domicilio?
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
        {/* Wave */}
        <div className="absolute -bottom-1 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
            <path d="M0 80L60 68.3C120 57 240 34 360 25.7C480 17.3 600 23.7 720 31.7C840 39.7 960 49.3 1080 49.3C1200 49.3 1320 39.7 1380 34.7L1440 30V80H0Z" fill="#FFFBEB" />
          </svg>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="py-16 px-4 bg-background-cream">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-800 mb-3">
            ¿Cómo funciona?
          </h2>
          <p className="text-center text-gray-500 mb-12">Tres pasos para conectar con vendedores de tu barrio</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: 1, icon: MapPin, title: 'Explora', desc: 'Permite tu ubicación o busca por categoría para ver vendedores cercanos.', photo: STEPS_PHOTOS[0] },
              { step: 2, icon: ShoppingBag, title: 'Consulta', desc: 'Revisa sus productos, precios y calificaciones antes de elegir.', photo: STEPS_PHOTOS[1] },
              { step: 3, icon: Truck, title: 'Contacta', desc: 'Habla directamente con el vendedor para coordinar tu pedido.', photo: STEPS_PHOTOS[2] },
            ].map((item) => (
              <div key={item.step} className="bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-shadow">
                <div className="h-40 relative">
                  <img src={item.photo} alt={item.title} className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3 w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm">{item.step}</div>
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-800 mb-2">{item.title}</h3>
                  <p className="text-gray-600 text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Para compradores */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <Users size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Para compradores</h2>
              <p className="text-gray-500 text-sm">Encuentra opciones cercanas y compra directamente</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {FEATURES_BUYERS.map((f) => (
              <div key={f.title} className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl hover:bg-orange-50 transition-colors">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${f.color}`}>
                  <f.icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">{f.title}</h3>
                  <p className="text-gray-500 text-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Para vendedores */}
      <section className="py-16 px-4 bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <TrendingUp size={20} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Para vendedores</h2>
              <p className="text-gray-500 text-sm">Haz visible tu negocio sin pagar comisiones por venta</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {FEATURES_VENDORS.map((f) => (
              <div key={f.title} className="flex items-start gap-4 p-5 bg-white rounded-xl shadow-card hover:shadow-card-hover transition-shadow">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${f.color}`}>
                  <f.icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">{f.title}</h3>
                  <p className="text-gray-500 text-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* En cifras — social proof basado en stats verificables del /api/stats */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <span className="inline-block text-xs font-bold uppercase tracking-wider text-primary-700 mb-3">BarrioTech hoy</span>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-3">La comunidad en el mapa</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              Vendedores y ciudades activas, actualizados en vivo desde la plataforma.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <StatCard
              value={stats.vendors}
              label={stats.vendors === 1 ? 'Vendedor activo' : 'Vendedores activos'}
              icon={<Users size={20} className="text-primary" />}
              tone="primary"
            />
            <StatCard
              value={stats.cities}
              label={stats.cities === 1 ? 'Ciudad operada' : 'Ciudades operadas'}
              icon={<MapPin size={20} className="text-secondary" />}
              tone="secondary"
            />
            <StatCard
              value="Gratis"
              label="Registro y perfil"
              sublabel="Promoción destacada opcional"
              icon={<Star size={20} className="text-yellow-600" />}
              tone="amber"
            />
            <StatCard
              value="0%"
              label="Comisión por venta"
              sublabel="Tus ventas son tuyas"
              icon={<Shield size={20} className="text-purple-600" />}
              tone="purple"
            />
          </div>

          {/* Quote del fundador */}
          <div className="relative max-w-3xl mx-auto bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 rounded-2xl p-8 md:p-10 border border-orange-100">
            <Quote size={36} className="absolute top-4 left-4 text-primary/20" aria-hidden="true" />
            <blockquote className="relative">
              <p className="text-lg md:text-xl text-gray-800 leading-relaxed font-medium italic mb-5 pl-2">
                "Creamos BarrioTech para que los vendedores de barrio puedan usar herramientas digitales sencillas,
                hacerse visibles y conectar con más personas, una ciudad a la vez."
              </p>
              <footer className="flex items-center gap-3 pl-2">
                <div className="relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-primary/30">
                  <Image src="/andres-avatar.png" alt="Andrés Morales" fill className="object-cover" sizes="48px" unoptimized />
                </div>
                <div>
                  <cite className="not-italic font-bold text-gray-800">Andrés Morales</cite>
                  <p className="text-sm text-gray-500">Fundador y CEO · BarrioTech</p>
                </div>
              </footer>
            </blockquote>
          </div>

          {/* Marcos públicos verificables que sustentan nuestra tesis.
              No mostramos logos de medios "as featured in" porque no nos han
              publicado — sí citamos los marcos normativos que respaldan
              la oportunidad de mercado. Solo items públicos. */}
          <div className="mt-12 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Fundamento normativo</p>
            <div className="flex flex-wrap items-center justify-center gap-3 max-w-3xl mx-auto">
              {[
                { name: 'Ley 1581 / 2012', desc: 'Habeas Data · protección de datos personales' },
                { name: 'DANE · GEIH 2024', desc: '55,1% informalidad laboral en Colombia' },
                { name: 'Plan Nacional de Desarrollo 2022–2026', desc: 'Empleo y protección social' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs"
                  title={item.desc}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                  <span className="font-medium text-gray-700">{item.name}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-4 italic">
              Las cifras y marcos en los que se sostiene BarrioTech son públicos y verificables.
            </p>
          </div>
        </div>
      </section>

      {/* Sé el primero */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-3xl p-8 md:p-12 text-center">
            <div className="inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm mb-6">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-gray-600">MVP · Lanzamiento 2026 · Colombia</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-3">
              Sé parte de los primeros barrios en el mapa.
            </h2>
            <p className="text-gray-500 mb-8 max-w-lg mx-auto text-base">
              {stats.cities > 0 || stats.vendors > 0
                ? `${stats.vendors} vendedor${stats.vendors !== 1 ? 'es' : ''} activo${stats.vendors !== 1 ? 's' : ''} · ${stats.cities} ciudad${stats.cities !== 1 ? 'es' : ''} en el mapa. Súmate al MVP de BarrioTech.`
                : 'Estamos preparando el mapa de BarrioTech. Registra tu negocio y sé de los primeros en aparecer.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register">
                <Button size="lg" className="bg-primary hover:bg-primary-700">
                  <MapPin size={18} className="mr-2" />
                  Publicar mi negocio
                </Button>
              </Link>
              <Link href="/map">
                <Button variant="outline" size="lg" className="border-orange-200 text-primary hover:bg-orange-50">
                  Ver vendedores cercanos
                </Button>
              </Link>
            </div>
            <p className="mt-6 text-xs text-gray-400">
              Registro gratuito · Sin comisiones por venta · Publicidad opcional
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
