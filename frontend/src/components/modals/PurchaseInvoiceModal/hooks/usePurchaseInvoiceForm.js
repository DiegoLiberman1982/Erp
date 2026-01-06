import { useState, useEffect, useCallback } from 'react'

export const usePurchaseInvoiceForm = (initialData = {}) => {
  const [formData, setFormData] = useState({
    supplier: '',
    supplier_name: '',
    bill_date: new Date().toISOString().split('T')[0],
    posting_date: new Date().toISOString().split('T')[0],
    due_date: '',
    currency: '',
    exchange_rate: 1,
    items: [],
    taxes: [],
    perceptions: [], // Nuevo modelo unificado de percepciones
    payment_terms: '',
    sales_condition: '',
    observations: '',
    total: 0,
    total_tax: 0,
    grand_total: 0,
    ...initialData
  })

  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const updateFormData = useCallback((updates) => {
    setFormData(prev => ({ ...prev, ...updates }))
  }, [])

  const validateForm = useCallback(() => {
    const newErrors = {}

    if (!formData.supplier) {
      newErrors.supplier = 'El proveedor es obligatorio'
    }

    if (!formData.posting_date) {
      newErrors.posting_date = 'La fecha de contabilización es obligatoria'
    }

    if (formData.items.length === 0) {
      newErrors.items = 'Debe agregar al menos un artículo'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData])

  const resetForm = useCallback(() => {
    setFormData({
      supplier: '',
      supplier_name: '',
      bill_date: new Date().toISOString().split('T')[0],
      posting_date: new Date().toISOString().split('T')[0],
      due_date: '',
      currency: '',
      exchange_rate: 1,
      items: [],
      taxes: [],
      perceptions: [], // Nuevo modelo unificado de percepciones
      payment_terms: '',
      sales_condition: '',
      observations: '',
      total: 0,
      total_tax: 0,
      grand_total: 0
    })
    setErrors({})
  }, [])

  return {
    formData,
    setFormData: updateFormData,
    errors,
    setErrors,
    loading,
    setLoading,
    validateForm,
    resetForm
  }
}
