// --- HOOK DE EFECTOS PARA EL MODAL DE REMITOS DE VENTA ---
import { useEffect, useRef } from 'react'
import { fetchWarehouses } from '../../../apiUtils.js'

const useSalesRemitoEffects = ({
  formData,
  setFormData,
  activeCompany,
  fetchWithAuth,
  setAvailableWarehouses,
  setAvailableTalonarios,
  setCustomerDetails,
  setIsLoading,
  customerDetails: propCustomerDetails,
  isOpen,
  isEditing,
  initialRemitoData
}) => {
  const variantMapRef = useRef(new Map())
  const availableWarehousesRef = useRef([])

  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        console.log('--- SalesRemitoModal: loading warehouses')
        const warehouseData = await fetchWarehouses(fetchWithAuth, activeCompany)
        const filteredWarehouses = warehouseData.flat.filter(warehouse => !warehouse.is_consignment_variant)
        setAvailableWarehouses(filteredWarehouses)
        availableWarehousesRef.current = filteredWarehouses

        const norm = (s) => (s || '').toString().trim().toUpperCase()
        const removeAbbr = (s) => {
          if (!s) return s
          if (s.includes(' - ')) return s.split(' - ').slice(0, -1).join(' - ').trim()
          return s
        }
        const variantToBase = new Map()

        try {
          const grouped = warehouseData.grouped || []
          grouped.forEach(group => {
            const base = group.ownWarehouse || null
            if (!base) return
            const addVariant = (variant) => {
              if (!variant) return
              variantToBase.set(norm(variant.name), base)
              variantToBase.set(norm(variant.warehouse_name || variant.display_name || ''), base)
              variantToBase.set(norm(removeAbbr(variant.name)), base)
              variantToBase.set(norm(removeAbbr(variant.warehouse_name || variant.display_name || '')), base)
            }
            ;(group.consignationWarehouses || []).forEach(addVariant)
            ;(group.vendorConsignationWarehouses || []).forEach(addVariant)
          })
        } catch (error) {
          console.error('--- SalesRemitoModal: error building warehouse map', error)
        }

        variantMapRef.current = variantToBase

        if (isEditing && initialRemitoData?.items) {
          try {
            const formattedItems = initialRemitoData.items.map(item => {
              const rawWarehouse = item.warehouse || ''
              let warehouseValue = rawWarehouse
              let propiedad = item.propiedad || 'Propio'
              const map = variantMapRef.current || new Map()
              const cleanedWarehouse = norm(rawWarehouse)
              const withoutAbbr = norm(removeAbbr(rawWarehouse))
              let candidate = map.get(cleanedWarehouse) || map.get(withoutAbbr)

              if (!candidate) {
                const candidates = availableWarehousesRef.current || []
                const basicClean = (value) => (value || '').toString().replace(/\[.*?\]/g, '').replace(/__.*$/, '').trim().toUpperCase()
                const rawClean = basicClean(rawWarehouse)
                candidate = candidates.find(
                  itemCandidate =>
                    basicClean(itemCandidate.name) === rawClean ||
                    basicClean(itemCandidate.warehouse_name || itemCandidate.display_name) === rawClean
                )
              }

              if (candidate) {
                warehouseValue = candidate.name || warehouseValue
                if (candidate.has_consignment) propiedad = 'Consignación'
              }

              return {
                item_code: item.item_code || '',
                description: item.description || '',
                qty: item.qty || 1,
                uom: item.uom || 'Unit',
                propiedad,
                warehouse: warehouseValue
              }
            })
            setFormData(prev => ({ ...prev, items: formattedItems }))
          } catch (error) {
            console.error('--- SalesRemitoModal: error normalizing initial items', error)
          }
        }
      } catch (error) {
        console.error('Error fetching warehouses:', error)
        setAvailableWarehouses([])
      }
    }

    if (activeCompany && isOpen) {
      loadWarehouses()
    }
  }, [activeCompany, fetchWithAuth, isOpen, isEditing, initialRemitoData, setAvailableWarehouses, setFormData])

  useEffect(() => {
    const fetchTalonarios = async () => {
      try {
        const response = await fetchWithAuth(`/api/talonarios?compania=${encodeURIComponent(activeCompany)}&activos=1`)
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setAvailableTalonarios(data.data || [])
          }
        }
      } catch (error) {
        console.error('Error fetching talonarios:', error)
      }
    }

    if (activeCompany && isOpen) {
      fetchTalonarios()
    }
  }, [activeCompany, fetchWithAuth, isOpen, setAvailableTalonarios])

  useEffect(() => {
    const fetchCustomerDetails = async () => {
      if (propCustomerDetails) {
        setCustomerDetails(propCustomerDetails)
        return
      }

      if (!formData.customer) {
        setCustomerDetails(null)
        return
      }

      try {
        setIsLoading(true)
        const response = await fetchWithAuth(`/api/resource/Customer/${encodeURIComponent(formData.customer)}`)
        if (response.ok) {
          const data = await response.json()
          if (data.data) {
            setCustomerDetails(data.data)
          }
        }
      } catch (error) {
        console.error('Error fetching customer details:', error)
        setCustomerDetails(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchCustomerDetails()
  }, [formData.customer, fetchWithAuth, propCustomerDetails, setCustomerDetails, setIsLoading])

  useEffect(() => {
    if (!isEditing && !formData.posting_date) {
      const today = new Date().toISOString().split('T')[0]
      setFormData(prev => ({
        ...prev,
        posting_date: today
      }))
    }
  }, [formData.posting_date, isEditing, setFormData])

  useEffect(() => {
    if (isEditing && initialRemitoData?.items) {
      const formattedItems = initialRemitoData.items.map(item => {
        const rawWarehouse = item.warehouse || ''
        let warehouseValue = rawWarehouse
        let propiedad = item.propiedad || 'Propio'

        try {
          const norm = (s) => (s || '').toString().trim().toUpperCase()
          const withoutAbbr = (s) => {
            if (!s) return s
            if (s.includes(' - ')) return s.split(' - ').slice(0, -1).join(' - ').trim()
            return s
          }

          const vmap = variantMapRef.current || new Map()
          let candidate = vmap.get(norm(rawWarehouse)) || vmap.get(norm(withoutAbbr(rawWarehouse)))
          if (!candidate) {
            const candidates = availableWarehousesRef.current || []
            const cleaned = (s) => (s || '').toString().replace(/\[.*?\]/g, '').replace(/__.*$/, '').trim()
            const rawClean = norm(cleaned(rawWarehouse))
            candidate = candidates.find(candidateWarehouse => {
              const an = norm(candidateWarehouse.name)
              const awn = norm(candidateWarehouse.warehouse_name || candidateWarehouse.display_name || '')
              return an === rawClean || awn === rawClean || rawClean.includes(an) || rawClean.includes(awn)
            })
          }
          if (candidate) {
            warehouseValue = candidate.name || warehouseValue
            if (candidate.has_consignment) propiedad = 'Consignación'
          }
        } catch (error) {
          console.error('--- SalesRemitoModal: error normalizing item warehouse', error)
        }

        return {
          item_code: item.item_code || '',
          description: item.description || '',
          qty: item.qty || 1,
          uom: item.uom || 'Unit',
          propiedad,
          warehouse: warehouseValue
        }
      })

      setFormData(prev => ({
        ...prev,
        items: formattedItems
      }))
    }
  }, [isEditing, initialRemitoData, setFormData])
}

export default useSalesRemitoEffects
