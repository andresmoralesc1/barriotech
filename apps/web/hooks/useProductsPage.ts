'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { validateProduct, hasErrors } from '@/lib/products/validation'
import type { VendorCategory, ServiceModality, ServicePricingUnit } from '@/lib/core/types'

export interface Product {
  id: string
  vendor_id: string
  name: string
  description: string
  price: number
  photo_url: string | null
  // Sprint 6 D.1: per-product publish/unpublish toggle. New products
  // default to true (column default). Sellers hide a product by setting
  // this to false via PATCH /api/products/[id].
  is_active: boolean
  // Migration 102: discriminator + service-only fields. Product rows
  // (existing) have kind='product' and the three service fields are
  // null. Service rows have all three populated.
  kind?: 'product' | 'service'
  duration_minutes?: number | null
  modality?: ServiceModality | null
  pricing_unit?: ServicePricingUnit | null
}

export interface ProductFormSnapshot {
  name: string
  description: string
  price: string
  photoUrl: string
}

export interface ProductValidationErrors {
  name?: string
  description?: string
  price?: string
  photoUrl?: string
}

interface UseProductsPage {
  // data
  vendorId: string | null
  // Migration 102: vendor.category drives the form shape (product vs
  // service). null until /api/vendors/me resolves.
  vendorCategory: VendorCategory | null
  isServiceCategory: boolean
  products: Product[]
  // Sprint 8 D.2: derived count of is_active=false products, so the header
  // can show a "Tienes N ocultos" hint when the seller has paused items.
  hiddenCount: number
  loading: boolean
  // form state
  showForm: boolean
  editingId: string | null
  formName: string
  formDescription: string
  formPrice: string
  formPhotoUrl: string
  formSaving: boolean
  formError: string
  formSuccess: string
  fieldErrors: ProductValidationErrors
  touched: Record<string, boolean>
  initialFormSnapshot: ProductFormSnapshot | null
  // Migration 102: service offering form state. Only used when
  // isServiceCategory; rendered as conditional inputs.
  formDurationMinutes: string
  formModality: ServiceModality | ''
  formPricingUnit: ServicePricingUnit | ''
  // delete
  deleteId: string | null
  deleteError: string
  // discard confirm
  confirmDiscardOpen: boolean
  // derived
  isFormDirty: boolean
  // Sprint 6 D.1: per-product toggle state
  togglingId: string | null
  toggleError: string
  // form setters
  setFormName: (v: string) => void
  setFormDescription: (v: string) => void
  setFormPrice: (v: string) => void
  setFormPhotoUrl: (v: string) => void
  // Migration 102: service field setters
  setFormDurationMinutes: (v: string) => void
  setFormModality: (v: ServiceModality | '') => void
  setFormPricingUnit: (v: ServicePricingUnit | '') => void
  setShowForm: (b: boolean) => void
  setTouched: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  // actions
  revalidate: () => ProductValidationErrors
  handleAdd: () => Promise<void>
  handleEdit: (productId: string) => Promise<void>
  handleDelete: () => Promise<void>
  // Sprint 6 D.1: toggle a product's is_active flag. Optimistic UI —
  // we flip the local state immediately, then reconcile when the API
  // returns. On error we revert and surface the message.
  toggleActive: (productId: string, nextActive: boolean) => Promise<void>
  startEdit: (product: Product) => void
  resetForm: () => void
  tryCloseForm: () => void
  tryGoBack: () => void
  discardChanges: () => void
  setDeleteId: (id: string | null) => void
  setConfirmDiscardOpen: (b: boolean) => void
}

/**
 * All state + side effects for the seller /products page:
 *  - fetches vendor id and product list (with defensive shape accept for
 *    an in-flight API deploy — see /api/vendors/me response shapes)
 *  - owns the add/edit form state (name/description/price/photoUrl +
 *    per-field validation + touched tracking)
 *  - exposes actions: handleAdd/handleEdit/handleDelete with optimistic
 *    updates, plus the discard-changes flow that gates the back button
 *    and form-close when there are unsaved edits
 *  - registers a beforeunload guard while the form is dirty so refresh /
 *    tab-close doesn't silently lose data
 */
export function useProductsPage(): UseProductsPage {
  const router = useRouter()
  const user = useStore((s) => s.user)

  // data
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [vendorCategory, setVendorCategory] = useState<VendorCategory | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  // Migration 102: true iff the seller's vendor category is one of the
  // 5 service categories. Drives which form fields render and which
  // `kind` value is sent on POST. Recomputed each render — vendorCategory
  // rarely changes, so the cost is trivial.
  const isServiceCategory =
    vendorCategory === 'clases' ||
    vendorCategory === 'bienestar' ||
    vendorCategory === 'belleza' ||
    vendorCategory === 'hogar' ||
    vendorCategory === 'eventos'

  // form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [formPhotoUrl, setFormPhotoUrl] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [fieldErrors, setFieldErrors] = useState<ProductValidationErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [initialFormSnapshot, setInitialFormSnapshot] = useState<ProductFormSnapshot | null>(null)
  // Migration 102: service offering form state. Empty strings for
  // selects (HTML <select> requires a string value).
  const [formDurationMinutes, setFormDurationMinutes] = useState('')
  const [formModality, setFormModality] = useState<ServiceModality | ''>('')
  const [formPricingUnit, setFormPricingUnit] = useState<ServicePricingUnit | ''>('')

  // delete + discard
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  // Load vendorId + products on mount.
  useEffect(() => {
    if (user?.role !== 'seller' && user?.role !== 'service') {
      // Seller-only page. Role is immutable post-register, so redirect
      // non-sellers to the public map. If they need a seller account,
      // they must register a new one.
      router.push('/map')
      return
    }

    let cancelled = false
    fetch('/api/vendors/me', { credentials: 'include' })
      // B-032 fix: 401 = session expired. Other errors surface a generic
      // message. Previously r.json() could parse an HTML error page and
      // leave loading=true forever.
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 401) router.push('/login')
          if (!cancelled) setLoading(false)
          return null
        }
        return r.json()
      })
      .then((data) => {
        if (cancelled || !data) return
        const list = data.vendors ?? (data.vendor ? [data.vendor] : [])
        const firstVendor = list[0]
        if (!firstVendor) {
          setLoading(false)
          return
        }
        setVendorId(firstVendor.id)
        // Migration 102: capture vendor category so the form can render
        // service fields when applicable. The DB CHECK already enforces
        // 11 valid values; we trust the API response here.
        if (typeof firstVendor.category === 'string') {
          setVendorCategory(firstVendor.category as VendorCategory)
        }
        return fetch(`/api/products?vendorId=${firstVendor.id}`, { credentials: 'include' })
      })
      .then((r) => r?.json())
      .then((data) => {
        if (cancelled) return
        if (data?.products) setProducts(data.products)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.role, router])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormDescription('')
    setFormPrice('')
    setFormPhotoUrl('')
    setShowForm(false)
    setEditingId(null)
    setFieldErrors({})
    setTouched({})
    // Migration 102: clear service field state too so a subsequent
    // "Agregar" starts clean.
    setFormDurationMinutes('')
    setFormModality('')
    setFormPricingUnit('')
  }, [])

  // True if the user has typed something that hasn't been saved.
  const isFormDirty = useMemo(() => {
    if (!showForm) return false
    if (initialFormSnapshot) {
      return (
        formName !== initialFormSnapshot.name ||
        formDescription !== initialFormSnapshot.description ||
        formPrice !== initialFormSnapshot.price ||
        formPhotoUrl !== initialFormSnapshot.photoUrl
      )
    }
    // Migration 102: for service-category vendors, treat any service
    // field as dirty. For product vendors, the original 4 fields cover
    // it.
    const serviceDirty =
      isServiceCategory && Boolean(formDurationMinutes || formModality || formPricingUnit)
    return Boolean(
      formName.trim() ||
      formDescription.trim() ||
      formPrice.trim() ||
      formPhotoUrl.trim() ||
      serviceDirty
    )
  }, [
    showForm,
    initialFormSnapshot,
    formName,
    formDescription,
    formPrice,
    formPhotoUrl,
    formDurationMinutes,
    formModality,
    formPricingUnit,
    isServiceCategory,
  ])

  // Warn before tab close / refresh if there are unsaved changes.
  useEffect(() => {
    if (!isFormDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isFormDirty])

  // Re-validate against the live state. Called on blur and on submit.
  // Returns the error map so the caller can block submit.
  const revalidate = useCallback(() => {
    const errs = validateProduct({
      name: formName,
      description: formDescription,
      price: formPrice,
      photoUrl: formPhotoUrl,
    })
    setFieldErrors(errs)
    return errs
  }, [formName, formDescription, formPrice, formPhotoUrl])

  const handleAdd = useCallback(async () => {
    if (!vendorId) return
    const errs = revalidate()
    setTouched({ name: true, description: true, price: true, photoUrl: true })
    if (hasErrors(errs)) {
      setFormError('Revisa los campos marcados')
      return
    }
    const priceNum = parseFloat(formPrice)
    setFormSaving(true)
    setFormError('')
    setFormSuccess('')
    // Migration 102: when the vendor is a service-category seller,
    // attach kind='service' + the 3 service-only fields. Product
    // sellers send only the original 4 fields — server treats missing
    // kind as 'product'.
    const body: Record<string, unknown> = {
      name: formName,
      description: formDescription,
      price: priceNum,
      photo_url: formPhotoUrl || null,
      vendor_id: vendorId,
    }
    if (isServiceCategory) {
      // Lightweight client validation: the API re-validates these
      // server-side too (POST /api/products). Surface the message
      // before round-tripping so the seller sees the error inline.
      const dur = Number(formDurationMinutes)
      if (!Number.isFinite(dur) || dur < 5 || dur > 600) {
        setFormError('Duración inválida (5-600 minutos)')
        setFormSaving(false)
        return
      }
      if (!formModality || !formPricingUnit) {
        setFormError('Selecciona modalidad y unidad de precio')
        setFormSaving(false)
        return
      }
      body.kind = 'service'
      body.duration_minutes = Math.round(dur)
      body.modality = formModality
      body.pricing_unit = formPricingUnit
    }
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setProducts((prev) => [data.product, ...prev])
        resetForm()
        setFormSuccess(
          isServiceCategory ? 'Servicio agregado ✅' : 'Producto agregado ✅'
        )
        setTimeout(() => setFormSuccess(''), 3000)
      } else {
        const data = await res.json()
        setFormError(data.error || 'Error al guardar')
      }
    } catch {
      setFormError('Error de conexión')
    }
    setFormSaving(false)
  }, [
    vendorId,
    formName,
    formDescription,
    formPrice,
    formPhotoUrl,
    formDurationMinutes,
    formModality,
    formPricingUnit,
    isServiceCategory,
    revalidate,
    resetForm,
  ])

  const handleEdit = useCallback(
    async (productId: string) => {
      const errs = revalidate()
      setTouched({ name: true, description: true, price: true, photoUrl: true })
      if (hasErrors(errs)) {
        setFormError('Revisa los campos marcados')
        return
      }
      const priceNum = parseFloat(formPrice)
      setFormSaving(true)
      setFormError('')
      setFormSuccess('')
      try {
        const res = await fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: formName,
            description: formDescription,
            price: priceNum,
            photo_url: formPhotoUrl || null,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          setProducts((prev) => prev.map((p) => (p.id === productId ? data.product : p)))
          resetForm()
          setFormSuccess('Cambios guardados ✅')
          setTimeout(() => setFormSuccess(''), 3000)
        } else {
          const data = await res.json()
          setFormError(data.error || 'Error al guardar')
        }
      } catch {
        setFormError('Error de conexión')
      }
      setFormSaving(false)
    },
    [formName, formDescription, formPrice, formPhotoUrl, revalidate, resetForm]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/products/${deleteId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => p.id !== deleteId))
        setDeleteId(null)
      } else {
        setDeleteError('No se pudo eliminar')
      }
    } catch {
      setDeleteError('Error de conexión')
    }
  }, [deleteId])

  const startEdit = useCallback((product: Product) => {
    const snap: ProductFormSnapshot = {
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      photoUrl: product.photo_url || '',
    }
    setFormName(snap.name)
    setFormDescription(snap.description)
    setFormPrice(snap.price)
    setFormPhotoUrl(snap.photoUrl)
    // Migration 102: populate service state when editing a service row
    // so the seller sees the existing duration/modality/pricing_unit
    // pre-filled. PATCH rejects changes to these fields (handled
    // server-side); we only display them.
    setFormDurationMinutes(
      product.kind === 'service' && product.duration_minutes != null
        ? String(product.duration_minutes)
        : ''
    )
    setFormModality(
      product.kind === 'service' && product.modality != null ? product.modality : ''
    )
    setFormPricingUnit(
      product.kind === 'service' && product.pricing_unit != null ? product.pricing_unit : ''
    )
    setEditingId(product.id)
    setInitialFormSnapshot(snap)
    setShowForm(true)
  }, [])

  // Funnel for "user tries to close the form / navigate back with unsaved edits".
  const tryCloseForm = useCallback(() => {
    if (isFormDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    resetForm()
  }, [isFormDirty, resetForm])

  const tryGoBack = useCallback(() => {
    if (isFormDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    router.push('/dashboard')
  }, [isFormDirty, router])

  const discardChanges = useCallback(() => {
    setConfirmDiscardOpen(false)
    resetForm()
  }, [resetForm])

  // Sprint 6 D.1: toggle a product's is_active flag with optimistic UI.
  // The flow:
  //   1. flip the local state immediately (UI feels instant)
  //   2. send PATCH /api/products/[id]
  //   3. on success, reconcile the local state with the server response
  //   4. on failure, revert and surface the error
  // We guard against double-taps by setting togglingId for the duration
  // of the network round-trip.
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string>('')

  const toggleActive = useCallback(
    async (productId: string, nextActive: boolean) => {
      // Prevent double-tap.
      if (togglingId) return
      const prevSnapshot = products
      // Optimistic update
      setProducts((curr) =>
        curr.map((p) => (p.id === productId ? { ...p, is_active: nextActive } : p)),
      )
      setTogglingId(productId)
      setToggleError('')
      try {
        const res = await fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ isActive: nextActive }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({} as { error?: string }))
          throw new Error(j.error || `HTTP ${res.status}`)
        }
        // Reconcile with server response (it may include other fields
        // we don't display but consistency matters).
        const j = await res.json() as { product?: { is_active?: boolean } }
        if (j.product && typeof j.product.is_active === 'boolean') {
          setProducts((curr) =>
            curr.map((p) =>
              p.id === productId ? { ...p, is_active: j.product!.is_active! } : p,
            ),
          )
        }
      } catch (err) {
        // Revert optimistic update.
        setProducts(prevSnapshot)
        setToggleError(
          err instanceof Error ? err.message : 'No se pudo cambiar la visibilidad del producto',
        )
      } finally {
        setTogglingId(null)
      }
    },
    [togglingId, products],
  )

  return {
    // data
    vendorId,
    // Migration 102: vendor category drives the form shape.
    vendorCategory,
    isServiceCategory,
    products,
    // Sprint 8 D.2: derived count of is_active=false products.
    // Recomputed on every render — it's just a filter on `products`, so
    // we don't memoize. With ≤100 products per vendor the cost is trivial.
    hiddenCount: products.filter((p) => !p.is_active).length,
    loading,
    // form state
    showForm,
    editingId,
    formName,
    formDescription,
    formPrice,
    formPhotoUrl,
    formSaving,
    formError,
    formSuccess,
    fieldErrors,
    touched,
    initialFormSnapshot,
    // Migration 102: service offering form state.
    formDurationMinutes,
    formModality,
    formPricingUnit,
    // delete + discard
    deleteId,
    deleteError,
    confirmDiscardOpen,
    // derived
    isFormDirty,
    // Sprint 6 D.1: per-product toggle state
    togglingId,
    toggleError,
    // setters
    setFormName,
    setFormDescription,
    setFormPrice,
    setFormPhotoUrl,
    // Migration 102: service field setters
    setFormDurationMinutes,
    setFormModality,
    setFormPricingUnit,
    setShowForm,
    setTouched,
    // actions
    revalidate,
    handleAdd,
    handleEdit,
    handleDelete,
    // Sprint 6 D.1: per-product publish/unpublish toggle
    toggleActive,
    startEdit,
    resetForm,
    tryCloseForm,
    tryGoBack,
    discardChanges,
    setDeleteId,
    setConfirmDiscardOpen,
  }
}
