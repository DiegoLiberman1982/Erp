// --- COMPONENTE PARA LA SECCIÓN SUPERIOR DEL MODAL ---
import afipCodes from '../../../../../shared/afip_codes.json'

const PurchaseInvoiceModalHeader = ({
  formData,
  handleInputChange,
  availableLetters,
  availableComprobantes,
  comprobanteOptions,
  setSelectedComprobanteOption,
  setFormData,
  setAvailableComprobantes,
  paymentTerms,
  exchangeRateDate,
  salesConditionData,
  setSalesConditionData,
  setShowSalesConditionModal,
  isCreditNote,
  formatCurrency,
  FormField,
  isEditing,
  availableTalonarios,
  selectedPuntoVenta,
  setSelectedPuntoVenta,
  fetchWithAuth,
  availablePriceLists,
  selectedPriceListDetails,
  currencies,
  currenciesLoading,
  companyCurrency,
  showSalesConditionField = true,
  isSalesConditionLocked = false,
  lockedSalesConditionName = '',
  allowDueDateEdit = false
}) => {


  const buildStatusOptions = () => {
    const normalizedStatus = (formData.status || '').toLowerCase()
    if (!isEditing) {
      return ['Borrador', 'Confirmada']
    }

    if (normalizedStatus === 'anulada') {
      return ['Anulada']
    }

    if (normalizedStatus === 'confirmada') {
      return ['Confirmada', 'Anulada']
    }

    return ['Borrador', 'Confirmada']
  }

  const statusOptions = buildStatusOptions()
  const currencyOptions = Array.isArray(currencies) ? currencies : []

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 bg-white border border-gray-200 rounded-2xl p-4">
      <FormField label="Comprobante" className="sm:col-span-2">
        <div className="flex items-center gap-1">
          <select
            value={formData.invoice_category || 'A'}
            onChange={async (e) => {
              const selectedLetter = e.target.value
              handleInputChange('invoice_category', selectedLetter)

              // Update available comprobantes from centralized afip_codes.json (for purchases)
              const tiposCompras = afipCodes.uso_comprobante?.compras || []
              const filtered = afipCodes.tipos_comprobante
                ?.filter(t => tiposCompras.includes(t.tipo))
                .map(t => t.descripcion) || ['Factura', 'Nota de Débito', 'Nota de Crédito', 'Ticket']
              setAvailableComprobantes(filtered)

              // Set default comprobante for the selected letter
              const defaultComprobante = formData.invoice_type || 'Factura'
              const defaultOption = comprobanteOptions.find(opt =>
                opt.letra === selectedLetter && opt.descripcion === defaultComprobante
              )
              if (defaultOption) {
                setSelectedComprobanteOption(defaultOption)
                
                // No longer auto-fetch number or set punto_de_venta for free entry
                setFormData(prev => ({
                  ...prev,
                  voucher_type: defaultOption.letra,
                  invoice_type: defaultOption.descripcion
                  // punto_de_venta and invoice_number are now free entry
                }))
              }
            }}
            className="w-16 text-center text-xs font-semibold px-2 border border-r-0 border-gray-300 rounded-l-md bg-white h-7"
          >
            {availableLetters.map(letter => (
              <option key={letter} value={letter}>{letter}</option>
            ))}
          </select>
          <select
            value={formData.invoice_type || 'Factura'}
            onChange={async (e) => {
              handleInputChange('invoice_type', e.target.value)

              // Update form data with selected comprobante details
              const selectedOption = comprobanteOptions.find(opt =>
                opt.descripcion === e.target.value && opt.letra === formData.invoice_category
              )
              if (selectedOption) {
                setSelectedComprobanteOption(selectedOption)
                
                // No longer auto-fetch number or set punto_de_venta for free entry
                setFormData(prev => ({
                  ...prev,
                  voucher_type: selectedOption.letra,
                  invoice_type: selectedOption.descripcion
                  // punto_de_venta and invoice_number are now free entry
                }))
              }
            }}
            className="w-40 text-xs px-2 border-t border-b border-gray-300 bg-white h-7"
          >
            {availableComprobantes.map(comprobante => (
              <option key={comprobante} value={comprobante}>{comprobante}</option>
            ))}
          </select>
          <input
            type="text"
            value={formData.punto_de_venta || ''}
            onChange={(e) => {
              let value = e.target.value.replace(/[^0-9]/g, '') // Only allow numbers
              // Limit to 5 digits
              if (value.length > 5) {
                value = value.slice(0, 5)
              }
              console.log('� Punto de venta changed to:', value)
              handleInputChange('punto_de_venta', value)
            }}
            placeholder="XXXXX"
            className="w-28 text-center text-xs px-2 border border-l-0 border-gray-300 bg-white h-7"
          />
          <input
            type="text"
            value={formData.invoice_number || ''}
            onChange={(e) => {
              let value = e.target.value.replace(/[^0-9]/g, '') // Only allow numbers
              // Limit to 8 digits
              if (value.length > 8) {
                value = value.slice(0, 8)
              }
              console.log('🔢 Invoice number changed to:', value)
              handleInputChange('invoice_number', value)
            }}
            placeholder="XXXXXXXX"
            className="w-36 px-2 text-xs border border-l-0 border-gray-300 rounded-r-md bg-white h-7"
          />
        </div>
      </FormField>

      <div className="sm:col-span-2 lg:col-span-2 flex gap-2 items-end">
        <FormField label="Emisión" className="w-28">
          <input
            type="date"
            value={formData.bill_date || ''}
            onChange={(e) => handleInputChange('bill_date', e.target.value)}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7"
          />
        </FormField>

        <FormField label="Vencimiento" className="w-28">
          <input
            type="date"
            value={formData.due_date || ''}
            onChange={allowDueDateEdit ? (e) => handleInputChange('due_date', e.target.value) : undefined}
            className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${allowDueDateEdit ? '' : 'bg-gray-100 text-gray-600 cursor-not-allowed'}`}
            readOnly={!allowDueDateEdit}
          />
        </FormField>

        <FormField label="Fecha Contable" className="w-28">
          <input
            type="date"
            value={formData.posting_date || ''}
            onChange={(e) => handleInputChange('posting_date', e.target.value)}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7"
          />
        </FormField>
      </div>

      <FormField label="Título Factura" className="sm:col-span-2">
        <input
          type="text"
          value={formData.title || ''}
          onChange={(e) => handleInputChange('title', e.target.value)}
          placeholder="Ej: Venta de Servicios Profesionales"
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7"
        />
      </FormField>

      <FormField label="Estado">
        <select
          value={formData.status || 'Confirmada'}
          onChange={(e) => handleInputChange('status', e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white h-7"
        >
          {statusOptions.map(status => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </FormField>

      {!isCreditNote(formData.invoice_type) ? (
        showSalesConditionField ? (
          <FormField label="Condición Venta">
            <select
              value={formData.sales_condition_type || lockedSalesConditionName || 'Contado'}
              onChange={isSalesConditionLocked ? undefined : (e) => handleInputChange('sales_condition_type', e.target.value)}
              disabled={isSalesConditionLocked}
              className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${isSalesConditionLocked ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : 'bg-white'}`}
            >
              {paymentTerms.length > 0 ? (
                (isSalesConditionLocked
                  ? paymentTerms.filter(term => term.name === lockedSalesConditionName)
                  : paymentTerms
                ).map(term => (
                  <option key={term.name} value={term.name}>
                    {term.template_name}
                  </option>
                ))
              ) : (
                <>
                  {isSalesConditionLocked && lockedSalesConditionName ? (
                    <option value={lockedSalesConditionName}>{lockedSalesConditionName}</option>
                  ) : (
                    <>
                      <option>Contado</option>
                      <option>Cta. Cte.</option>
                    </>
                  )}
                </>
              )}
              {isSalesConditionLocked && lockedSalesConditionName && paymentTerms.length > 0 && !paymentTerms.some(term => term.name === lockedSalesConditionName) && (
                <option value={lockedSalesConditionName}>{lockedSalesConditionName}</option>
              )}
            </select>
          </FormField>
        ) : (
          <div className="hidden sm:block lg:block" aria-hidden="true" />
        )
      ) : (
        <div className="hidden sm:block lg:block" aria-hidden="true" />
      )}

      <FormField label="Lista de Precios">
        <select
          value={formData.price_list || ''}
          onChange={(e) => handleInputChange('price_list', e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Seleccionar lista de precios</option>
          {availablePriceLists.map(priceList => (
            <option key={priceList.name} value={priceList.name}>
              {priceList.price_list_name || priceList.name}
            </option>
          ))}
        </select>
        {selectedPriceListDetails && selectedPriceListDetails.currency && formData.currency !== selectedPriceListDetails.currency && (
          <div className="text-xs text-orange-600 mt-1">
            Lista en {selectedPriceListDetails.currency} - Cotización: {selectedPriceListDetails.custom_exchange_rate || 'N/A'}
          </div>
        )}
      </FormField>

      <div className="sm:col-span-2 lg:col-span-3">
        <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide text-right">Moneda</label>
        <div className="flex items-center justify-end w-full gap-4">
              {/* Grupo Derecho: Moneda y Tasa (alineados a la derecha) */}
              <div className="flex items-center gap-2">
                  <select
                      value={formData.currency || ''}
                      onChange={(e) => handleInputChange('currency', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white h-7"
                  >
                      <option value="">{currenciesLoading ? 'Cargando monedas...' : 'Seleccionar moneda'}</option>
                      {currencyOptions.length === 0 && formData.currency ? (
                        <option value={formData.currency}>{formData.currency}</option>
                      ) : null}
                      {currencyOptions.map((currency) => {
                        const code = currency.name || currency.code
                        const label = (currency.currency_name || code) + (currency.symbol ? ` (${currency.symbol})` : '')
                        return (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        )
                      })}
                  </select>
                  {Boolean(companyCurrency) && formData.currency && formData.currency !== companyCurrency && (
                      <div className="flex items-center gap-1">
                          <span className="text-sm text-gray-600">Tasa:</span>
                          <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={formData.exchange_rate ?? ''}
                              onChange={(e) => {
                                  const parsed = parseFloat(e.target.value)
                                  setFormData(prev => ({ ...prev, exchange_rate: Number.isFinite(parsed) ? parsed : '' }))
                              }}
                              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                              placeholder="1.00"
                          />
                          <button
                              type="button"
                              onClick={async () => {
                                  try {
                                      if (!formData.currency || !companyCurrency) return
                                      const response = await fetchWithAuth(
                                        `/api/currency-exchange/latest?currency=${encodeURIComponent(formData.currency)}&to=${encodeURIComponent(companyCurrency)}`
                                      )
                                      if (!response || !response.ok) {
                                        console.error('Exchange rate request failed', response?.status)
                                        return
                                      }
                                      const data = await response.json()
                                      if (data?.success && data.data) {
                                        const rate = data.data.exchange_rate || data.data.rate || data.data.cotizacion_ars
                                        if (rate) {
                                          setFormData(prev => ({ ...prev, exchange_rate: rate }))
                                        }
                                      }
                                  } catch (error) {
                                      console.error('Error fetching exchange rate:', error)
                                  }
                              }}
                              disabled={!formData.currency || !companyCurrency}
                              className="ml-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="Consultar cotización oficial"
                          >
                              📈
                          </button>
                      </div>
                  )}
              </div>
          </div>
          {exchangeRateDate && Boolean(companyCurrency) && formData.currency && formData.currency !== companyCurrency && (
              <div className="text-xs text-gray-500 mt-1 text-right">
                  Cotización {formData.currency} al {new Date(exchangeRateDate).toLocaleDateString('es-AR')}
              </div>
          )}
      </div>
    </div>
  )
}

export default PurchaseInvoiceModalHeader
