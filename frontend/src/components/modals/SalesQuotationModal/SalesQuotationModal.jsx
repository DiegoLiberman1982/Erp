import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, FileText, Loader2, Save, Send, StickyNote, UserRound } from 'lucide-react'
import Modal from '../../Modal.jsx'
import { SalesItemsTable } from '../shared'
import { fetchAvailableWarehouses, fetchSalesPriceLists } from '../InvoiceModal/invoiceModalApi.js'
import SalesItemSettingsModal from '../SalesItemSettingsModal.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import useCurrencies from '../../../hooks/useCurrencies'
import useTaxTemplates from '../../../hooks/useTaxTemplates'
import { getIvaRatesFromTemplates } from '../../../utils/taxTemplates'

const today = () => new Date().toISOString().split('T')[0]
const defaultValidTill = () => {
  const now = new Date()
  now.setDate(now.getDate() + 15)
  return now.toISOString().split('T')[0]
}

const recalculateItemAmount = (item) => {
  const qty = parseFloat(item.qty || 0) || 0
  const rate = parseFloat(item.rate || 0) || 0
  const discount = parseFloat(item.discount_amount || 0) || 0
  const amount = Math.max(qty * rate - discount, 0)
  return {
    ...item,
    amount: amount.toFixed(2)
  }
}

const createEmptyItem = () =>
  recalculateItemAmount({
    item_code: '',
    item_name: '',
    description: '',
    qty: 1,
    uom: 'Unit',
    rate: 0,
    discount_amount: 0,
    warehouse: '',
    item_defaults: [],
    item_tax_template: '',
    amount: '0.00'
  })

const normalizeItems = (items) => {
  const sourceItems = Array.isArray(items) && items.length > 0 ? items : [createEmptyItem()]
  return sourceItems.map((item) =>
    recalculateItemAmount({
      ...createEmptyItem(),
      ...item,
      item_name: item?.item_name || item?.item_code || '',
      description: item?.description || item?.item_name || item?.item_code || '',
      item_defaults: item?.item_defaults || []
    })
  )
}

const buildDefaultQuotation = (customer, company, currency) => ({
  customer: customer || '',
  company: company || '',
  transaction_date: today(),
  valid_till: defaultValidTill(),
  selling_price_list: '',
  currency: currency || '',
  contact_person: '',
  remarks: '',
  items: normalizeItems()
})

const stripCompanyAbbr = (name) => {
  if (!name || typeof name !== 'string') {
    return ''
  }
  const normalized = name.trim()
  const separatorIndex = normalized.lastIndexOf(' - ')
  if (separatorIndex === -1) {
    return normalized
  }
  return normalized.substring(0, separatorIndex)
}

const SalesQuotationModal = ({
  isOpen,
  onClose,
  selectedCustomer,
  customerDetails,
  activeCompany,
  fetchWithAuth,
  showNotification,
  editingQuotation,
  onSave
}) => {
  const [companyCurrency, setCompanyCurrency] = useState('')
  const [formData, setFormData] = useState(buildDefaultQuotation(selectedCustomer, activeCompany, ''))
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [availablePriceLists, setAvailablePriceLists] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [itemSettingsModal, setItemSettingsModal] = useState({ isOpen: false, item: null, itemIndex: null })
  const displayCustomerName = stripCompanyAbbr(selectedCustomer || formData.customer || '')
  const isDraft = (formData?.docstatus ?? 0) === 0

  useEffect(() => {
    if (!isOpen) return
    if (!activeCompany) {
      setCompanyCurrency('')
      return
    }
    let mounted = true
    const loadCompanyDetails = async () => {
      try {
        const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompany)}`)
        const payload = await response.json().catch(() => ({}))
        if (!mounted) return
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.message || `Status ${response.status}`)
        }
        setCompanyCurrency(payload?.data?.default_currency || '')
      } catch (error) {
        console.error('Error loading company currency:', error)
        if (mounted) setCompanyCurrency('')
      }
    }
    loadCompanyDetails()
    return () => {
      mounted = false
    }
  }, [isOpen, activeCompany, fetchWithAuth])
  const { currencies, loading: currenciesLoading } = useCurrencies()
  const { templates: taxTemplates } = useTaxTemplates(fetchWithAuth)
  const availableIVARates = useMemo(() => getIvaRatesFromTemplates(taxTemplates), [taxTemplates])

  useEffect(() => {
    if (isOpen && activeCompany) {
      fetchAvailableWarehouses(activeCompany, fetchWithAuth, setAvailableWarehouses)
    }
  }, [isOpen, activeCompany, fetchWithAuth])

  useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    const loadPriceLists = async () => {
      const lists = await fetchSalesPriceLists(fetchWithAuth, API_ROUTES.salesPriceLists)
      if (isMounted) {
        setAvailablePriceLists(Array.isArray(lists) ? lists : [])
      }
    }
    loadPriceLists()
    return () => {
      isMounted = false
    }
  }, [isOpen, fetchWithAuth])

  // Auto-select single price list when there is only one available
  useEffect(() => {
    if (!isOpen) return
    if (editingQuotation) return
    if (!availablePriceLists || availablePriceLists.length !== 1) return
    if (formData.selling_price_list) return

    const only = availablePriceLists[0]
    setFormData(prev => ({ ...prev, selling_price_list: only.name }))
  }, [isOpen, editingQuotation, availablePriceLists, formData.selling_price_list])

  useEffect(() => {
    if (isOpen && editingQuotation) {
      setFormData({
        ...editingQuotation,
        items: normalizeItems(editingQuotation.items)
      })
    } else if (isOpen) {
      setFormData(buildDefaultQuotation(selectedCustomer, activeCompany, companyCurrency))
    }
  }, [isOpen, editingQuotation, selectedCustomer, activeCompany, companyCurrency])

  useEffect(() => {
    if (!isOpen) return
    if (!companyCurrency) return
    if (formData.currency) return
    setFormData(prev => ({ ...prev, currency: companyCurrency }))
  }, [isOpen, companyCurrency, formData.currency])

  useEffect(() => {
    const shouldAutofillPriceList = isOpen && !editingQuotation && selectedCustomer && !formData.selling_price_list
    if (!shouldAutofillPriceList) return

    const priceListFromCustomer = customerDetails?.price_list || customerDetails?.selling_price_list
    if (priceListFromCustomer) {
      setFormData((prev) => ({
        ...prev,
        selling_price_list: prev.selling_price_list || priceListFromCustomer
      }))
      return
    }

    const loadGroupPriceList = async () => {
      const groupName = customerDetails?.customer_group
      if (!groupName) return
      try {
        const response = await fetchWithAuth(`/api/resource/Customer%20Group/${encodeURIComponent(groupName)}`)
        if (!response?.ok) return
        const payload = await response.json()
        const defaultList = payload?.data?.default_price_list
        if (defaultList) {
          setFormData((prev) => ({
            ...prev,
            selling_price_list: prev.selling_price_list || defaultList
          }))
        }
      } catch (error) {
        console.error('Error fetching customer group for price list:', error)
      }
    }

    loadGroupPriceList()
  }, [isOpen, editingQuotation, selectedCustomer, customerDetails, fetchWithAuth, formData.selling_price_list])

  const totals = useMemo(() => {
    const subtotal = (formData.items || []).reduce((acc, item) => {
      const amount = parseFloat(item.amount || item.base_amount || 0) || 0
      return acc + amount
    }, 0)
    return {
      subtotal,
      itemsCount: formData.items?.length || 0
    }
  }, [formData.items])

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }))
  }

  const handleItemChange = (index, field, value) => {
    if (!isDraft) return
    setFormData((prev) => {
      const items = [...(prev.items || [])]
      const current = items[index] || createEmptyItem()
      items[index] = recalculateItemAmount({
        ...current,
        [field]: value
      })
      return { ...prev, items }
    })
  }

  const handleAddItem = () => {
    if (!isDraft) return
    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), createEmptyItem()]
    }))
  }

  const handleRemoveItem = (index) => {
    if (!isDraft) return
    setFormData((prev) => {
      if ((prev.items || []).length <= 1) {
        return prev
      }
      const items = prev.items.filter((_, i) => i !== index)
      return { ...prev, items }
    })
  }

  const handleOpenItemSettings = (item, index) => {
    if (!isDraft) return
    setItemSettingsModal({
      isOpen: true,
      item,
      itemIndex: index
    })
  }

  const handleCloseItemSettings = () => {
    setItemSettingsModal({
      isOpen: false,
      item: null,
      itemIndex: null
    })
  }

  const handleSaveItemSettings = (itemIndex, settings) => {
    if (itemIndex === null || itemIndex === undefined || !isDraft) return
    setFormData((prev) => {
      const items = [...(prev.items || [])]
      if (!items[itemIndex]) {
        return prev
      }
      items[itemIndex] = recalculateItemAmount({
        ...items[itemIndex],
        income_account: settings?.income_account ?? items[itemIndex].income_account,
        warehouse: settings?.warehouse ?? items[itemIndex].warehouse,
        cost_center: settings?.cost_center ?? items[itemIndex].cost_center,
        valuation_rate: settings?.valuation_rate ?? items[itemIndex].valuation_rate
      })
      return { ...prev, items }
    })
  }

  const ensureCustomerAndCompany = () => ({
    ...formData,
    customer: formData.customer || selectedCustomer,
    company: formData.company || activeCompany
  })

  const persistQuotation = async (targetDocstatus = 0) => {
    if (!onSave) return
    setIsSaving(true)
    try {
      const payload = {
        ...ensureCustomerAndCompany(),
        docstatus: targetDocstatus
      }
      const isEditing = Boolean(payload.name || editingQuotation?.name)
      const response = await onSave(payload, { isEditing, targetDocstatus })
      if (response?.success) {
        onClose()
      }
    } catch (error) {
      console.error('Error saving sales quotation:', error)
      showNotification?.('Error al guardar el presupuesto', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const actionDisabled = isSaving || !selectedCustomer || !isDraft
  const headerInputClass = 'w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white h-7'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingQuotation ? 'Editar Presupuesto' : 'Nuevo Presupuesto'}
      subtitle={displayCustomerName || 'Arma la oferta antes de confirmar'}
      size="default"
    >
      {!selectedCustomer && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          Seleccioná un cliente para continuar.
        </div>
      )}

      {(!isDraft) && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-start gap-3">
          <Check className="w-5 h-5 mt-0.5" />
          Este presupuesto ya fue emitido. Podés verlo y duplicarlo, pero las ediciones son sólo para borradores.
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-6">
        <div className="flex-1 space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col text-sm text-gray-700">
                <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide">Fecha de presupuesto</span>
                <input
                  type="date"
                  className={headerInputClass}
                  value={formData.transaction_date || ''}
                  onChange={(e) => handleInputChange('transaction_date', e.target.value)}
                  disabled={!isDraft}
                />
              </label>
              <label className="flex flex-col text-sm text-gray-700">
                <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide">Válido hasta</span>
                <input
                  type="date"
                  className={headerInputClass}
                  value={formData.valid_till || ''}
                  onChange={(e) => handleInputChange('valid_till', e.target.value)}
                  disabled={!isDraft}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col text-sm text-gray-700">
                <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide">Lista de precios</span>
                <select
                  className={headerInputClass}
                  value={formData.selling_price_list || ''}
                  onChange={(e) => handleInputChange('selling_price_list', e.target.value)}
                  disabled={!isDraft}
                >
                  {availablePriceLists.length === 0 ? (
                    <option value="">Sin listas disponibles</option>
                  ) : (
                    <>
                      {availablePriceLists.length > 1 && !formData.selling_price_list && (
                        <option value="">Seleccioná una lista</option>
                      )}
                      {availablePriceLists.map((priceList) => (
                        <option key={priceList.name} value={priceList.name}>
                          {`${priceList.price_list_name || priceList.name}${priceList.currency ? ` (${priceList.currency})` : ''}`}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <label className="flex flex-col text-sm text-gray-700">
                <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide">Moneda</span>
                <select
                  className={headerInputClass}
                  value={formData.currency || ''}
                  onChange={(e) => handleInputChange('currency', e.target.value)}
                  disabled={!isDraft}
                >
                  <option value="">{currenciesLoading ? 'Cargando monedas...' : 'Seleccionar moneda'}</option>
                  {currencies?.map((currency) => (
                    <option key={currency.name || currency.code} value={currency.name || currency.code}>
                      {(currency.currency_name || currency.name || currency.code) + (currency.symbol ? ` · ${currency.symbol}` : '')}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col text-sm text-gray-700">
              <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide flex items-center gap-2">
                <UserRound className="w-4 h-4 text-gray-500" />
                Contacto (recordatorio)
              </span>
              <input
                type="text"
                className={headerInputClass}
                placeholder="Vamos a integrar la agenda de contactos"
                value={formData.contact_person || ''}
                onChange={(e) => handleInputChange('contact_person', e.target.value)}
                disabled={!isDraft}
              />
              <span className="text-xs text-gray-500 mt-1">Lo dejamos como nota mientras armamos la dinámica completa de contactos.</span>
            </label>

            <label className="flex flex-col text-sm text-gray-700">
              <span className="text-[11px] font-bold text-gray-500 mb-1 tracking-wide">Notas internas</span>
              <textarea
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            placeholder="Términos, aclaraciones o recordatorios"
                value={formData.remarks || ''}
                rows={2}
                onChange={(e) => handleInputChange('remarks', e.target.value)}
                disabled={!isDraft}
              />
            </label>
          </div>

          <SalesItemsTable
            formData={formData}
            handleItemChange={handleItemChange}
            addItem={handleAddItem}
            removeItem={handleRemoveItem}
            availableIVARates={availableIVARates}
            onOpenItemSettings={handleOpenItemSettings}
            activeCompany={activeCompany}
            fetchWithAuth={fetchWithAuth}
            availableWarehouses={availableWarehouses}
            onSaveItemSettings={handleSaveItemSettings}
            showStockWarnings={false}
            priceListName={formData.selling_price_list}
          />
        </div>

        <aside className="w-full xl:w-80 flex-shrink-0 space-y-4">
          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <CalendarClock className="w-6 h-6 text-blue-500" />
              <div>
                <p className="text-sm font-semibold text-gray-800">Resumen</p>
                <p className="text-xs text-gray-500">No contable hasta emitir</p>
              </div>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <div className="flex items-center justify-between">
                <span>Items</span>
                <span className="font-semibold">{totals.itemsCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total estimado</span>
                <span className="font-semibold">{totals.subtotal.toFixed(2)}</span>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <StickyNote className="w-5 h-5 text-gray-500 mt-0.5" />
              <p className="text-sm text-gray-700">
                Los presupuestos no afectan stock ni contabilidad. Podés editarlos mientras están en borrador.
              </p>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <button
              type="button"
              onClick={() => persistQuotation(0)}
              disabled={actionDisabled}
              className="btn-secondary w-full inline-flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar borrador
            </button>
            <button
              type="button"
              onClick={() => persistQuotation(1)}
              disabled={actionDisabled}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Emitir presupuesto
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cerrar
            </button>
          </section>
        </aside>
      </div>

      <SalesItemSettingsModal
        isOpen={itemSettingsModal.isOpen}
        item={itemSettingsModal.item}
        itemIndex={itemSettingsModal.itemIndex}
        onClose={handleCloseItemSettings}
        onSave={handleSaveItemSettings}
        availableWarehouses={availableWarehouses}
        fetchWithAuth={fetchWithAuth}
      />
    </Modal>
  )
}

export default SalesQuotationModal
