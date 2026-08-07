'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Heart, Trash2, MapPin, Star, Store, Apple, UtensilsCrossed, CupSoda, Palette, Shirt, Package, GraduationCap, Sparkles, Scissors, Wrench, PartyPopper } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'
import type { VendorCategory } from '@/lib/core/types'

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

interface FavoriteVendor {
  id: string
  vendorId: string
  vendorSlug?: string
  vendorName: string
  category: VendorCategory
  imageUrl: string | null
  ratingAvg: number
  reviewCount: number
}

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState('')
  const user = useStore((s) => s.user)
  const _hasHydrated = useStore((s) => s._hasHydrated)
  const removeFavorite = useStore((s) => s.removeFavorite)
  const addFavorite = useStore((s) => s.addFavorite)
  const favoriteIds = useStore((s) => s.favoriteIds)

  // Load favorites from API on mount
  useEffect(() => {
    if (!_hasHydrated || !user) {
      setLoading(false)
      return
    }

    fetch('/api/favorites', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.favorites) {
          setFavorites(data.favorites)
        }
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [_hasHydrated, user])

  const handleRemove = useCallback(async (favorite: FavoriteVendor) => {
    if (!user) return
    setRemovingId(favorite.id)
    setRemoveError('')
    // Optimistic remove
    setFavorites((prev) => prev.filter((f) => f.id !== favorite.id))
    removeFavorite(favorite.vendorId)
    try {
      const res = await fetch(`/api/favorites?vendorId=${favorite.vendorId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Delete failed')
    } catch {
      // Rollback
      setFavorites((prev) => [favorite, ...prev])
      if (!favoriteIds.includes(favorite.vendorId)) {
        addFavorite(favorite.vendorId)
      }
      setRemoveError('No se pudo eliminar. Intenta de nuevo.')
    } finally {
      setRemovingId(null)
    }
  }, [user, removeFavorite, addFavorite, favoriteIds])

  // Loading state
  if (!_hasHydrated || loading) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-background-cream">
        <header className="bg-white shadow-sm p-4">
          <h1 className="text-xl font-bold">Mis Favoritos</h1>
        </header>
        <div className="p-4 text-center py-12">
          <Heart size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 mb-4">Inicia sesión para ver tus favoritos</p>
          <Link href="/login">
            <Button variant="primary">Iniciar Sesión</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background-cream pb-20">
      {/* Header */}
      <header className="bg-white shadow-sm p-4">
        <h1 className="text-xl font-bold">Mis Favoritos</h1>
        <p className="text-sm text-gray-500">
          {favorites.length} {favorites.length === 1 ? 'vendedor guardado' : 'vendedores guardados'}
        </p>
        {removeError && (
          <p className="text-red-500 text-sm mt-1">{removeError}</p>
        )}
      </header>

      <div className="p-4 max-w-4xl mx-auto">
        {favorites.length === 0 ? (
          <Card variant="outlined" className="p-8 text-center">
            <Heart size={48} className="mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-bold mb-2">No tienes favoritos aún</h2>
            <p className="text-gray-500 mb-4">
              Toca el corazón en cualquier vendedor para guardarlo aquí
            </p>
            <Link href="/map">
              <Button>Explorar vendedores</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {favorites.map((fav) => {
              const IconComponent = CategoryIconMap[fav.category] || Store
              return (
                <Card key={fav.id} variant="outlined" className="overflow-hidden p-0">
                  {/* Photo */}
                  <Link
                    href={`/vendor/${fav.vendorSlug || fav.vendorId}`}
                    className="block aspect-video bg-gray-100 relative overflow-hidden"
                  >
                    {fav.imageUrl ? (
                      <img
                        src={fav.imageUrl}
                        alt={fav.vendorName}
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-primary-200">
                        <IconComponent size={48} className="text-primary-700" />
                      </div>
                    )}
                  </Link>

                  {/* Info */}
                  <div className="p-4">
                    <Link href={`/vendor/${fav.vendorSlug || fav.vendorId}`} className="block">
                      <h3 className="font-bold text-lg mb-1 hover:text-primary-700 transition-colors line-clamp-1">
                        {fav.vendorName}
                      </h3>
                    </Link>

                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                      <span className="capitalize">{fav.category}</span>
                      {fav.ratingAvg > 0 && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Star size={14} className="text-yellow-500 fill-yellow-500" />
                            {fav.ratingAvg.toFixed(1)} ({fav.reviewCount})
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <Link href={`/vendor/${fav.vendorSlug || fav.vendorId}`} className="flex-1">
                        <Button size="sm" variant="primary" className="w-full">
                          <MapPin size={14} className="mr-1" />
                          Ver
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleRemove(fav)}
                        isLoading={removingId === fav.id}
                        aria-label={`Quitar ${fav.vendorName} de favoritos`}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Bottom Nav (mobile) — aria-label avoids landmark-unique violation. */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-3 md:hidden" aria-label="Navegación de la cuenta">
        <Link href="/map" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <MapPin size={24} />
          <span className="text-xs mt-1">Mapa</span>
        </Link>
        <Link href="/favorites" className="flex flex-col items-center text-primary-700">
          <Heart size={24} fill="currentColor" />
          <span className="text-xs mt-1">Favoritos</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          <span className="text-xs mt-1">Ajustes</span>
        </Link>
      </nav>
    </div>
  )
}
