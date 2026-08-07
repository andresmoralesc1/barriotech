'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import {
  Star, Apple, UtensilsCrossed, CupSoda, Palette, Shirt, Package,
  GraduationCap, Sparkles, Scissors, Wrench, PartyPopper,
  ChevronRight, MapPin, Phone,
  TrendingUp, Calendar, Eye,
} from 'lucide-react'
import { getCategoryInfo } from '@/lib/core/constants'
import type { VendorCategory } from '@/lib/core/types'
import { toast } from '@/components/ui/Toast'
import { ChecklistItem } from '@/components/seller/ChecklistItem'
import { OrderRow, type Order } from '@/components/seller/OrderRow'
import { formatPrice } from '@/lib/format'
import { clientLog } from '@/lib/client-logger'

const CategoryIconMap: Record<VendorCategory, typeof Apple> = {
  frutas: Apple,
  comida: UtensilsCrossed,
  bebidas: CupSoda,
  artesanias: Palette,
  ropa: Shirt,
  otros: Package,
  // service categories — migration 102
  clases: GraduationCap,
  bienestar: Sparkles,
  belleza: Scissors,
  hogar: Wrench,
  eventos: PartyPopper,
}

interface SellerDashboardProps {
  vendorId: string
  // Raw products from the parent's stats endpoint (snake_case fields).
  products?: ProductRow[]
  productCount?: number
  vendorPhotoUrl?: string | null
  // Optional initial vendor fields from the parent (avoids the round-trip
  // of fetching stats just to render the vendor name/description/photo).
  initialVendorName?: string
  initialVendorDescription?: string
  initialVendorPhotoUrl?: string | null
  onOrderAction?: (action: string, orderId?: string) => void
}

// Local row shape for the products passed in via SellerDashboardProps. Mirrors
// the raw row returned by GET /api/vendors/[id]/stats (snake_case) — only the
// fields the dashboard reads are typed.
interface ProductRow {
  id: string
  name: string
  photo_url?: string | null
  price?: number | string
  description?: string | null
}

// Local view-model for the vendor info card. The dashboard merges fields from
// the parent's initial props and the /stats endpoint, which use slightly
// different shapes (photoUrl vs review_count), so we normalize here.
interface VendorSummary {
  id: string
  name: string
  description: string
  category: VendorCategory
  photoUrl?: string | null
  isVerified?: boolean
  latitude?: number
  phone?: string
  rating?: number
  // stats endpoint returns review_count; kept for downstream consumers that
  // may read it. Not rendered by this component.
  review_count?: number
}

interface VendorStats {
  viewsToday: number
  totalOrders: number
  rating: number
  reviewCount: number
  weeklyViews: number
  weeklyOrders: number
  conversionRate: number
  rankPercentile?: number // 0-100; lower = better ranking
}

// Order shape moved to ./OrderRow on 2026-07-21. Imported as `Order` above.

export function SellerDashboard({
  vendorId,
  products = [],
  productCount = 0,
  vendorPhotoUrl = null,
  initialVendorName,
  initialVendorDescription,
  initialVendorPhotoUrl,
  onOrderAction,
}: SellerDashboardProps) {
  const [vendor, setVendor] = useState<VendorSummary | null>(initialVendorName
    ? {
        id: vendorId,
        name: initialVendorName,
        description: initialVendorDescription ?? '',
        category: 'otros',
        photoUrl: initialVendorPhotoUrl ?? null,
      }
    : null
  )
  const [stats, setStats] = useState<VendorStats>({
    viewsToday: 0, totalOrders: 0, rating: 0, reviewCount: 0,
    weeklyViews: 0, weeklyOrders: 0, conversionRate: 0,
  })
  // Pre-seed the vendor from the parent's props so the info card renders
  // immediately on first paint (no FOUC). The stats loadAll below overwrites
  // these values as soon as the API returns.
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // B7 fix: vendor data is passed via /api/vendors/me from parent.
      // Fetch only vendor-specific extras here (stats + orders).
      // Also pass via prop ideally; for now stats endpoint returns enough.
      const [statsRes, ordersRes] = await Promise.all([
        fetch(`/api/vendors/${vendorId}/stats`, { credentials: 'include' }),
        fetch(`/api/orders`, { credentials: 'include' }),
      ])

      // B9 fix: surface errors instead of silent fallback.
      if (!statsRes.ok) {
        setLoadError('No pudimos cargar tus estadísticas')
      }
      const statsData = statsRes.ok
        ? await statsRes.json()
        : { viewsToday: 0, totalOrders: 0, rating: 0, reviewCount: 0, weeklyViews: 0, weeklyOrders: 0, conversionRate: 0 }

      const ordersData = ordersRes.ok
        ? await ordersRes.json()
        : { orders: [] }

      // B3 fix: Number(...) || 0 prevents NaN.
      const rating = Number(statsData.rating) || 0
      const viewsToday = Number(statsData.viewsToday) || 0
      const totalOrders = Number(statsData.totalOrders) || 0
      const weeklyViews = Number(statsData.weeklyViews) || 0
      const weeklyOrders = Number(statsData.weeklyOrders) || 0
      // N8: conversion rate (orders / views, percentage).
      const conversionRate = weeklyViews > 0
        ? Math.round((weeklyOrders / weeklyViews) * 100)
        : 0

      setStats({
        viewsToday,
        totalOrders,
        rating,
        reviewCount: Number(statsData.reviewCount) || 0,
        weeklyViews,
        weeklyOrders,
        conversionRate,
        rankPercentile: statsData.rankPercentile,
      })
      setOrders(ordersData.orders ?? [])
      // Minimal vendor shape for downstream rendering (slug, category, name).
      // Always replace, not `prev ?? {...}` — otherwise the stub from the
      // first load would persist forever and changes to vendor.name/photo
      // (e.g. from /profile/edit) would never appear here.
      setVendor({
        id: vendorId,
        name: statsData.vendorName ?? 'Tu tienda',
        description: statsData.description ?? '',
        category: statsData.category ?? 'otros',
        // QSC-1: prefer the fresh photo from the stats endpoint so the
        // checklist re-evaluates after the seller updates their photo in
        // /profile/edit (vendorPhotoUrl prop is stale in that flow).
        photoUrl: statsData.photoUrl ?? vendorPhotoUrl ?? initialVendorPhotoUrl ?? null,
        rating,
        review_count: statsData.reviewCount,
      })
    } catch (err) {
      // B-003 fix: use clientLog instead of console.error so we don't
      // pollute the seller's DevTools in dev mode.
      clientLog.error('SellerDashboard load error:', err)
      setLoadError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // N4: poll every 30s for new orders. B-002 fix: skip the tick when
    // the tab is hidden — saves DB queries + battery when the seller
    // backgrounds the dashboard.
    const interval = setInterval(() => {
      if (!document.hidden) loadAll()
    }, 30000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId])

  // N4: detect new orders via id-diff and toast.
  useEffect(() => {
    if (!orders.length) return
    try {
      const seen = JSON.parse(sessionStorage.getItem('seen_order_ids') || '[]') as string[]
      const newest = orders[0]
      if (newest && !seen.includes(newest.id)) {
        const isFirstLoad = seen.length === 0
        if (!isFirstLoad && newest.status === 'pending') {
          toast({ title: `🔔 Nuevo pedido de ${newest.buyer_name}`, kind: 'info' })
        }
        const newSeen = [newest.id, ...seen].slice(0, 50)
        sessionStorage.setItem('seen_order_ids', JSON.stringify(newSeen))
      }
    } catch {
      // sessionStorage might be unavailable
    }
  }, [orders])

  if (loadError && !vendor) {
    return (
      <Card variant="outlined" className="p-4 text-center">
        <p className="text-sm text-red-600 mb-3">{loadError}</p>
        <button
          type="button"
          onClick={loadAll}
          className="text-sm text-primary font-medium hover:underline"
        >
          Reintentar
        </button>
      </Card>
    )
  }

  if (loading || !vendor) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} variant="outlined" className="p-4 text-center animate-pulse">
              <div className="h-8 bg-gray-200 rounded mb-2" />
              <div className="h-4 bg-gray-100 rounded w-2/3 mx-auto" />
            </Card>
          ))}
        </div>
        <Card variant="elevated" className="p-4 animate-pulse">
          <div className="flex gap-4">
            <div className="w-16 h-16 bg-gray-200 rounded-xl" />
            <div className="flex-1">
              <div className="h-6 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/4" />
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const category = getCategoryInfo(vendor.category)
  const IconComponent = CategoryIconMap[vendor.category as VendorCategory] ?? Package

  // N10: WhatsApp link helper.
  const whatsappLink = (order: Order) => {
    if (!order.buyer_phone) return null
    const cleanPhone = order.buyer_phone.replace(/\D/g, '')
    const text = encodeURIComponent(`Hola ${order.buyer_name}, soy de ${vendor.name}. Sobre tu pedido...`)
    return `https://wa.me/${cleanPhone}?text=${text}`
  }

  return (
    <div className="space-y-4">
      {/* Stats grid — N8 conversion + N9 live viewers + N7 weekly summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card variant="outlined" className="p-4 text-center">
          <p className="text-3xl font-bold text-primary">{stats.viewsToday}</p>
          <p className="text-sm text-gray-500">Vistos hoy</p>
        </Card>
        <Card variant="outlined" className="p-4 text-center">
          <p className="text-3xl font-bold text-secondary">{stats.totalOrders}</p>
          <p className="text-sm text-gray-500">Pedidos</p>
        </Card>
        <Card variant="outlined" className="p-4 text-center">
          <p className="text-3xl font-bold text-yellow-500">
            {/* Guard: stats.rating can be null when the vendor has no reviews.
                Matches the pattern in VendorCard / VendorProfile. */}
            {typeof stats.rating === 'number' ? stats.rating.toFixed(1) : '—'}
          </p>
          <p className="text-sm text-gray-500">Rating</p>
        </Card>
      </div>

      {/* N7: Weekly summary card */}
      {stats.weeklyViews > 0 || stats.weeklyOrders > 0 ? (
        <Card variant="outlined" className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-primary" />
            <h3 className="font-semibold text-gray-800">Tu semana</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <Eye size={12} /> Vistas
              </div>
              <p className="text-2xl font-bold">{stats.weeklyViews}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <Package size={12} /> Pedidos
              </div>
              <p className="text-2xl font-bold text-secondary">{stats.weeklyOrders}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <TrendingUp size={12} /> Conv.
              </div>
              <p className="text-2xl font-bold text-green-600">{stats.conversionRate}%</p>
            </div>
          </div>
          {stats.conversionRate > 0 && (
            <p className="text-xs text-gray-500 mt-3 text-center">
              {stats.conversionRate >= 10
                ? '🔥 ¡Excelente conversión! Sigue así.'
                : stats.conversionRate >= 5
                ? '👍 Buena tasa. Añade más fotos para mejorar.'
                : '💡 Añade fotos a tus productos para atraer más clientes.'}
            </p>
          )}
        </Card>
      ) : null}

      {/* N15: Weekly ranking */}
      {typeof stats.rankPercentile === 'number' && (
        <Card variant="outlined" className="p-4 bg-gradient-to-r from-purple-50 to-pink-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">
              {stats.rankPercentile}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-800">
                Top {stats.rankPercentile}% en tu categoría
              </p>
              <p className="text-xs text-gray-600">Esta semana en tu ciudad</p>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Start Checklist */}
      <Card variant="outlined" className="p-4">
        <h3 className="font-semibold text-gray-800 mb-3">Quick Start Checklist</h3>
        <div className="space-y-2">
          <ChecklistItem done={!!vendor.name} label="Nombre del negocio" />
          <ChecklistItem done={!!vendor.description} label="Descripción" />
          <ChecklistItem done={!!vendor.category && vendor.category !== 'otros'} label="Categoría" />
          <ChecklistItem done={!!vendor.photoUrl} label="Foto de perfil" />
          <ChecklistItem done={productCount > 0} label="Agregar productos" />
          <ChecklistItem done={!!vendor.latitude} label="Ubicación (mapa o GPS)" />
          <ChecklistItem done={!!vendor.phone} label="WhatsApp" />
        </div>
      </Card>

      {/* Empty state - Tu primer pedido */}
      {stats.totalOrders === 0 && (
        <Card variant="outlined" className="p-8 text-center">
          <div className="flex justify-center mb-4">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="20" width="60" height="50" rx="4" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="2"/>
              <rect x="20" y="10" width="40" height="15" rx="2" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="2"/>
              <rect x="30" y="35" width="20" height="2" rx="1" fill="#D1D5DB"/>
              <rect x="30" y="41" width="20" height="2" rx="1" fill="#D1D5DB"/>
              <rect x="30" y="47" width="12" height="2" rx="1" fill="#D1D5DB"/>
              <path d="M45 55 L55 65 L70 45" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">Aún no tienes pedidos</h3>
          <p className="text-sm text-gray-500">Añade productos y comparte tu ubicación para empezar a recibir pedidos</p>
        </Card>
      )}

      {/* Info del vendedor */}
      <Card variant="elevated" className="p-4">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center"
            style={{ background: category?.color ?? '#F97316' }}
          >
            <IconComponent size={32} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {vendor.name}
              {vendor.isVerified && (
                // B-006 fix: role="img" + aria-label so screen readers
                // announce "Vendedor verificado" instead of just "✅".
                <span role="img" aria-label="Vendedor verificado">✅</span>
              )}
            </h2>
            <Badge variant="primary">{category?.label ?? vendor.category}</Badge>
          </div>
        </div>
        {vendor.description && (
          <p className="text-gray-600 mt-4">{vendor.description}</p>
        )}
      </Card>

      {/* Orders section — N10 inline order actions */}
      {orders.length > 0 && (
        <Card variant="outlined" className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Pedidos recientes</h3>
            <span className="text-sm text-gray-500">{orders.length} en total</span>
          </div>
          <div className="space-y-3">
            {orders.slice(0, 5).map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                whatsappUrl={whatsappLink(order)}
                onMarkDelivered={(id) => onOrderAction?.('mark_delivered', id)}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Products preview */}
      {productCount > 0 && (
        <Card variant="outlined" className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Mis Productos</h3>
            <span className="text-sm text-gray-500">{productCount} en total</span>
          </div>
          <div className="space-y-2">
            {products.slice(0, 3).map((product) => (
              <div key={product.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                {product.photo_url ? (
                  <img
                    src={product.photo_url}
                    alt={product.name}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <Package size={16} className="text-gray-400" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-medium text-sm">{product.name}</p>
                  <p className="text-primary text-sm font-bold">
                    {/* B-005 fix: always render with .toLocaleString so 1500 and
                        1.500 don't show inconsistently across string/number. */}
                    {formatPrice(product.price)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Link href="/products" className="block mt-3">
            <div className="flex items-center justify-center gap-1 text-primary text-sm font-medium">
              Ver todos
              <ChevronRight size={16} />
            </div>
          </Link>
        </Card>
      )}
    </div>
  )
}

// ChecklistItem moved to ./ChecklistItem on 2026-07-21. Imported above.