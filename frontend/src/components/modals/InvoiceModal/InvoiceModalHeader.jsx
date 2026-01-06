// --- COMPONENTE PARA LA SECCIÓN SUPERIOR DEL MODAL ---
import React, { useEffect, useRef } from 'react'
import useCurrencies from '../../../hooks/useCurrencies'
import afipCodes from '../../../../../shared/afip_codes.json'

const safeUseMemo = (factory, deps) => {
  if (typeof React.useMemo === 'function') {
    return React.useMemo(factory, deps)
  }
  return factory()
}

const normalizeDescription = (value = '') => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
const InvoiceModalHeader = ({
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
  availablePriceLists = [],
  isLoadingComprobantes = false,
  statusLocked = false,
  showSalesConditionField = true,
  isSalesConditionLocked = false,
  lockedSalesConditionName = '',
  allowDueDateEdit = false,
  companyCurrency = ''
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
  const { currencies, loading: currenciesLoading } = useCurrencies()

  const resolvedPuntoVenta = selectedPuntoVenta || formData.punto_de_venta || (availableTalonarios.length === 1 ? availableTalonarios[0].punto_de_venta : null)
  const currentTalonario = availableTalonarios.find(t => t.punto_de_venta === resolvedPuntoVenta)
  const isElectronicInvoiceType = (formData.invoice_type || '').toLowerCase().includes('electrónica')
  const isElectronicTalonario = currentTalonario?.factura_electronica === 1 || currentTalonario?.factura_electronica === true
  // Permitir editar el número siempre (también en electrónica); el pad/validación se hace al guardar.
  const showElectronicNumberPlaceholder = false
  const normalizedCurrency = (formData.currency || '').trim().toUpperCase()
  const companyCurrencyNormalized = (companyCurrency || '').trim().toUpperCase()
  const showExchangeRateControls = normalizedCurrency && companyCurrencyNormalized && normalizedCurrency !== companyCurrencyNormalized

  // Ref to track the last processed comprobantes key to avoid redundant updates
  const lastProcessedKeyRef = useRef({ comprobantesKey: null, invoiceType: null })

  const tipoToDescripcion = safeUseMemo(() => {
    const map = new Map()
    ;(afipCodes.tipos_comprobante || []).forEach(t => map.set(t.tipo, t.descripcion))
    return map
  }, [])

  const computedComprobantesFromTalonario = safeUseMemo(() => {
    const letter = formData.invoice_category || ''
    if (!currentTalonario || !Array.isArray(currentTalonario.tipo_de_comprobante_afip) || !letter) return null

    const allowedCodes = new Set()
    currentTalonario.tipo_de_comprobante_afip.forEach(tc => {
      const code = (tc.codigo_afip || tc.tipo_comprobante || tc.codigo || '').toString().padStart(3, '0')
      if (code) allowedCodes.add(code)
    })

    const tiposFound = new Set()
    Object.entries(afipCodes.comprobantes || {}).forEach(([code, info]) => {
      const codeKey = String(code).padStart(3, '0')
      if (!allowedCodes.has(codeKey)) return
      if (!info || !info.letra || info.letra !== letter) return
      if (info.tipo) tiposFound.add(info.tipo)
    })

    if (tiposFound.size === 0) return []
    let descriptions = [...tiposFound].map(t => tipoToDescripcion.get(t) || t)
    descriptions = descriptions.map(desc => desc.replace(/\s+[A-Z]$/, ''))
    descriptions.sort((a, b) => (a === 'Factura' ? -1 : 0))
    return descriptions
  }, [currentTalonario, formData.invoice_category, tipoToDescripcion])

  // If computed comprobantes change and the current invoice_type is not in them, update to default
  const computedComprobantesKey = Array.isArray(computedComprobantesFromTalonario)
    ? computedComprobantesFromTalonario.join('|')
    : 'null'

  useEffect(() => {
    if (!computedComprobantesFromTalonario || computedComprobantesFromTalonario.length === 0) return

    // If the current invoice type is a credit note chosen by the user, do not
    // override it automatically when computed comprobantes change. This avoids
    // switching from 'Nota de Crédito' back to 'Factura' after importing linked
    // documents or other operations that update formData.
    try {
      if (typeof isCreditNote === 'function' && isCreditNote(formData.invoice_type)) {
        lastProcessedKeyRef.current = { comprobantesKey: computedComprobantesKey, invoiceType: formData.invoice_type }
        return
      }
    } catch (e) {
      // If anything goes wrong with the helper, fall back to existing behavior
    }

    const normalizedList = computedComprobantesFromTalonario.map(normalizeDescription)
    const normalizedCurrent = normalizeDescription(formData.invoice_type || '')
    
    // Check if current type matches any entry in the list (exact match only)
    const currentMatches = normalizedList.some(entry => entry === normalizedCurrent)
    if (currentMatches) {
      // Update ref to track this as processed
      lastProcessedKeyRef.current = { comprobantesKey: computedComprobantesKey, invoiceType: formData.invoice_type }
      return
    }

    // Skip if we already processed this exact combination to avoid loops
    if (
      lastProcessedKeyRef.current.comprobantesKey === computedComprobantesKey &&
      lastProcessedKeyRef.current.invoiceType === formData.invoice_type
    ) {
      return
    }

    // If the current invoice_type is not in computed list, switch to the first.
    const defaultDesc = computedComprobantesFromTalonario[0]
    const defaultOption = comprobanteOptions.find(opt => normalizeDescription(opt.descripcion) === normalizeDescription(defaultDesc) && opt.letra === formData.invoice_category) || {
      descripcion: defaultDesc,
      letra: formData.invoice_category,
      punto_de_venta: resolvedPuntoVenta
    }

    if (
      normalizeDescription(formData.invoice_type || '') === normalizeDescription(defaultOption.descripcion || '') &&
      (formData.voucher_type || formData.invoice_category) === defaultOption.letra &&
      (formData.punto_de_venta || '') === (defaultOption.punto_de_venta || '')
    ) {
      // Nothing to update, but ensure computed list is stored
      lastProcessedKeyRef.current = { comprobantesKey: computedComprobantesKey, invoiceType: formData.invoice_type }
      if (Array.isArray(computedComprobantesFromTalonario) && computedComprobantesFromTalonario.length > 0) {
        setAvailableComprobantes(prev => {
          const prevKey = Array.isArray(prev) ? prev.join('|') : ''
          const nextKey = computedComprobantesFromTalonario.join('|')
          return prevKey === nextKey ? prev : computedComprobantesFromTalonario
        })
      }
      return
    }

    // Track that we're about to update to this new value
    lastProcessedKeyRef.current = { comprobantesKey: computedComprobantesKey, invoiceType: defaultOption.descripcion }
    
    setSelectedComprobanteOption(defaultOption)
    setFormData(prev => ({
      ...prev,
      voucher_type: defaultOption.letra,
      invoice_type: defaultOption.descripcion,
      punto_de_venta: defaultOption.punto_de_venta
    }))
    setAvailableComprobantes(computedComprobantesFromTalonario)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedComprobantesKey, formData.invoice_category, formData.invoice_type, comprobanteOptions, resolvedPuntoVenta])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 p-3 border border-gray-200 rounded-2xl bg-white">
      <FormField label="Comprobante" className="sm:col-span-2">
          {isLoadingComprobantes ? (
          <div className="flex items-center justify-center gap-2 h-8 px-3 border border-gray-300 rounded-md bg-white">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
            <span className="text-sm text-gray-600">Procesando...</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
          <select
            value={formData.invoice_category || 'A'}
            onChange={(e) => {
              const selectedLetter = e.target.value
              if ((formData.invoice_category || 'A') === selectedLetter) {
                return
              }
              handleInputChange('invoice_category', selectedLetter)

              const filteredFromBackend = [...new Set(comprobanteOptions
                .filter(opt => opt.letra === selectedLetter)
                .map(opt => opt.descripcion))]

              const filtered = (computedComprobantesFromTalonario && computedComprobantesFromTalonario.length > 0)
                ? computedComprobantesFromTalonario
                : filteredFromBackend
              setAvailableComprobantes(filtered)

              // Find a default option in backend options, otherwise construct one from talonario
              let defaultOption = comprobanteOptions.find(opt => opt.letra === selectedLetter && filtered.includes(opt.descripcion))
              if (!defaultOption && filtered && filtered.length > 0) {
                defaultOption = {
                  descripcion: filtered[0],
                  letra: selectedLetter,
                  punto_de_venta: resolvedPuntoVenta
                }
              }
              if (defaultOption) {
                setSelectedComprobanteOption(defaultOption)
                setFormData(prev => ({
                  ...prev,
                  voucher_type: defaultOption.letra,
                  invoice_type: defaultOption.descripcion,
                  punto_de_venta: defaultOption.punto_de_venta
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
            value={formData.invoice_type || 'Factura Electrónica'}
            onChange={(e) => {
              const selectedDesc = e.target.value
              if (normalizeDescription(formData.invoice_type || '') === normalizeDescription(selectedDesc)) {
                return
              }
              handleInputChange('invoice_type', selectedDesc)

              const selectedOption = comprobanteOptions.find(opt =>
                opt.descripcion === selectedDesc && opt.letra === formData.invoice_category
              )

              if (selectedOption) {
                setSelectedComprobanteOption(selectedOption)
                setFormData(prev => ({
                  ...prev,
                  voucher_type: selectedOption.letra,
                  invoice_type: selectedOption.descripcion,
                  punto_de_venta: selectedOption.punto_de_venta
                }))
                return
              }

              // If not found on comprobanteOptions but we have a computed list from talonario
              if (computedComprobantesFromTalonario && computedComprobantesFromTalonario.includes(selectedDesc)) {
                const constructed = {
                  descripcion: selectedDesc,
                  letra: formData.invoice_category,
                  punto_de_venta: resolvedPuntoVenta
                }
                setSelectedComprobanteOption(constructed)
                setFormData(prev => ({
                  ...prev,
                  voucher_type: constructed.letra,
                  invoice_type: constructed.descripcion,
                  punto_de_venta: constructed.punto_de_venta
                }))
              }
            }}
            className="w-40 text-xs px-2 border-t border-b border-gray-300 bg-white h-7"
          >
            { (computedComprobantesFromTalonario && computedComprobantesFromTalonario.length > 0 ? computedComprobantesFromTalonario : availableComprobantes).map(comprobante => (
              <option key={comprobante} value={comprobante}>{comprobante}</option>
            ))}
          </select>
          <select
            value={availableTalonarios.length === 1 ? availableTalonarios[0].punto_de_venta : (selectedPuntoVenta || '')}
            onChange={(e) => {
              console.log('--- Punto de venta: changed')
              const selectedPuntoVenta = e.target.value
              handleInputChange('punto_de_venta', selectedPuntoVenta)
              setSelectedPuntoVenta(selectedPuntoVenta)

              // Find the corresponding talonario and update invoice details
              const selectedTalonario = availableTalonarios.find(talonario =>
                talonario.punto_de_venta === selectedPuntoVenta
              )

              if (selectedTalonario) {
                console.log('--- Talonario: found')

                let metodoNumeracion = selectedTalonario.metodo_numeracion_factura_venta

                // Si no tiene método de numeración, generarlo automáticamente
                if (!metodoNumeracion || metodoNumeracion.trim() === '') {
                  console.log('--- Talonario: generating numeración method')

                  // Determinar prefijo FE/FM
                  const prefix = selectedTalonario.factura_electronica === 1 || selectedTalonario.factura_electronica === true ? 'FE' : 'FM'

                  // Determinar tipo base según el tipo de factura actual primero, luego fallback a tipo de talonario
                  let tipoBase = 'FAC'  // Default para facturas
                  if (formData.invoice_type === 'Factura' || formData.invoice_type === 'Factura Electrónica') {
                    tipoBase = 'FAC'
                  } else if (formData.invoice_type === 'Nota de Crédito') {
                    tipoBase = 'NDC'
                  } else if (formData.invoice_type === 'Nota de Débito') {
                    tipoBase = 'NDB'
                  } else if (formData.invoice_type === 'Recibo') {
                    tipoBase = 'REC'
                  } else {
                    // Fallback: usar tipo de talonario
                    const tipoTalonario = selectedTalonario.tipo_de_talonario || ''
                    if (tipoTalonario.includes('Factura')) {
                      tipoBase = 'FAC'
                    } else if (tipoTalonario.includes('Nota de Crédito')) {
                      tipoBase = 'NDC'
                    } else if (tipoTalonario.includes('Nota de Débito')) {
                      tipoBase = 'NDB'
                    } else if (tipoTalonario.includes('Recibo')) {
                      tipoBase = 'REC'
                    }
                  }

                  // Usar la letra actual del formulario o A como fallback
                  const letra = formData.invoice_category || 'A'

                  // Formatear punto de venta (5 dígitos) y número de inicio (8 dígitos)
                  const puntoVenta = String(selectedTalonario.punto_de_venta).padStart(5, '0')
                  const numeroInicio = String(selectedTalonario.numero_de_inicio || 1).padStart(8, '0')

                  console.log('--- Numero generation: debugging')

                  // Generar el método de numeración con la letra correcta
                  metodoNumeracion = `${prefix}-${tipoBase}-${letra}-${puntoVenta}-${numeroInicio}`
                  console.log('--- Numero generation: method generated')
                }

                // IMPORTANTE: Siempre usar el método de numeración generado o el que viene del talonario
                // Si viene del talonario (metodoNumeracion ya está establecido), usarlo
                // Si fue generado, ya tiene el tipo y letra correctos
                const finalMetodoNumeracion = metodoNumeracion
                
                console.log('--- Numero generation: final method set')

                // Update form data with talonario information
                setFormData(prev => ({
                  ...prev,
                  invoice_number: selectedTalonario.numero_de_inicio?.toString().padStart(8, '0') || '00000001',
                  metodo_numeracion_factura_venta: finalMetodoNumeracion
                }))
              } else {
                console.log('--- Talonario: not found for punto de venta')
              }
            }}
            className="w-24 text-center text-xs px-2 border border-l-0 border-gray-300 bg-white h-7"
            disabled={availableTalonarios.length === 1}
          >
            {availableTalonarios.length === 1 ? (
              <option value={availableTalonarios[0].punto_de_venta}>
                {availableTalonarios[0].punto_de_venta}
              </option>
            ) : (
              <>

                {availableTalonarios.map(talonario => (
                  <option key={talonario.name} value={talonario.punto_de_venta}>
                    {talonario.punto_de_venta}
                  </option>
                ))}
              </>
            )}
          </select>
          {showElectronicNumberPlaceholder ? (
            <div className="w-28 px-2 text-xs border border-l-0 border-gray-300 rounded-r-md bg-gray-50 h-7 flex items-center justify-center font-semibold text-gray-500">
              F. electrónica
            </div>
          ) : (
            <input
              type="text"
              value={formData.invoice_number || '0001'}
              onChange={(e) => {
                console.log('--- Invoice number: changed')
                handleInputChange('invoice_number', e.target.value)
              }}
              placeholder="Número"
              className="w-28 px-2 text-xs border border-l-0 border-gray-300 rounded-r-md bg-white h-7"
            />
          )}
        </div>
        )}
      </FormField>

      <FormField label="Fecha Emisión">
        <input
          type="date"
          value={formData.posting_date || ''}
          onChange={(e) => handleInputChange('posting_date', e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7"
        />
      </FormField>

      <FormField label="Fecha Vencimiento">
        <input
          type="date"
          value={formData.due_date || ''}
          onChange={allowDueDateEdit ? (e) => handleInputChange('due_date', e.target.value) : undefined}
          className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${allowDueDateEdit ? '' : 'bg-gray-100 text-gray-600 cursor-not-allowed'}`}
          readOnly={!allowDueDateEdit}
        />
      </FormField>

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
        {statusLocked ? (
          <div className="w-full px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-md border border-gray-200 h-7 flex items-center">
            Confirmada (orden de venta)
          </div>
        ) : (
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
        )}
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
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white h-7"
        >
          {availablePriceLists.length === 0 ? (
            <option value="">Sin listas disponibles</option>
          ) : (
            <>
              {!formData.price_list && <option value="">Seleccioná una lista</option>}
              {availablePriceLists.map(priceList => (
                <option key={priceList.name} value={priceList.name}>
                  {`${priceList.price_list_name || priceList.name}${priceList.currency ? ` (${priceList.currency})` : ''}`}
                </option>
              ))}
            </>
          )}
        </select>
      </FormField>

      {/* Moneda a la izquierda de FCE MiPyME */}
      <div>
        <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide text-right">Moneda</label>
        <select
          value={formData.currency || ''}
          onChange={(e) => handleInputChange('currency', e.target.value)}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent bg-white h-7"
        >
          <option value="">{currenciesLoading ? 'Cargando monedas...' : 'Seleccionar moneda'}</option>
          {currencies && currencies.map((c) => (
            <option key={c.name || c.code} value={c.name || c.code}>
              {(c.currency_name || c.name || c.code) + (c.symbol ? ` (${c.symbol})` : '')}
            </option>
          ))}
        </select>
      </div>

      {/* FCE MiPyME checkbox */}
      <FormField label="Es FCE MiPyME">
        <div className="flex items-center h-7">
          <input
            id="fce-checkbox"
            type="checkbox"
            checked={salesConditionData.condition === 'Factura de crédito electrónica MiPyME (FCE)'}
            onChange={(e) => {
              if (e.target.checked) {
                setSalesConditionData(prev => ({
                  ...prev,
                  condition: 'Factura de crédito electrónica MiPyME (FCE)',
                  transmission_option: 'Transferencia Sistema de Circulación Abierta'
                }));
                setShowSalesConditionModal(true);
              } else {
                setSalesConditionData(prev => ({
                  ...prev,
                  condition: 'Contado',
                  transmission_option: 'Transferencia Sistema de Circulación Abierta'
                }));
              }
            }}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded"
          />
          <label htmlFor="fce-checkbox" className="ml-2 text-xs font-semibold text-gray-600">Sí</label>
        </div>
      </FormField>

      {/* Tasa de cambio - solo si hay moneda extranjera */}
      {showExchangeRateControls && (
        <FormField label="Tasa de Cambio" className="sm:col-span-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={formData.exchange_rate || 1}
              onChange={(e) => {
                const rate = parseFloat(e.target.value) || 1;
                setFormData(prev => ({ ...prev, exchange_rate: rate }));
              }}
              className="w-24 px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7"
              placeholder="1.00"
            />
            {exchangeRateDate && (
              <span className="text-xs text-gray-500">
                al {new Date(exchangeRateDate).toLocaleDateString('es-AR')}
              </span>
            )}
          </div>
        </FormField>
      )}
    </div>
  )
}

export default InvoiceModalHeader
