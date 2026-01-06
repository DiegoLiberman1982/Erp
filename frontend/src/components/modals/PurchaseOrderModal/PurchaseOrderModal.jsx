import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Lightbulb, RefreshCw, FileText, AlertTriangle } from 'lucide-react'
import Modal from '../../Modal.jsx'
import { PurchaseItemsTable } from '../shared'
import { createInitialPurchaseOrderData, normalizePurchaseOrderData } from './purchaseOrderModalUtils'
import usePurchaseOrderOperations from './usePurchaseOrderOperations'
import API_ROUTES from '../../../apiRoutes'
import { searchItems } from '../PurchaseInvoiceModal/purchaseInvoiceModalApi'
import QuickItemCreateModal from '../QuickItemCreateModal/QuickItemCreateModal.jsx'
import useCurrencies from '../../../hooks/useCurrencies'
import useTaxTemplates from '../../../hooks/useTaxTemplates'
import { fetchItemPriceInPriceList, fetchPaymentTerms } from '../PurchaseInvoiceModal/purchaseInvoiceModalApi.js'
import { getIvaRatesFromTemplates } from '../../../utils/taxTemplates'

const PurchaseOrderModal = ({
  isOpen,
  onClose,
  supplierName,
  supplierDetails,
  activeCompany,
  fetchWithAuth,
  showNotification,
  onSaved,
  // Nuevas props para edición
  editingData,
  initialData,
  prefilledFormData
}) => {
  const [formData, setFormData] = useState(() =>
    createInitialPurchaseOrderData({ supplier: supplierName, company: activeCompany })
  )
  const [availableUOMs, setAvailableUOMs] = useState([])
  const [availablePriceLists, setAvailablePriceLists] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsNote, setSuggestionsNote] = useState('')
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isLoadingPriceLists, setIsLoadingPriceLists] = useState(false)
  const [quickItemContext, setQuickItemContext] = useState(null)
  const [showNotes, setShowNotes] = useState(false)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const isEditing = Boolean(editingData || initialData)
  const resolvedPriceList = formData.price_list || supplierDetails?.custom_default_price_list || availablePriceLists[0]?.name || ''
  const currencyFormatter = useMemo(() => {
    const resolvedCurrency = (formData.currency || '').toString().trim()
    return new Intl.NumberFormat('es-AR', {
      ...(resolvedCurrency ? { style: 'currency', currency: resolvedCurrency } : {}),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }, [formData.currency])
  const totals = useMemo(() => {
    const itemsArr = formData.items || []
    let subtotal = 0
    let totalDiscount = 0
    let iva = 0

    itemsArr.forEach(item => {
      const qty = parseFloat(item.qty) || 0
      const rate = parseFloat(item.rate) || 0
      const netRate = parseFloat(item.net_rate_value) || rate
      const ivaPercent = parseFloat(item.iva_percent ?? 0) || 0
      const lineSubtotal = qty * rate
      const lineDiscount = parseFloat(item.discount_amount) || (parseFloat(item.discount_percent) ? (lineSubtotal * (parseFloat(item.discount_percent) / 100)) : 0)
      const taxableNet = Math.max(0, qty * netRate)
      const lineIva = taxableNet * (ivaPercent / 100)

      subtotal += lineSubtotal
      totalDiscount += lineDiscount
      iva += lineIva
    })

    const total = Math.max(0, subtotal - totalDiscount) + iva

    return { subtotal, discount: totalDiscount, iva, total }
  }, [formData.items])
  const formatCurrencyValue = useCallback(
    (value) => {
      const numericValue = typeof value === 'number' ? value : parseFloat(value)
      return currencyFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)
    },
    [currencyFormatter]
  )

  const { addItem, removeItem, handleItemChange, handleInputChange, handleSave, handleCancel } = usePurchaseOrderOperations({
    formData,
    setFormData,
    fetchWithAuth,
    showNotification,
    supplierDetails,
    activeCompany,
    onClose,
    onSaved,
    editingData // Pasar la data de edición
  })

  const { currencies, loading: currenciesLoading } = useCurrencies()
  const { purchase: taxPurchase, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)
  const [availableIVARates, setAvailableIVARates] = useState([])
  const [paymentTerms, setPaymentTerms] = useState([])
  const defaultIvaRate = useMemo(() => {
    if (!availableIVARates.length) return ''
    const first = availableIVARates[0]
    return first != null ? first.toString() : ''
  }, [availableIVARates])

  useEffect(() => {
    if (!isOpen) {
      setFormData(prev => ({
        ...createInitialPurchaseOrderData({ supplier: supplierName, company: activeCompany }),
        supplier: supplierName,
        company: activeCompany,
        price_list: supplierDetails?.custom_default_price_list || '',
        currency: supplierDetails?.default_currency || prev.currency
      }))
    }
  }, [isOpen, supplierName, activeCompany, supplierDetails])

  useEffect(() => {
    if (!isOpen) return

    const loadUoms = async () => {
      try {
        const response = await fetchWithAuth('/api/inventory/uoms')
        if (!response.ok) return

        const payload = await response.json()
        if (payload.success) {
          setAvailableUOMs(payload.data || [])
        }
      } catch (error) {
        console.error('Error loading UOMs:', error)
        setAvailableUOMs([])
      }
    }

    loadUoms()
  }, [isOpen, fetchWithAuth])

  const fetchSuggestions = useCallback(async () => {
    if (!supplierName || !activeCompany) {
      setSuggestions([])
      setSuggestionsNote('')
      return
    }

    setIsLoadingSuggestions(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.purchaseOrderSuggestions(supplierName, activeCompany))
      const payload = await response.json().catch(() => ({}))

      if (!response.ok || payload.success === false) {
        showNotification(payload.message || 'No se pudieron cargar sugerencias', 'warning')
        setSuggestions([])
        setSuggestionsNote(payload.message || '')
        return
      }

      setSuggestions(payload.data?.items || [])
      setSuggestionsNote(payload.data?.note || '')
    } catch (error) {
      console.error('Error fetching suggestions:', error)
      setSuggestions([])
      setSuggestionsNote('No se pudieron cargar sugerencias')
    } finally {
      setIsLoadingSuggestions(false)
    }
  }, [activeCompany, fetchWithAuth, showNotification, supplierName])

  useEffect(() => {
    if (isOpen) {
      fetchSuggestions()
    }
  }, [fetchSuggestions, isOpen])

  useEffect(() => {
    if (!isOpen) return
    // Load payment terms templates similar to PurchaseInvoiceModal
    const loadPaymentTerms = async () => {
      try {
        await fetchPaymentTerms(fetchWithAuth, API_ROUTES, setPaymentTerms)
      } catch (e) {
        console.error('Error loading payment terms for PO:', e)
      }
    }
    loadPaymentTerms()
  }, [isOpen, fetchWithAuth])

  // Forzar actualización de plantillas de impuestos al abrir el modal
  useEffect(() => {
    if (!isOpen) return
    refreshTaxTemplates()?.catch(() => {})
  }, [isOpen, refreshTaxTemplates])

  useEffect(() => {
    if (!isOpen) return
    const rates = getIvaRatesFromTemplates(Array.isArray(taxPurchase) ? taxPurchase : [])
    setAvailableIVARates(rates)
  }, [isOpen, taxPurchase])

  useEffect(() => {
    if (!isOpen) return
    if (Array.isArray(paymentTerms) && paymentTerms.length > 0) {
      // If no sales_condition_type set, try to pick Contado (0 days) or first
      if (!formData.sales_condition_type) {
        const contado = paymentTerms.find(pt => (pt.terms && pt.terms[0] && (pt.terms[0].credit_days || 0) === 0) || (pt.template_name && pt.template_name.toLowerCase().includes('contado')))
        const defaultTerm = contado || paymentTerms[0]
        if (defaultTerm) handleInputChange('sales_condition_type', defaultTerm.name)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentTerms, isOpen])

  const fetchPriceLists = useCallback(async () => {
    if (!isOpen) return
    setIsLoadingPriceLists(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) {
        setAvailablePriceLists(payload.data || [])
      } else {
        showNotification(
          payload.message || 'No se pudieron cargar las listas de precios',
          'warning'
        )
        setAvailablePriceLists([])
      }
    } catch (error) {
      console.error('Error loading purchase price lists:', error)
      setAvailablePriceLists([])
      showNotification('Error al cargar listas de precios', 'error')
    } finally {
      setIsLoadingPriceLists(false)
    }
  }, [fetchWithAuth, isOpen, showNotification])

  useEffect(() => {
    if (isOpen) {
      fetchPriceLists()
    }
  }, [fetchPriceLists, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const supplierDefault = supplierDetails?.custom_default_price_list
    if (supplierDefault && !formData.price_list) {
      handleInputChange('price_list', supplierDefault)
      return
    }
    if (!formData.price_list && availablePriceLists.length > 0) {
      handleInputChange('price_list', availablePriceLists[0].name)
    }
  }, [availablePriceLists, formData.price_list, handleInputChange, isOpen, supplierDetails])

  // Cargar datos iniciales cuando se abre el modal en modo edición
  useEffect(() => {
    if (prefilledFormData) {
      console.log('🧱 [PurchaseOrderModal] Usando formulario pre-computado para edición')
      setFormData(prefilledFormData)
      return
    }

    if ((editingData || initialData) && isOpen) {
      const dataToNormalize = editingData || initialData
      const normalizedData = normalizePurchaseOrderData(dataToNormalize)
      console.log('✏️ [PurchaseOrderModal] Normalizando datos de orden de compra para edición:', {
        order: dataToNormalize.name,
        normalizedItems: normalizedData?.items?.length || 0
      })
      setFormData(normalizedData)
      console.log('📑 [PurchaseOrderModal] Formulario cargado con datos de la orden:', {
        transaction_date: normalizedData.transaction_date,
        supplier: normalizedData.supplier,
        status: normalizedData.status,
        itemsPreview: normalizedData.items?.map((item, idx) => ({
          idx,
          item_code: item.item_code,
          qty: item.qty,
          rate: item.rate
        }))
      })
    }
  }, [prefilledFormData, editingData, initialData, isOpen])

  const applySuggestion = (item) => {
    if (!item?.item_code) return

    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          item_code: item.item_code,
          description: item.description || '',
          qty: item.recommended_qty || 1,
          uom: item.uom || 'Unit',
          rate: item.rate || '',
          schedule_date: formData.schedule_date,
          iva_percent: item.iva_percent || defaultIvaRate || ''
        }
      ]
    }))
  }

  const handleSearchItems = async (query) => {
    return new Promise((resolve) => {
      searchItems(query, activeCompany, fetchWithAuth, (results) => {
        resolve(results || [])
      }, () => {})
    })
  }

  const handleItemSelected = useCallback(async (index, item) => {
    if (!resolvedPriceList) {
      return
    }
    const itemCode = item?.display_code || item?.item_code
    if (!itemCode) {
      return
    }
    try {
      const priceData = await fetchItemPriceInPriceList(fetchWithAuth, resolvedPriceList, itemCode)
      if (priceData && priceData.price_list_rate !== undefined && priceData.price_list_rate !== null) {
        const formattedRate = Number(priceData.price_list_rate).toFixed(2)
        handleItemChange(index, 'rate', formattedRate)
      }
      // Set default IVA if not set
      const currentItem = formData.items?.[index]
      if (!currentItem?.iva_percent && defaultIvaRate) {
        handleItemChange(index, 'iva_percent', defaultIvaRate)
      }
    } catch (error) {
      console.error('Error fetching purchase price for item:', error)
    }
  }, [fetchWithAuth, handleItemChange, resolvedPriceList, formData.items])

  const handleRequestQuickCreate = useCallback((item, index) => {
    const supplierValue = formData.supplier || supplierName
    if (!supplierValue) {
      showNotification('Seleccioná un proveedor antes de crear un item nuevo', 'warning')
      return
    }
    setQuickItemContext({ index, item })
  }, [formData.supplier, supplierName, showNotification])

  const handleQuickItemCreated = useCallback((result) => {
    if (!quickItemContext) return
    const { index } = quickItemContext
    if (typeof index !== 'number') return

    const createdItem = result?.item || {}
    const purchasePrice = result?.purchase_price
    const resolvedRate = purchasePrice?.price_list_rate ?? quickItemContext.item?.rate
    const existingItem = formData.items?.[index] || {}

    const updates = {
      item_code: createdItem.item_code || quickItemContext.item?.item_code || existingItem.item_code || '',
      item_name: createdItem.item_name || quickItemContext.item?.item_name || existingItem.item_name || '',
      description: createdItem.description || createdItem.item_name || quickItemContext.item?.description || existingItem.description || '',
      uom: createdItem.stock_uom || existingItem.uom || 'Unidad'
    }

    if (resolvedRate !== undefined && resolvedRate !== null && !Number.isNaN(Number(resolvedRate))) {
      const formattedRate = Number(resolvedRate).toFixed(2)
      updates.rate = formattedRate
      updates.valuation_rate = formattedRate
    }

    Object.entries(updates).forEach(([field, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        handleItemChange(index, field, value.toString())
      }
    })

    if (createdItem.item_defaults && Array.isArray(createdItem.item_defaults)) {
      handleItemChange(index, 'item_defaults', createdItem.item_defaults)
    }

    if (!existingItem.iva_percent) {
      if (defaultIvaRate) {
        handleItemChange(index, 'iva_percent', defaultIvaRate)
      }
    }

    setQuickItemContext(null)
  }, [quickItemContext, handleItemChange, formData.items])

  const content = (
    <>
      <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
        <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Estado</p>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="po-input"
                >
                  <option value="En espera">En espera</option>
                  <option value="Para recibir y pagar">Para recibir y pagar</option>
                  <option value="Por facturar">Por facturar</option>
                  <option value="Recibir">Recibir</option>
                  <option value="Enviado">Enviado</option>
                  {isEditing && <option value="Cancelado">Cancelado</option>}
                </select>
              </div>

              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Descripción</p>
                <input
                  type="text"
                  value={formData.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className="po-input"
                  placeholder="Descripción de la orden"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Condición de venta</p>
                <select
                  value={formData.sales_condition_type || ''}
                  onChange={(e) => handleInputChange('sales_condition_type', e.target.value)}
                  className="po-input"
                >
                  <option value="">Seleccionar condición</option>
                  {paymentTerms && paymentTerms.map(term => (
                    <option key={term.name} value={term.name}>
                      {term.template_name || term.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Fecha</p>
                <input
                  type="date"
                  value={formData.transaction_date}
                  onChange={(e) => handleInputChange('transaction_date', e.target.value)}
                  className="po-input"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Entrega estimada</p>
                <input
                  type="date"
                  value={formData.schedule_date}
                  onChange={(e) => handleInputChange('schedule_date', e.target.value)}
                  className="po-input"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Moneda</p>
                <select
                  value={formData.currency || ''}
                  onChange={(e) => handleInputChange('currency', e.target.value)}
                  className="po-input"
                >
                  <option value="">{currenciesLoading ? 'Cargando monedas...' : 'Seleccionar moneda'}</option>
                  {currencies && currencies.map((c) => (
                    <option key={c.name || c.code} value={c.name || c.code}>
                      {(c.currency_name || c.name || c.code) + (c.symbol ? ` · ${c.symbol}` : '')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Lista de precios</p>
                <select
                  value={formData.price_list || ''}
                  onChange={(e) => handleInputChange('price_list', e.target.value)}
                  className="po-input"
                >
                  <option value="">
                    {isLoadingPriceLists ? 'Cargando listas...' : 'Seleccionar lista de precios'}
                  </option>
                  {availablePriceLists.map((list) => (
                    <option key={list.name} value={list.name}>
                      {(list.price_list_name || list.name) + (list.currency ? ` · ${list.currency}` : '')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Notas</p>
                  <button
                    type="button"
                    onClick={() => setShowNotes(s => !s)}
                    className="text-gray-600 hover:text-gray-900"
                    title={showNotes ? 'Ocultar notas' : 'Mostrar notas'}
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                </div>
                {showNotes && (
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    className="po-input min-h-[72px]"
                    placeholder="Indicaciones especiales para el proveedor"
                  />
                )}
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                Artículos sugeridos
              </div>
              <button
                onClick={fetchSuggestions}
                className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
            {suggestionsNote && <p className="text-xs text-gray-500 mb-3">{suggestionsNote}</p>}
            {isLoadingSuggestions ? (
              <div className="text-sm text-gray-500">Calculando sugerencias...</div>
            ) : suggestions.length === 0 ? (
              <div className="text-sm text-gray-500">Aún no hay sugerencias automáticas.</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {suggestions.map((item, idx) => (
                  <div
                    key={`${item.item_code}-${idx}`}
                    className="rounded-xl border border-gray-200 p-3 bg-gray-50 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.item_code}</p>
                      <p className="text-xs text-gray-500">{item.reason}</p>
                    </div>
                    <button
                      onClick={() => applySuggestion(item)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      Agregar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-4">
            <PurchaseItemsTable
              items={formData.items}
              onItemChange={handleItemChange}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              searchItems={handleSearchItems}
              fetchItemPrice={(itemCode) => fetchItemPriceInPriceList(fetchWithAuth, resolvedPriceList, itemCode)}
              availableUOMs={availableUOMs}
              availableWarehouses={[]}
              title="Items de compra"
              showPricing={true}
              showWarehouse={false}
              showDiscount={true}
              requireWarehouse={false}
              availableIVARates={availableIVARates}
              priceListName={resolvedPriceList}
              fetchWithAuth={fetchWithAuth}
              showNotification={showNotification}
              onRequestQuickCreate={(item, idx) => handleRequestQuickCreate(item, idx)}
              onItemSelected={handleItemSelected}
              formatCurrencyValue={formatCurrencyValue}
            />
          </section>
        </div>

        <aside className="w-full md:w-80 flex-shrink-0">
              <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col h-full">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Resumen</p>
                  <p className="text-xs text-gray-500">Valores estimados (sin percepciones)</p>
                </div>

                <div className="space-y-3 text-sm text-gray-700 flex-grow">
                  <div className="flex items-center justify-between">
                    <span>Ítems</span>
                    <span className="font-semibold">{formData.items?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span className="font-semibold">{formatCurrencyValue(totals.subtotal)}</span>
                  </div>
                  {totals.discount > 0 && (
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <span>Descuento</span>
                      <span className="font-semibold">-{formatCurrencyValue(totals.discount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>IVA estimado</span>
                    <span className="font-semibold">{formatCurrencyValue(totals.iva)}</span>
                  </div>
                  <div className="flex items-center justify-between text-base font-bold text-gray-900">
                    <span>Total</span>
                    <span>{formatCurrencyValue(totals.total)}</span>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <button
                    onClick={handleSave}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 shadow-lg hover:shadow-xl w-full"
                  >
                    <ClipboardList className="w-4 h-4" />
                    Guardar Orden
                  </button>
                  {isEditing && (
                    <button
                      onClick={() => setShowDeleteConfirmation(true)}
                      className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 w-full"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
        </aside>
      </div>

    </>
  )

  const deleteConfirmationModal = (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal-content">
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-section">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            <h3 className="confirm-modal-title">Confirmar Eliminación</h3>
          </div>
          <button
            className="confirm-modal-close-btn"
            onClick={() => setShowDeleteConfirmation(false)}
          >
            ×
          </button>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-modal-message">
            ¿Estás seguro de que quieres anular esta orden de compra? Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="confirm-modal-footer">
          <button
            className="confirm-modal-btn-cancel"
            onClick={() => setShowDeleteConfirmation(false)}
          >
            Cancelar
          </button>
          <button
            className="confirm-modal-btn-confirm error"
            onClick={async () => {
              setShowDeleteConfirmation(false)
              await handleCancel()
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )

  const modalElement = (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Editar Orden de Compra" : "Orden de Compra"}
      subtitle={
        supplierName
          ? `${supplierName}${supplierDetails?.tax_id ? ` · CUIT: ${supplierDetails.tax_id}` : ''}`
          : `${activeCompany || '10X SOCIEDAD DE RESPONSABILIDAD LIMITADA'}${supplierDetails?.tax_id ? ` · CUIT: ${supplierDetails.tax_id}` : ''}`
      }
      size="default"
    >
      {content}
    </Modal>
  )

  // Render the modal into document.body so it mounts at top-level and
  // is not affected by parent container layout/overflow. Keep Modal.jsx
  // untouched per request.
  const quickCreateModal = (
    <QuickItemCreateModal
      isOpen={Boolean(quickItemContext)}
      onClose={() => setQuickItemContext(null)}
      fetchWithAuth={fetchWithAuth}
      activeCompany={activeCompany}
      supplier={formData.supplier || supplierName || ''}
      initialItemCode={quickItemContext?.item?.item_code || ''}
      initialDescription={quickItemContext?.item?.description || ''}
      initialRate={quickItemContext?.item?.rate || ''}
      suggestedPriceList={formData.price_list || supplierDetails?.custom_default_price_list || ''}
      defaultCurrency={formData.currency || supplierDetails?.default_currency || ''}
      initialUom={quickItemContext?.item?.uom || quickItemContext?.item?.stock_uom || 'Unidad'}
      showNotification={showNotification}
      onCreated={handleQuickItemCreated}
      contextLabel="Orden de compra"
    />
  )

  if (typeof document !== 'undefined' && isOpen) {
    return (
      <>
        {createPortal(modalElement, document.body)}
        {showDeleteConfirmation && createPortal(deleteConfirmationModal, document.body)}
        {quickCreateModal}
      </>
    )
  }

  // Fallback (e.g., SSR) -- render normally only when open.
  return isOpen ? (
    <>
      {modalElement}
      {showDeleteConfirmation && deleteConfirmationModal}
      {quickCreateModal}
    </>
  ) : quickCreateModal
}

export default PurchaseOrderModal
