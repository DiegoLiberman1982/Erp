import React, { useState, useEffect, useContext, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { AuthContext } from '../../../AuthProvider.jsx'
import { NotificationContext } from '../../../contexts/NotificationContext.jsx'
import { useConfirm } from '../../../hooks/useConfirm.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import Modal from '../../Modal.jsx'
import RemitoModalHeader from './RemitoModalHeader.jsx'
import RemitoItemsTable from './RemitoItemsTable.jsx'
import RemitoSummary from './RemitoSummary.jsx'
import useRemitoEffects from './useRemitoEffects.jsx'
import useRemitoOperations from './useRemitoOperations.jsx'
import { createInitialFormData, normalizeRemitoData } from './remitoModalUtils.js'
import DocumentLinkerModal from '../DocumentLinker/DocumentLinkerModal.jsx'
import QuickItemCreateModal from '../QuickItemCreateModal/QuickItemCreateModal.jsx'

// Componente auxiliar para campos de formulario
const FormField = ({ label, children }) => (
  <div className="flex flex-col">
    <label className="text-xs font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
)

const REMITO_INPUT_FIELDS = [
  'posting_date',
  'punto_de_venta',
  'remito_number',
  'supplier',
  'status',
  'comprobante_type',
  'title'
]

const buildItemsSignature = (items = []) => {
  return items
    .map((item, index) => {
      const code = item.item_code || ''
      const qty = item.qty ?? ''
      const warehouse = item.warehouse || ''
      const propiedad = item.propiedad || ''
      return `${index}:${code}:${qty}:${warehouse}:${propiedad}`
    })
    .join('|')
}

const RemitoModal = ({ 
  isOpen, 
  onClose, 
  selectedSupplier, 
  supplierDetails, 
  activeCompany, 
  fetchWithAuth, 
  showNotification,
  // Nuevas props para edición
  selectedRemitoName,
  initialRemitoData,
  prefilledFormData,
  onSaved
}) => {
  const [formData, setFormData] = useState(() => {
    const baseData = createInitialFormData()
    if (selectedSupplier) {
      baseData.supplier = selectedSupplier
    }
    return baseData
  })
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [availableTalonarios, setAvailableTalonarios] = useState([])
  const [selectedPuntoVenta, setSelectedPuntoVenta] = useState('')
  const [supplierDetailsState, setSupplierDetailsState] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDocumentLinkerOpen, setIsDocumentLinkerOpen] = useState(false)
  const [quickItemContext, setQuickItemContext] = useState(null)
  const inputsWatchdogRef = useRef(null)
  const isEditing = Boolean(selectedRemitoName)

  useEffect(() => {
    if (isOpen && selectedRemitoName) {
      console.log('🧾 [RemitoModal] Recibí datos para editar:', {
        remito: selectedRemitoName,
        hasData: !!initialRemitoData,
        items: initialRemitoData?.items?.length || 0
      })
    }
  }, [isOpen, selectedRemitoName, initialRemitoData])

  // Custom hooks
  useRemitoEffects({
    formData,
    setFormData,
    activeCompany,
    fetchWithAuth,
    setAvailableWarehouses,
    setAvailableTalonarios,
    setSupplierDetails: setSupplierDetailsState,
    setIsLoading,
    supplierDetails: supplierDetails,
    isOpen,
    // Nuevos parámetros para edición
    isEditing,
    initialRemitoData
  })

  const {
    addItem,
    removeItem,
    handleItemChange,
    handleInputChange,
    handleSave,
    handleOpenItemSettings
  } = useRemitoOperations({
    formData,
    setFormData,
    activeCompany,
    fetchWithAuth,
    setIsLoading,
    setShowNotification: showNotification,
    onClose,
    setSupplierDetails: setSupplierDetailsState,
    // Nuevos parámetros para edición
    isEditing,
    existingRemitoName: selectedRemitoName,
    onSaved
  })

  // Loggear cambios en el flag de edición para depurar
  useEffect(() => {
    if (!isOpen) return
    console.log('🔁 [RemitoModal] Actualizando modo edición:', {
      selectedRemitoName,
      editingFlag: isEditing
    })
  }, [selectedRemitoName, isEditing, isOpen])

  // Cargar datos iniciales cuando se abre el modal en modo edición
  useEffect(() => {
    if (prefilledFormData) {
      console.log('🧱 [RemitoModal] Usando formulario pre-computado para edición')
      setFormData(prefilledFormData)
      return
    }

    if (selectedRemitoName && initialRemitoData) {
      const normalizedData = normalizeRemitoData(initialRemitoData)
      console.log('✏️ [RemitoModal] Normalizando datos de remito para edición:', {
        remito: selectedRemitoName,
        normalizedItems: normalizedData?.items?.length || 0
      })
      setFormData(normalizedData)
      console.log('📑 [RemitoModal] Formulario cargado con datos del remito:', {
        posting_date: normalizedData.posting_date,
        supplier: normalizedData.supplier,
        punto_de_venta: normalizedData.punto_de_venta,
        remito_number: normalizedData.remito_number,
        itemsPreview: normalizedData.items?.map((item, idx) => ({
          idx,
          item_code: item.item_code,
          qty: item.qty,
          warehouse: item.warehouse
        }))
      })
    }
  }, [prefilledFormData, selectedRemitoName, initialRemitoData])

  // Reiniciar el snapshot del vigilante cuando cambie el documento o se cierre el modal
  useEffect(() => {
    inputsWatchdogRef.current = null
  }, [isOpen, selectedRemitoName, prefilledFormData])

  // Vigilante de inputs: loguea todo cambio proveniente de cualquier fuente
  useEffect(() => {
    if (!isOpen) return

    const prevSnapshot = inputsWatchdogRef.current
    const nextSnapshot = {
      fields: {},
      itemsSignature: buildItemsSignature(formData.items || []),
      itemsLength: formData.items?.length || 0
    }

    REMITO_INPUT_FIELDS.forEach(field => {
      nextSnapshot.fields[field] = formData[field] ?? ''
    })

    if (!prevSnapshot) {
      console.log('👀 [RemitoInputsWatchdog] Estado inicial observado:', {
        ...nextSnapshot.fields,
        itemsLength: nextSnapshot.itemsLength
      })
    } else {
      const changes = []
      REMITO_INPUT_FIELDS.forEach(field => {
        const prevValue = prevSnapshot.fields[field]
        const nextValue = nextSnapshot.fields[field]
        if (prevValue !== nextValue) {
          changes.push({
            field,
            from: prevValue || '',
            to: nextValue || ''
          })
        }
      })

      if (prevSnapshot.itemsSignature !== nextSnapshot.itemsSignature) {
        changes.push({
          field: 'items',
          from: `${prevSnapshot.itemsLength} items`,
          to: `${nextSnapshot.itemsLength} items`
        })
      }

      if (changes.length > 0) {
        console.log('👀 [RemitoInputsWatchdog] Cambios detectados:', changes)
      }
    }

    inputsWatchdogRef.current = nextSnapshot
  }, [formData, isOpen])

  // Reset form when modal opens (solo en modo creación)
  useEffect(() => {
    if (isOpen && !selectedRemitoName) {
      const baseData = createInitialFormData()
      if (selectedSupplier) {
        baseData.supplier = selectedSupplier
      }
      setFormData(baseData)
      setSupplierDetailsState(null)
    }
  }, [isOpen, selectedSupplier, selectedRemitoName])

  const handleLinkedDocuments = useCallback(({ mergeStrategy, linkedDocuments }) => {
    if (!linkedDocuments || linkedDocuments.length === 0) {
      showNotification('Seleccioná al menos un documento para relacionar', 'warning')
      return
    }

    const normalizedCollections = linkedDocuments
      .map(entry => normalizeRemitoData(entry.document))
      .filter(entry => entry && Array.isArray(entry.items))

    const importedItems = normalizedCollections.flatMap(entry => entry.items || [])

    if (importedItems.length === 0) {
      showNotification('Los documentos seleccionados no tienen ítems pendientes', 'warning')
      return
    }

      const reference = normalizedCollections[0] || {}
      const primaryRelation = linkedDocuments[0]?.relation || ''
      const shouldLinkPurchaseOrder = primaryRelation.includes('purchase_order')
      const isReturnImport = primaryRelation === 'purchase_receipt_return_from_purchase_receipt'
      const returnAgainstName = linkedDocuments[0]?.document?.name || reference.name || ''

      setFormData(prev => {
        const preserved = mergeStrategy === 'append'
        ? (prev.items || []).filter(item => item.item_code || item.description)
        : []

        return {
          ...prev,
          posting_date: reference.posting_date || prev.posting_date,
          supplier: reference.supplier || prev.supplier,
          ...(isReturnImport && returnAgainstName ? { return_against: returnAgainstName, status: 'Devolución emitida' } : {}),
          items: [...preserved, ...importedItems],
          linked_purchase_order: shouldLinkPurchaseOrder
            ? (reference.name || prev.linked_purchase_order)
            : prev.linked_purchase_order
        }
      })

    showNotification('Ítems importados desde documentos vinculados', 'success')
  }, [setFormData, showNotification])

  const handleRequestQuickCreate = useCallback((item, index) => {
    const supplierValue = formData.supplier || selectedSupplier
    if (!supplierValue) {
      showNotification('Seleccioná un proveedor antes de crear un item nuevo', 'warning')
      return
    }
    setQuickItemContext({ index, item })
  }, [formData.supplier, selectedSupplier, showNotification])

  const handleQuickItemCreated = useCallback((result) => {
    if (!quickItemContext) return
    const { index } = quickItemContext
    if (typeof index !== 'number') return

    const createdItem = result?.item || {}
    const existingItem = formData.items?.[index] || {}
    const updates = {
      item_code: createdItem.item_code || quickItemContext.item?.item_code || existingItem.item_code || '',
      item_name: createdItem.item_name || quickItemContext.item?.item_name || existingItem.item_name || '',
      description: createdItem.description || createdItem.item_name || quickItemContext.item?.description || existingItem.description || '',
      uom: createdItem.stock_uom || existingItem.uom || 'Unidad'
    }

    Object.entries(updates).forEach(([field, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        handleItemChange(index, field, value.toString())
      }
    })

    if (createdItem.item_defaults && Array.isArray(createdItem.item_defaults)) {
      handleItemChange(index, 'item_defaults', createdItem.item_defaults)
      const defaultForCompany = createdItem.item_defaults.find(def => def.company === activeCompany)
      if (defaultForCompany?.default_warehouse) {
        handleItemChange(index, 'warehouse', defaultForCompany.default_warehouse)
      }
    }

    setQuickItemContext(null)
  }, [quickItemContext, handleItemChange, formData.items, activeCompany])

  if (!isOpen) return null

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEditing ? 'Editar Remito' : 'Crear Remito'}
        subtitle={
          supplierDetails?.supplier_name || selectedSupplier
            ? `${supplierDetails?.supplier_name || selectedSupplier}${supplierDetails?.tax_id ? ` · CUIT: ${supplierDetails.tax_id}` : ''}`
            : ''
        }
        size="default"
      >
        <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
          <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
            {/* Header Section */}
            <RemitoModalHeader
              formData={formData}
              handleInputChange={handleInputChange}
              supplierDetails={supplierDetailsState}
              FormField={FormField}
              availableTalonarios={availableTalonarios}
              selectedPuntoVenta={selectedPuntoVenta}
              setSelectedPuntoVenta={setSelectedPuntoVenta}
              fetchWithAuth={fetchWithAuth}
              propSupplierDetails={supplierDetails}
              isEditing={isEditing}
            />

            {/* Items Table */}
            <RemitoItemsTable
              formData={formData}
              handleItemChange={handleItemChange}
              addItem={addItem}
              removeItem={removeItem}
              activeCompany={activeCompany}
              fetchWithAuth={fetchWithAuth}
              availableWarehouses={availableWarehouses}
              onRequestQuickCreate={handleRequestQuickCreate}
            />
          </div>

          {/* Summary & Actions */}
          <aside className="w-full md:w-80 flex-shrink-0">
            <RemitoSummary
              formData={formData}
              isLoading={isLoading}
              onSave={handleSave}
              onClose={onClose}
              isEditing={isEditing}
              onLinkDocuments={() => setIsDocumentLinkerOpen(true)}
            />
          </aside>
        </div>
      </Modal>

      <DocumentLinkerModal
        isOpen={isDocumentLinkerOpen}
        onClose={() => setIsDocumentLinkerOpen(false)}
        context={String(formData.status || '').toLowerCase().includes('devoluci') ? 'purchase_receipt_return' : 'purchase_receipt'}
        supplierName={formData.supplier || selectedSupplier || ''}
        company={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onLinked={handleLinkedDocuments}
      />

      <QuickItemCreateModal
        isOpen={Boolean(quickItemContext)}
        onClose={() => setQuickItemContext(null)}
        fetchWithAuth={fetchWithAuth}
        activeCompany={activeCompany}
        supplier={formData.supplier || selectedSupplier || ''}
        initialItemCode={quickItemContext?.item?.item_code || ''}
        initialDescription={quickItemContext?.item?.description || ''}
        initialRate=""
        suggestedPriceList={supplierDetailsState?.custom_default_price_list || supplierDetails?.custom_default_price_list || ''}
        defaultCurrency={supplierDetailsState?.default_currency || supplierDetails?.default_currency}
        initialUom={quickItemContext?.item?.uom || quickItemContext?.item?.stock_uom || 'Unidad'}
        showNotification={showNotification}
        onCreated={handleQuickItemCreated}
        contextLabel="Remito"
      />
    </>
  )
}

export default RemitoModal
