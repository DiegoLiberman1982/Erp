import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import afipCodes from '../../../../../../shared/afip_codes.json'
import { getIvaRatesFromTemplates } from '../../../../utils/taxTemplates'

export const usePurchaseInvoiceEffects = (
  isOpen,
  selectedSupplier,
  formData,
  isEditing,
  editingData,
  paymentTerms,
  availableTalonarios,
  comprobanteOptions,
  selectedComprobanteOption,
  companyCurrency,
  companyName,
  availablePriceLists,
  supplierDetails,
  activeCompanyDetails,
  rateToTemplateMap,
  fetchWithAuth,
  getSupplierDetails,
  getWarehouses,
  getPurchasePriceLists,
  getTalonarios,
  getPaymentTerms,
  getTaxTemplates,
  clearStaticDataCache,
  determineComprobanteOptions,
  filterTalonariosByComprobanteType,
  fetchPurchasePriceListDetails,
  getDefaultIVARate,
  calculateDueDate,
  calculateItemAmount,
  setFormData,
  setCompanyCurrency,
  setCompanyName,
  setsupplierDetails,
  setActiveCompanyDetails,
  setAvailableWarehouses,
  setAvailableTalonarios,
  setPaymentTerms,
  setTaxTemplates,
  setRateToTemplateMap,
  setIvaRateAccountMap,
  setAvailableIVARates,
  setAvailablePriceLists,
  setSelectedPriceListDetails,
  setFilteredTalonarios,
  setComprobanteOptions,
  setAvailableLetters,
  setAvailableComprobantes,
  setSelectedComprobanteOption,
  setExchangeRate,
  setExchangeRateDate,
  setIsLoadingExchangeRate,
  setFreshInvoiceData,
  setDocumentIsCreditNote,
  setUnpaidInvoices,
  setImportedInvoicesKey,
  showNotification
) => {
  const normalizeCompany = useCallback((value) => (value || "").trim().toLowerCase(), [])

  // Caché para evitar llamadas repetitivas a getNextAvailableNumber
  const numberCacheRef = useRef(new Map())

  // Ref to prevent duplicate exchange rate fetches
  const exchangeRateFetchRef = useRef(false)
  const staticDataLoadedRef = useRef(false)
  const loadedCompanyNameRef = useRef('')

  const supplierPaymentTermName = typeof (supplierDetails?.payment_terms) === 'string'
    ? supplierDetails.payment_terms.trim()
    : ''
  const hasSupplierPaymentTerm = supplierPaymentTermName !== ''

  // Load static company data once per open (avoid duplicate requests)
  useEffect(() => {
    const loadStaticData = async () => {
      try {
        let localCompanyName = loadedCompanyNameRef.current || companyName || ''

        if (!staticDataLoadedRef.current) {
          const companyResponse = await fetchWithAuth('/api/active-company')
          if (companyResponse.ok) {
            const companyData = await companyResponse.json().catch(() => ({}))
            if (companyData.success) {
              const nextCompanyName = companyData.data.active_company
              const nextCurrency = companyData.data.company_details?.default_currency
              if (nextCompanyName) {
                localCompanyName = nextCompanyName
                loadedCompanyNameRef.current = nextCompanyName
                setCompanyName(nextCompanyName)
              }
              if (nextCurrency) {
                setCompanyCurrency(nextCurrency)
              }
            }
          }
        }

        if (localCompanyName) {
          await getWarehouses(localCompanyName).then(data => {
            if (data) setAvailableWarehouses(data)
          })

          await getTalonarios(localCompanyName).then(data => {
            if (data) setAvailableTalonarios(data)
          })

          await getPurchasePriceLists(localCompanyName).then(data => {
            if (data) {
              const filtered = data.filter(pl => {
                const plCompany = normalizeCompany(pl.custom_company || pl.company || pl.company_name)
                const cmp = normalizeCompany(localCompanyName)
                return !plCompany || plCompany === cmp
              })
              setAvailablePriceLists(filtered)
            } else {
              setAvailablePriceLists([])
            }
          })
        }

        await getTaxTemplates().then(data => {
          if (data) {
            let purchaseTemplates = []
            if (Array.isArray(data.purchase)) {
              purchaseTemplates = data.purchase
            } else if (data && data.data && Array.isArray(data.data.purchase)) {
              purchaseTemplates = data.data.purchase
            } else if (Array.isArray(data.templates)) {
              purchaseTemplates = data.templates.filter(t => (t.title || t.name || '').toString().toLowerCase().includes('compras'))
            } else if (Array.isArray(data)) {
              purchaseTemplates = data.filter(t => (t.title || t.name || '').toString().toLowerCase().includes('compras'))
            }

            setTaxTemplates(purchaseTemplates)
            try {
              if (data && data.rate_to_template_map) {
                const purchaseMap = data.rate_to_template_map.purchase || data.rate_to_template_map || {}
                setRateToTemplateMap(purchaseMap)
              } else if (data && data.rateToTemplateMap && data.rateToTemplateMap.purchase) {
                setRateToTemplateMap(data.rateToTemplateMap.purchase)
              } else {
                setRateToTemplateMap({})
              }
            } catch (err) {
              setRateToTemplateMap({})
            }

            try {
              const accountMap = {}
              purchaseTemplates.forEach(template => {
                const rates = template.iva_rates || []
                const accounts = template.accounts || []
                rates.forEach((rate, index) => {
                  const parsedRate = parseFloat(rate)
                  if (!Number.isFinite(parsedRate)) return
                  const key = parsedRate.toFixed(2)
                  const account = accounts[index]
                  if (account) {
                    accountMap[key] = account
                  }
                })
              })
              setIvaRateAccountMap(accountMap)
            } catch {
              setIvaRateAccountMap({})
            }

            const finalRates = getIvaRatesFromTemplates(purchaseTemplates)
            setAvailableIVARates(finalRates)
          } else {
            setRateToTemplateMap({})
            setIvaRateAccountMap({})
            setAvailableIVARates([])
          }
        })

        await getPaymentTerms().then(data => {
          if (data) setPaymentTerms(data)
        })

        staticDataLoadedRef.current = true
      } catch (error) {
        console.error('Error getting company info:', error)
      }
    }

    if (isOpen) loadStaticData()
  }, [isOpen, isEditing])

  // Load supplier details when supplier changes
  useEffect(() => {
    const loadSupplier = async () => {
      if (!isOpen || !selectedSupplier) return
      try {
        const supplierData = await getSupplierDetails(selectedSupplier)
        if (supplierData) {
          setsupplierDetails(supplierData)
          if (!isEditing && !editingData) {
            determineComprobanteOptions(
              supplierData.custom_condicion_iva,
              setComprobanteOptions,
              setAvailableLetters,
              setAvailableComprobantes,
              setFormData,
              setSelectedComprobanteOption,
              isEditing,
              afipCodes
            )
          }
        }
      } catch (error) {
        console.error('Error getting supplier info:', error)
      }
    }
    loadSupplier()
  }, [isOpen, selectedSupplier, isEditing, editingData])

  // Effect to set default IVA rate in items when supplier details are loaded
  useEffect(() => {
    if (supplierDetails && !isEditing) {
      const defaultIVARate = getDefaultIVARate(supplierDetails, activeCompanyDetails, rateToTemplateMap)

      if (defaultIVARate) {
        setFormData(prev => ({
          ...prev,
          items: prev.items.map(item => {
            const current = (item.iva_percent || '').toString()
            if (current === '21.00' || current === '21') {
              return { ...item, iva_percent: defaultIVARate }
            }
            return item
          })
        }))
      }
    }
  }, [supplierDetails, activeCompanyDetails, rateToTemplateMap, isEditing])

  // Effect to set default price list when supplier details and price lists are loaded
  useEffect(() => {
    if (supplierDetails && availablePriceLists.length > 0 && !formData.price_list) {
      const defaultPriceList = supplierDetails.custom_default_price_list
      if (defaultPriceList) {
        const matchingPriceList = availablePriceLists.find(pl => pl.name === defaultPriceList)
        if (matchingPriceList) {
          setFormData(prev => ({
            ...prev,
            price_list: matchingPriceList.name
          }))
        }
      }
    }
  }, [supplierDetails, availablePriceLists, formData.price_list])

  useEffect(() => {
    if (formData.price_list && availablePriceLists.length > 0) {
      const existsInCompany = availablePriceLists.some(pl => pl.name === formData.price_list)
      if (!existsInCompany) {
        setSelectedPriceListDetails(null)
        setFormData(prev => ({ ...prev, price_list: '' }))
        return
      }

      const fetchPriceListDetails = async () => {
        try {
          const priceListDetails = await fetchPurchasePriceListDetails(fetchWithAuth, formData.price_list)
          const plCompany = normalizeCompany(priceListDetails?.custom_company)
          const cmp = normalizeCompany(companyName)
          if (plCompany && cmp && plCompany !== cmp) {
            setSelectedPriceListDetails(null)
            setFormData(prev => ({ ...prev, price_list: '' }))
            showNotification('La lista de precios pertenece a otra compañia', 'warning')
            return
          }
          setSelectedPriceListDetails(priceListDetails)
        } catch (error) {
          setSelectedPriceListDetails(null)
          showNotification('Error al obtener detalles de la lista de precios', 'error')
        }
      }
      fetchPriceListDetails()
    } else {
      setSelectedPriceListDetails(null)
    }
  }, [formData.price_list, availablePriceLists, companyName])

  // Memoizar valores calculados para reducir dependencias en useEffect
  const filteredTalonariosMemo = useMemo(() => {
    return filterTalonariosByComprobanteType(
      availableTalonarios,
      formData.invoice_category,
      formData.invoice_type
    )
  }, [availableTalonarios, formData.invoice_category, formData.invoice_type])

  // Actualizar estado cuando cambie el memo
  useEffect(() => {
    setFilteredTalonarios(filteredTalonariosMemo)
  }, [filteredTalonariosMemo])

  // Effect to set default payment term when payment terms are loaded
  useEffect(() => {
    if (hasSupplierPaymentTerm) {
      setFormData(prev => {
        if (prev.sales_condition_type === supplierPaymentTermName) {
          return prev
        }
        return {
          ...prev,
          sales_condition_type: supplierPaymentTermName
        }
      })
      return
    }

    if (paymentTerms.length > 0 && !isEditing) {
      const contadoTerm = paymentTerms.find(term =>
        term.template_name?.toLowerCase().includes('contado') ||
        term.name?.toLowerCase().includes('contado')
      )
      const defaultTerm = contadoTerm || paymentTerms[0]

      if (defaultTerm && formData.sales_condition_type !== defaultTerm.name) {
        setFormData(prev => ({
          ...prev,
          sales_condition_type: defaultTerm.name
        }))
      }
    }
  }, [paymentTerms, isEditing, hasSupplierPaymentTerm, supplierPaymentTermName, formData.sales_condition_type, setFormData])

  // Effect to calculate due date when payment term or posting date changes
  useEffect(() => {
    if (!hasSupplierPaymentTerm) {
      return
    }
    const baseDate = formData.bill_date || formData.posting_date
    if (baseDate) {
      const dueDate = calculateDueDate(
        supplierPaymentTermName || formData.sales_condition_type,
        baseDate,
        paymentTerms
      )
      if (dueDate && dueDate !== formData.due_date) {
        setFormData(prev => ({ ...prev, due_date: dueDate }))
      }
    }
  }, [
    hasSupplierPaymentTerm,
    supplierPaymentTermName,
    formData.sales_condition_type,
    formData.bill_date,
    formData.posting_date,
    formData.due_date,
    paymentTerms
  ])

  // Effect to clear editing data when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDocumentIsCreditNote(false)
      setUnpaidInvoices([])
      setImportedInvoicesKey('')
      numberCacheRef.current.clear()
      clearStaticDataCache()
      staticDataLoadedRef.current = false
      loadedCompanyNameRef.current = ''
    }
  }, [isOpen, clearStaticDataCache])

  // Effect to initialize exchange rate when modal opens or currency changes
  useEffect(() => {
    const invoiceDate = formData.bill_date || formData.posting_date
    if (isOpen && formData.currency) {
      const fetchRate = async () => {
        if (exchangeRateFetchRef.current) return
        exchangeRateFetchRef.current = true
        try {
          if (!companyCurrency) {
            setExchangeRateDate(invoiceDate)
            return
          }

          if (formData.currency === companyCurrency) {
            setExchangeRate(1)
            setExchangeRateDate(invoiceDate)
            setFormData(prev => ({ ...prev, exchange_rate: 1 }))
            return
          }

          // When editing, keep the stored exchange rate (don't auto-refresh and accidentally change data)
          if (isEditing) {
            const existingRate = Number(formData.exchange_rate)
            if (Number.isFinite(existingRate) && existingRate > 0) {
              setExchangeRate(existingRate)
              setExchangeRateDate(invoiceDate)
              return
            }
          }

          setIsLoadingExchangeRate(true)
          const response = await fetchWithAuth(
            `/api/currency-exchange/latest?currency=${encodeURIComponent(formData.currency)}&to=${encodeURIComponent(companyCurrency)}`
          )
          const data = await (response?.json ? response.json().catch(() => ({})) : Promise.resolve({}))
          if (!response || !response.ok || data?.success === false) {
            throw new Error(data?.message || `Status ${response ? response.status : 'no-response'}`)
          }
          const rate = data?.data?.exchange_rate || data?.data?.rate || data?.data?.exchangeRate || data?.data?.cotizacion_ars
          if (!rate) {
            throw new Error('No se encontró cotización para la moneda seleccionada')
          }
          setExchangeRate(rate)
          setExchangeRateDate(data.data.date || invoiceDate)
          setFormData(prev => ({ ...prev, exchange_rate: rate }))
        } catch (error) {
          console.error('Error fetching exchange rate:', error)
          showNotification(error?.message || 'Error al obtener la cotización', 'error')
          setExchangeRate(null)
          setExchangeRateDate(invoiceDate)
          setFormData(prev => ({ ...prev, exchange_rate: '' }))
        } finally {
          setIsLoadingExchangeRate(false)
          exchangeRateFetchRef.current = false
        }
      }
      fetchRate()
    }
  }, [isOpen, isEditing, formData.currency, formData.exchange_rate, formData.bill_date, formData.posting_date, companyCurrency])

  // Effect to fetch fresh invoice data when editing
  useEffect(() => {
    if (isEditing && editingData && editingData.name && isOpen) {
      const fetchFreshInvoiceData = async () => {
        try {
          const response = await fetchWithAuth(`/api/purchase-invoices/${editingData.name}`)
          if (response.ok) {
            const result = await response.json()
            setFreshInvoiceData(result.data)
          } else {
            setFreshInvoiceData(editingData)
          }
        } catch (error) {
          setFreshInvoiceData(editingData)
        }
      }
      fetchFreshInvoiceData()
    } else {
      setFreshInvoiceData(null)
    }
  }, [isEditing, editingData?.name, isOpen])

  // Effect to select correct comprobante option when editing
  useEffect(() => {
    if (isEditing && comprobanteOptions.length > 0 && formData.invoice_type && (!selectedComprobanteOption || selectedComprobanteOption.descripcion !== formData.invoice_type)) {
      const matchingOption = comprobanteOptions.find(option =>
        option.descripcion === formData.invoice_type
      )

      if (matchingOption) {
        setSelectedComprobanteOption(matchingOption)
        setFormData(prev => ({
          ...prev,
          voucher_type: matchingOption.letra,
          invoice_category: matchingOption.letra,
        }))
      }
    }
  }, [comprobanteOptions, isEditing, formData.invoice_type, selectedComprobanteOption])

  // Effect to recalculate totals when items change
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item => ({
        ...item,
        amount: calculateItemAmount(item, formData.currency, formData.exchange_rate, null)
      }))
    }))
  }, [JSON.stringify(formData.items), formData.currency, formData.exchange_rate])

  return {
    numberCacheRef,
    exchangeRateFetchRef
  }
}
