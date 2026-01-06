import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Modal from '../../Modal.jsx'
import { SalesItemsTable } from '../shared'
import RemitoSummary from '../RemitoModal/RemitoSummary.jsx'
import DocumentLinkerModal from '../DocumentLinker/DocumentLinkerModal.jsx'
import SalesRemitoModalHeader from './SalesRemitoModalHeader.jsx'
import useSalesRemitoEffects from './useSalesRemitoEffects.jsx'
import useSalesRemitoOperations from './useSalesRemitoOperations.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import { createInitialSalesFormData, normalizeSalesRemitoData, getRemitoTypeSigla } from './salesRemitoModalUtils.js'
import { buildDeliveryNotePatchFromDocument } from '../../../utils/documentLinkingTransforms.js'

const deriveWarehouseRole = (warehouse = {}) => {
  if (warehouse.role) return warehouse.role
  const name = warehouse.name || ''
  if (name.includes('__VCON[')) return 'VCON'
  if (name.includes('__CON[')) return 'CON'
  return 'OWN'
}

const buildWarehouseGrouping = (warehouses = []) => {
  const groups = new Map()
  const actualToDisplay = new Map()

  warehouses.forEach(warehouse => {
    const display = (warehouse.warehouse_name || warehouse.display_name || warehouse.name || '').trim()
    if (!display) return
    const role = deriveWarehouseRole(warehouse)
    if (!groups.has(display)) {
      groups.set(display, {
        key: display,
        display,
        entries: [],
        base: null
      })
    }
    const group = groups.get(display)
    group.entries.push({
      name: warehouse.name,
      warehouse_name: display,
      role,
      is_consignment_variant: Boolean(warehouse.is_consignment_variant)
    })
    if (!group.base || role === 'OWN') {
      group.base = warehouse
    }
    actualToDisplay.set(warehouse.name, display)
  })

  const options = []
  const displayToGroup = new Map()

  groups.forEach((group, key) => {
    const base = group.base || {}
    const option = {
      ...base,
      name: key,
      warehouse_name: key,
      display_name: base.display_name || key,
      groupedEntries: group.entries,
      has_consignment: group.entries.some(entry => entry.role && entry.role !== 'OWN')
    }
    options.push(option)
    displayToGroup.set(key, {
      key,
      warehouse_name: key,
      entries: group.entries
    })
  })

  return {
    options,
    displayToGroup,
    actualToDisplay
  }
}

const formatPuntoDeVenta = (value) => {
  if (value === undefined || value === null) return ''
  const numeric = String(value).replace(/[^0-9]/g, '')
  return numeric.padStart(5, '0').slice(-5)
}

const isSalesRemitoTalonario = (talonario = {}) => {
  const tipo = (talonario.tipo_de_talonario || '').toLowerCase()
  const hasLetterR = Array.isArray(talonario.letras) && talonario.letras.some(
    (entry) => (entry.letra || '').toUpperCase() === 'R'
  )
  const docstatus = talonario.docstatus ?? 0
  const isActive = docstatus === 0 || docstatus === 1
  return isActive && hasLetterR && tipo.includes('remito')
}

const REMITO_INPUT_FIELDS = [
  'posting_date',
  'talonario_name',
  'punto_de_venta',
  'remito_number',
  'remito_letter',
  'customer',
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

const SalesRemitoModal = ({
  isOpen,
  onClose,
  selectedCustomer,
  customerDetails,
  activeCompany,
  fetchWithAuth,
  showNotification,
  selectedRemitoName,
  initialRemitoData,
  prefilledFormData,
  onSaved
}) => {
  const [formData, setFormData] = useState(() => {
    const baseData = createInitialSalesFormData()
    if (selectedCustomer) {
      baseData.customer = selectedCustomer
    }
    return baseData
  })
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [availableTalonarios, setAvailableTalonarios] = useState([])
  const [customerDetailsState, setCustomerDetailsState] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingRemitoNumber, setIsFetchingRemitoNumber] = useState(false)
  const [showDocumentLinker, setShowDocumentLinker] = useState(false)
  const inputsWatchdogRef = useRef(null)
  const isEditing = Boolean(selectedRemitoName)

  useEffect(() => {
    if (isOpen && selectedRemitoName) {
      console.log('🟣 [SalesRemitoModal] Datos recibidos para edición:', {
        remito: selectedRemitoName,
        hasData: !!initialRemitoData,
        items: initialRemitoData?.items?.length || 0
      })
    }
  }, [isOpen, selectedRemitoName, initialRemitoData])

  useSalesRemitoEffects({
    formData,
    setFormData,
    activeCompany,
    fetchWithAuth,
    setAvailableWarehouses,
    setAvailableTalonarios,
    setCustomerDetails: setCustomerDetailsState,
    setIsLoading,
    customerDetails,
    isOpen,
    isEditing,
    initialRemitoData
  })

  const {
    addItem,
    removeItem,
    handleInputChange,
    handleSave
  } = useSalesRemitoOperations({
    formData,
    setFormData,
    activeCompany,
    fetchWithAuth,
    setIsLoading,
    setShowNotification: showNotification,
    onClose,
    isEditing,
    existingRemitoName: selectedRemitoName,
    onSaved
  })

  const remitoTalonarioOptions = useMemo(() => {
    if (!Array.isArray(availableTalonarios)) {
      return []
    }
    return availableTalonarios
      .filter(isSalesRemitoTalonario)
      .map(talonario => {
        const letterEntry = Array.isArray(talonario.letras)
          ? talonario.letras.find(entry => (entry.letra || '').toUpperCase() === 'R')
          : null
        return {
          name: talonario.name,
          label: talonario.descripcion || talonario.name,
          punto_de_venta: formatPuntoDeVenta(talonario.punto_de_venta),
          letter: (letterEntry?.letra || 'R').toUpperCase(),
          tipo: talonario.tipo_de_talonario,
          talonario
        }
      })
  }, [availableTalonarios])

  const selectedTalonario = useMemo(
    () => remitoTalonarioOptions.find(option => option.name === formData.talonario_name),
    [remitoTalonarioOptions, formData.talonario_name]
  )

  const applyTalonarioSelection = useCallback((option) => {
    setFormData(prev => ({
      ...prev,
      talonario_name: option?.name || '',
      remito_letter: option?.letter || prev.remito_letter || 'R',
      punto_de_venta: option?.punto_de_venta || prev.punto_de_venta || ''
    }))
  }, [setFormData])

  const handleTalonarioChange = useCallback((talonarioName) => {
    const option = remitoTalonarioOptions.find(opt => opt.name === talonarioName)
    applyTalonarioSelection(option)
  }, [applyTalonarioSelection, remitoTalonarioOptions])

  const warehouseGrouping = useMemo(
    () => buildWarehouseGrouping(availableWarehouses),
    [availableWarehouses]
  )

  const normalizeWarehouseKey = useCallback((value) => {
    if (!value) return ''
    if (warehouseGrouping.displayToGroup.has(value)) {
      return value
    }
    return warehouseGrouping.actualToDisplay.get(value) || value
  }, [warehouseGrouping.displayToGroup, warehouseGrouping.actualToDisplay])

  const handleSalesItemChange = useCallback((index, field, value) => {
    setFormData(prev => {
      const items = Array.isArray(prev.items) ? [...prev.items] : []
      const current = items[index] ? { ...items[index] } : {}
      current[field] = value
      if (field === 'warehouse') {
        const groupData = warehouseGrouping.displayToGroup.get(value) || null
        current.warehouse_group = groupData
      }
      items[index] = current
      return {
        ...prev,
        items
      }
    })
  }, [setFormData, warehouseGrouping.displayToGroup])

  const handleLinkedDocuments = useCallback(({ mergeStrategy, linkedDocuments }) => {
    if (!linkedDocuments || linkedDocuments.length === 0) {
      showNotification?.('Selecciona al menos un documento para importar', 'warning')
      return
    }

    const patches = linkedDocuments
      .map(entry => buildDeliveryNotePatchFromDocument(entry.document))
      .filter(patch => Array.isArray(patch.items) && patch.items.length > 0)

    if (patches.length === 0) {
      showNotification?.('Los documentos seleccionados no tienen ítems para importar', 'warning')
      return
    }

    const reference = patches[0]
    const importedItems = patches.flatMap(patch => patch.items || [])
    const primaryRelation = linkedDocuments[0]?.relation || ''
    const isReturnImport = primaryRelation === 'delivery_note_return_from_delivery_note'
    const returnAgainstName = linkedDocuments[0]?.document?.name || ''

    setFormData(prev => {
      const preserved = mergeStrategy === 'append'
        ? (prev.items || []).filter(item => item.item_code || item.description)
        : []
      const normalizedItems = importedItems.map(item => ({
        item_code: item.item_code || '',
        description: item.description || '',
        qty: typeof item.qty === 'number' ? item.qty : parseFloat(item.qty) || 1,
        uom: item.uom || 'Unit',
        propiedad: item.propiedad || 'Propio',
        warehouse: item.warehouse || '',
        dn_detail: item.dn_detail || item.delivery_note_item || item.name || ''
      }))

      return {
        ...prev,
        posting_date: reference.posting_date || prev.posting_date,
        customer: reference.customer || prev.customer,
        company: reference.company || prev.company,
        status: isReturnImport ? 'Devolución emitida' : (reference.status || prev.status),
        comprobante_type: reference.comprobante_type || prev.comprobante_type,
        ...(isReturnImport && returnAgainstName ? { return_against: returnAgainstName } : {}),
        items: [...preserved, ...normalizedItems]
      }
    })

    showNotification?.('Items importados desde documentos vinculados', 'success')
  }, [setFormData, showNotification])

  useEffect(() => {
    if (!isOpen) return
    console.log('🟣 [SalesRemitoModal] Actualizando modo edición:', {
      selectedRemitoName,
      editingFlag: isEditing
    })
  }, [selectedRemitoName, isEditing, isOpen])

  useEffect(() => {
    if (prefilledFormData) {
      console.log('🟣 [SalesRemitoModal] Usando formulario normalizado para edición')
      setFormData(prefilledFormData)
      return
    }

    if (selectedRemitoName && initialRemitoData) {
      const normalizedData = normalizeSalesRemitoData(initialRemitoData)
      setFormData(normalizedData)
      console.log('🟣 [SalesRemitoModal] Formulario cargado con remito existente:', {
        posting_date: normalizedData.posting_date,
        customer: normalizedData.customer,
        items: normalizedData.items?.length || 0
      })
    }
  }, [prefilledFormData, selectedRemitoName, initialRemitoData])

  useEffect(() => {
    inputsWatchdogRef.current = null
  }, [isOpen, selectedRemitoName, prefilledFormData])

  useEffect(() => {
    if (!isOpen || isEditing) return
    if (formData.talonario_name) return
    if (remitoTalonarioOptions.length === 1) {
      applyTalonarioSelection(remitoTalonarioOptions[0])
    }
  }, [applyTalonarioSelection, formData.talonario_name, isEditing, isOpen, remitoTalonarioOptions])

  useEffect(() => {
    if (!isOpen || isEditing) return
    if (!formData.talonario_name) return

    let ignore = false

    const fetchNextNumber = async () => {
      try {
        setIsFetchingRemitoNumber(true)
        const response = await fetchWithAuth(
          API_ROUTES.talonarioNextRemitoNumber(formData.talonario_name),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              letra: (formData.remito_letter || 'R').toUpperCase()
            })
          }
        )

        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || 'No se pudo obtener la numeración del talonario')
        }

        if (ignore) return
        const formatted = payload.data?.formatted_number
        const fallback = String(payload.data?.next_number || '').padStart(8, '0')
        setFormData(prev => ({
          ...prev,
          remito_number: formatted || fallback || prev.remito_number || ''
        }))
      } catch (error) {
        if (!ignore && typeof showNotification === 'function') {
          showNotification(error.message || 'No se pudo obtener la numeración del talonario', 'error')
        }
      } finally {
        if (!ignore) {
          setIsFetchingRemitoNumber(false)
        }
      }
    }

    fetchNextNumber()
    return () => {
      ignore = true
    }
  }, [
    fetchWithAuth,
    formData.remito_letter,
    formData.talonario_name,
    isEditing,
    isOpen,
    showNotification,
    setFormData
  ])

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
      console.log('🟣 [SalesRemitoWatchdog] Estado inicial:', {
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
        console.log('🟣 [SalesRemitoWatchdog] Cambios detectados:', changes)
      }
    }

    inputsWatchdogRef.current = nextSnapshot
  }, [formData, isOpen])

  useEffect(() => {
    if (isOpen && !selectedRemitoName) {
      const baseData = createInitialSalesFormData()
      if (selectedCustomer) {
        baseData.customer = selectedCustomer
      }
      setFormData(baseData)
      setCustomerDetailsState(null)
    }
  }, [isOpen, selectedCustomer, selectedRemitoName])

  useEffect(() => {
    if (warehouseGrouping.displayToGroup.size === 0) return
    setFormData(prev => {
      if (!Array.isArray(prev.items) || prev.items.length === 0) {
        return prev
      }
      let changed = false
      const nextItems = prev.items.map(item => {
        if (!item) return item
        const normalizedKey = normalizeWarehouseKey(item.warehouse)
        if (!normalizedKey) return item
        const groupData = warehouseGrouping.displayToGroup.get(normalizedKey)
        if (item.warehouse !== normalizedKey || (!item.warehouse_group && groupData)) {
          changed = true
          return {
            ...item,
            warehouse: normalizedKey,
            warehouse_group: groupData || item.warehouse_group
          }
        }
        return item
      })
      return changed ? { ...prev, items: nextItems } : prev
    })
  }, [warehouseGrouping.displayToGroup, normalizeWarehouseKey, setFormData])

  const remitoCodePreview = useMemo(() => {
    const typeSigla = getRemitoTypeSigla(formData.comprobante_type || 'Remito')
    const letter = (formData.remito_letter || 'R').toUpperCase()
    const punto = formatPuntoDeVenta(formData.punto_de_venta || '')
    const number = String(formData.remito_number || '')
      .replace(/[^0-9]/g, '')
      .padStart(8, '0')
      .slice(-8)
    return `REM-${typeSigla}-${letter}-${punto || '00000'}-${number || '00000000'}`
  }, [formData.comprobante_type, formData.punto_de_venta, formData.remito_letter, formData.remito_number])

  if (!isOpen) return null

  const subtitle = (customerDetailsState?.customer_name || selectedCustomer)
    ? `${customerDetailsState?.customer_name || selectedCustomer}${customerDetailsState?.tax_id ? ` - CUIT: ${customerDetailsState.tax_id}` : ''}`
    : ''

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEditing ? 'Editar Remito de Venta' : 'Crear Remito de Venta'}
        subtitle={subtitle}
        size="default"
      >
        <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
          <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
            <SalesRemitoModalHeader
              formData={formData}
              handleInputChange={handleInputChange}
              remitoTalonarioOptions={remitoTalonarioOptions}
              selectedTalonario={selectedTalonario}
              onTalonarioChange={handleTalonarioChange}
              remitoCodePreview={remitoCodePreview}
              isFetchingRemitoNumber={isFetchingRemitoNumber}
              propCustomerDetails={customerDetails}
              isEditing={isEditing}
            />

            <SalesItemsTable
              formData={formData}
              handleItemChange={handleSalesItemChange}
              addItem={addItem}
              removeItem={removeItem}
              activeCompany={activeCompany}
              fetchWithAuth={fetchWithAuth}
              availableWarehouses={warehouseGrouping.options}
              showNotification={showNotification}
              showPricing={false}
              showWarehouse={true}
              showStockWarnings={true}
              requireWarehouse={true}
            />
          </div>

          <aside className="w-full md:w-80 flex-shrink-0">
            <RemitoSummary
              formData={formData}
              isLoading={isLoading}
              onSave={handleSave}
              onClose={onClose}
              isEditing={isEditing}
              onLinkDocuments={() => setShowDocumentLinker(true)}
              linkDocumentsDisabled={!formData.customer}
            />
          </aside>
        </div>
      </Modal>

      <DocumentLinkerModal
        isOpen={showDocumentLinker}
        onClose={() => setShowDocumentLinker(false)}
        context={String(formData.status || '').toLowerCase().includes('devoluci') ? 'sales_remito_return' : 'sales_remito'}
        customerName={formData.customer || selectedCustomer || ''}
        company={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onLinked={handleLinkedDocuments}
      />
    </>
  )

}

export default SalesRemitoModal

