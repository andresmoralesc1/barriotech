'use client'

import Link from 'next/link'
import { Plus, Package, BarChart3, Settings, Camera, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ProductsPageHeader } from '@/components/seller/ProductsPageHeader'
import { ProductForm } from '@/components/seller/ProductForm'
import { ProductCard } from '@/components/seller/ProductCard'
import { DeleteProductModal } from '@/components/seller/DeleteProductModal'
import { DiscardChangesModal } from '@/components/seller/DiscardChangesModal'
import { useProductsPage, type ProductValidationErrors } from '@/hooks/useProductsPage'

/**
 * Seller /products page — composer. All state + side effects live in
 * `useProductsPage`; this component is responsible for layout +
 * composing the focused section components.
 *
 * Sections, in render order:
 *   1. Header (back / title / count)
 *   2. Add button (collapsed) OR ProductForm (expanded)
 *   3. Product list (with ProductCard per item)
 *   4. Bottom nav (account navigation)
 *   5. Delete confirmation modal (if deleteId set)
 *   6. Discard-changes confirmation modal (if confirmDiscardOpen)
 */
export default function ProductsPage() {
  const {
    vendorId,
    // Migration 102: drives whether the form renders service fields.
    isServiceCategory,
    products,
    // Sprint 8 D.2: hidden product count, surfaced in the header.
    hiddenCount,
    loading,
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
    // Migration 102: service offering form state + setters.
    formDurationMinutes,
    formModality,
    formPricingUnit,
    setFormDurationMinutes,
    setFormModality,
    setFormPricingUnit,
    deleteId,
    deleteError,
    confirmDiscardOpen,
    // Sprint 6 D.1: per-product publish/unpublish toggle state
    togglingId,
    toggleError,
    setFormName,
    setFormDescription,
    setFormPrice,
    setFormPhotoUrl,
    setShowForm,
    setTouched,
    revalidate,
    handleAdd,
    handleEdit,
    handleDelete,
    toggleActive,
    startEdit,
    tryCloseForm,
    tryGoBack,
    discardChanges,
    setDeleteId,
    setConfirmDiscardOpen,
  } = useProductsPage()

  // Per-field blur handler — re-runs the validator and marks the field
  // as touched so subsequent onChange re-validates too.
  const onFieldBlur = (field: keyof ProductValidationErrors) => {
    setTouched((t) => ({ ...t, [field]: true }))
    revalidate()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background-cream flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    )
  }

  if (!vendorId) {
    return (
      <div className="min-h-screen bg-background-cream pb-20">
        <ProductsPageHeader onBack={tryGoBack} productCount={0} />
        <div className="p-4">
          <Card variant="outlined" className="p-8 text-center">
            <Package size={48} className="mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-bold mb-2">Sin perfil de vendedor</h2>
            <p className="text-gray-500 mb-4">
              Crea tu perfil en el dashboard para agregar productos
            </p>
            <Link href="/dashboard">
              <Button>Ir al dashboard</Button>
            </Link>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background-cream pb-20">
      <ProductsPageHeader onBack={tryGoBack} productCount={products.length} hiddenCount={hiddenCount} isServiceCategory={isServiceCategory} />

      <div className="p-4">
        {showForm ? (
          <ProductForm
            editingId={editingId}
            formName={formName}
            formDescription={formDescription}
            formPrice={formPrice}
            formPhotoUrl={formPhotoUrl}
            formSaving={formSaving}
            formError={formError}
            formSuccess={formSuccess}
            fieldErrors={fieldErrors}
            touched={touched}
            // Migration 102: service offering props. Rendered only when
            // the vendor's category is a service category.
            isServiceCategory={isServiceCategory}
            formDurationMinutes={formDurationMinutes}
            formModality={formModality}
            formPricingUnit={formPricingUnit}
            onChangeName={setFormName}
            onChangeDescription={setFormDescription}
            onChangePrice={setFormPrice}
            onChangePhotoUrl={setFormPhotoUrl}
            onChangeDurationMinutes={setFormDurationMinutes}
            onChangeModality={setFormModality}
            onChangePricingUnit={setFormPricingUnit}
            onBlur={onFieldBlur}
            onClose={tryCloseForm}
            onSubmit={() => (editingId ? handleEdit(editingId) : handleAdd())}
          />
        ) : (
          <Button
            variant="outline"
            className="w-full mb-4"
            onClick={() => setShowForm(true)}
          >
            <Plus size={18} className="mr-2" />
            {isServiceCategory ? 'Agregar servicio' : 'Agregar producto'}
          </Button>
        )}

        {products.length === 0 ? (
          // Sprint 8 D.2: prominent empty state with the primary action
          // right next to the copy. Previous version only had a small
          // "Agregar productos" hint inside a card; the seller had to
          // scroll up to find the actual button. Now the CTA is the
          // primary button below the headline.
          <Card variant="outlined" className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
              <Sparkles size={32} className="text-primary-700" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold mb-2">Publica tu primer producto</h2>
            <p className="text-gray-600 mb-6">
              Los compradores te van a buscar por <strong>foto + nombre + precio</strong>.
              <br />
              Empieza con un producto — agregás más cuando quieras.
            </p>
            <Button
              size="lg"
              onClick={() => setShowForm(true)}
              className="mx-auto"
              data-testid="empty-state-cta"
            >
              <Plus size={20} className="mr-2" aria-hidden="true" />
              Agregar mi primer producto
            </Button>
            <p className="text-xs text-gray-500 mt-4">
              💡 Tómale foto a tu producto estrella y nombrálo con una palabra.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={startEdit}
                onDelete={setDeleteId}
                // Sprint 6 D.1: per-product publish toggle
                onToggleActive={toggleActive}
                isToggling={togglingId === product.id}
              />
            ))}
          </div>
        )}
      </div>

      {toggleError && (
        <div
          role="alert"
          className="fixed bottom-20 left-4 right-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm shadow-lg"
        >
          {toggleError}
        </div>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-3"
        aria-label="Navegación de la cuenta"
      >
        <Link href="/dashboard" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <BarChart3 size={24} />
          <span className="text-xs mt-1">Dashboard</span>
        </Link>
        <Link href="/products" className="flex flex-col items-center text-primary-700">
          <Package size={24} />
          <span className="text-xs mt-1">Productos</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center text-gray-400 hover:text-primary-700 transition-colors">
          <Settings size={24} />
          <span className="text-xs mt-1">Ajustes</span>
        </Link>
      </nav>

      {deleteId && (
        <DeleteProductModal
          error={deleteError}
          onCancel={() => {
            setDeleteId(null)
          }}
          onConfirm={handleDelete}
        />
      )}

      {confirmDiscardOpen && (
        <DiscardChangesModal
          onCancel={() => setConfirmDiscardOpen(false)}
          onConfirm={discardChanges}
        />
      )}
    </div>
  )
}
