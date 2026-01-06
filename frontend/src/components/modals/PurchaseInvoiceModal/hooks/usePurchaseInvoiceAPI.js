import { useState, useCallback } from 'react'

export const usePurchaseInvoiceAPI = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const createPurchaseInvoice = useCallback(async (formData) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/purchase-invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`)
      }

      const result = await response.json()
      return result
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const updatePurchaseInvoice = useCallback(async (id, formData) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/purchase-invoices/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`)
      }

      const result = await response.json()
      return result
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const deletePurchaseInvoice = useCallback(async (id) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/purchase-invoices/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`)
      }

      return true
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const getPurchaseInvoice = useCallback(async (id) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/purchase-invoices/${id}`)

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`)
      }

      const result = await response.json()
      return result
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    createPurchaseInvoice,
    updatePurchaseInvoice,
    deletePurchaseInvoice,
    getPurchaseInvoice,
  }
}