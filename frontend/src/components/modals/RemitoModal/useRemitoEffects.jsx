// --- HOOK PARA MANEJAR EFECTOS SECUNDARIOS DEL MODAL DE REMITOS ---
import { useEffect, useState, useRef } from 'react'
import { fetchWarehouses } from '../../../apiUtils.js'
import { addCompanyAbbrToSupplier } from '../../Supplierpanel/supplierHandlers'

const useRemitoEffects = ({
  formData,
  setFormData,
  activeCompany,
  fetchWithAuth,
  setAvailableWarehouses,
  setAvailableTalonarios,
  setSupplierDetails,
  setIsLoading,
  supplierDetails: propSupplierDetails,
  isOpen,
  // Nuevos parámetros para edición
  isEditing,
  initialRemitoData
}) => {

  // Cargar almacenes disponibles
  // ref to store variant->base map
  const variantMapRef = useRef(new Map())
  // ref to store available (filtered) warehouses so other effects can read them synchronously
  const availableWarehousesRef = useRef([])
  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        console.log('--- RemitoModal: loading warehouses using grouped API')
        const warehouseData = await fetchWarehouses(fetchWithAuth, activeCompany)
        console.log('--- RemitoModal: warehouses loaded', warehouseData.flat.length, 'warehouses')
        
        // Filtrar variantes CON/VCON para que no aparezcan como opciones separadas
        const filteredWarehouses = warehouseData.flat.filter(warehouse => !warehouse.is_consignment_variant)
        console.log('--- RemitoModal: filtered warehouses', filteredWarehouses.length, 'warehouses (variants excluded)')

        // Build variant -> base map so we can resolve tokenized variant names to a base
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
            const addVariant = (v) => {
              if (!v) return
              try {
                variantToBase.set(norm(v.name), base)
                variantToBase.set(norm(v.warehouse_name || v.display_name || ''), base)
                variantToBase.set(norm(removeAbbr(v.name)), base)
                variantToBase.set(norm(removeAbbr(v.warehouse_name || v.display_name || '')), base)
              } catch (e) {}
            }
            ;(group.consignationWarehouses || []).forEach(addVariant)
            ;(group.vendorConsignationWarehouses || []).forEach(addVariant)
          })
        } catch (e) {
          console.error('--- RemitoModal: error building variant map', e)
        }

        // Keep map in ref for use by other effects
        variantMapRef.current = variantToBase

  setAvailableWarehouses(filteredWarehouses)
  // keep a ref copy for immediate lookup in other effects
  try { availableWarehousesRef.current = filteredWarehouses } catch (e) {}
        try {
          console.log('--- RemitoModal: setAvailableWarehouses ->', (filteredWarehouses && Array.isArray(filteredWarehouses)) ? filteredWarehouses.map(w => ({ name: w.name, warehouse_name: w.warehouse_name, has_consignment: !!w.has_consignment })) : 'filteredWarehouses no es un array')
        } catch (e) {}

        // If we already have initialRemitoData (editing and opened), normalize its items now that we have the variant map
        if (isEditing && initialRemitoData && initialRemitoData.items) {
          try {
            const formattedItems = initialRemitoData.items.map(item => {
              const rawWarehouse = item.warehouse || ''
              let warehouseValue = rawWarehouse
              let propiedad = item.propiedad || 'Propio'

              const norm = (s) => (s || '').toString().trim().toUpperCase()
              const withoutAbbr = (s) => {
                if (!s) return s
                if (s.includes(' - ')) return s.split(' - ').slice(0, -1).join(' - ').trim()
                return s
              }

              const vmap = variantMapRef.current || new Map()
              let candidate = vmap.get(norm(rawWarehouse)) || vmap.get(norm(withoutAbbr(rawWarehouse)))
              // if vmap didn't match, try matching against availableWarehouses (by name, warehouse_name or loose prefix)
              if (!candidate) {
                try {
                  const candidates = availableWarehousesRef.current || []
                  const cleaned = (s) => (s || '').toString().replace(/\[.*?\]/g, '').replace(/__.*$/, '').trim()
                  const rawClean = norm(cleaned(rawWarehouse))
                  for (const aw of candidates) {
                    try {
                      const an = norm(aw.name)
                      const awn = norm(aw.warehouse_name || aw.display_name || '')
                      const aSimple = norm(cleaned(aw.name))
                      if (an === rawClean || awn === rawClean || aSimple === rawClean) {
                        candidate = aw
                        break
                      }
                      // contains / prefix matching
                      if (rawClean && (an.includes(rawClean) || rawClean.includes(an) || awn.includes(rawClean) || rawClean.includes(awn))) {
                        candidate = aw
                        break
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
              }
              if (candidate) {
                warehouseValue = candidate.name || warehouseValue
                // Detect CON/VCON from the raw warehouse name (ERPNext variant naming)
                const rawUpper = norm(rawWarehouse)
                if (rawUpper.includes('__VCON[')) {
                  propiedad = 'Mercadería en local del proveedor'
                } else if (rawUpper.includes('__CON[')) {
                  propiedad = 'Consignación'
                } else if (candidate.has_consignment && !item.propiedad) {
                  propiedad = 'Consignación'
                }
              }

              return {
                item_code: item.item_code || '',
                item_name: item.item_name || item.item_code || '',
                description: item.description || '',
                // Mostrar cantidades siempre positivas en la UI aunque ERP las guarde negativas para devoluciones
                qty: Math.abs(item.qty || 0) || 0,
                uom: item.uom || 'Unit',
                propiedad: propiedad,
                warehouse: warehouseValue
              }
            })
            console.log('--- RemitoModal: normalized initial items after warehouses load ->', formattedItems.map(it => ({ raw: it.item_code, warehouse: it.warehouse, propiedad: it.propiedad })))
            setFormData(prev => ({ ...prev, items: formattedItems }))
          } catch (e) {
            console.error('--- RemitoModal: error normalizing initial items after warehouses load', e)
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
  }, [activeCompany, fetchWithAuth, setAvailableWarehouses, isOpen])

  // Cargar talonarios disponibles
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
  }, [activeCompany, fetchWithAuth, setAvailableTalonarios, isOpen])

  // Cargar detalles del proveedor cuando cambia
  useEffect(() => {
    const fetchSupplierDetails = async () => {
      if (propSupplierDetails) {
        // Si los detalles del supplier vienen como prop, úsalos directamente
        setSupplierDetails(propSupplierDetails)
        return
      }

      if (!formData.supplier) {
        setSupplierDetails(null)
        return
      }

      try {
        setIsLoading(true)
        // Agregar abreviatura de compañía al nombre del proveedor
        const supplierNameWithAbbr = await addCompanyAbbrToSupplier(formData.supplier, fetchWithAuth)
        const response = await fetchWithAuth(`/api/resource/Supplier/${encodeURIComponent(supplierNameWithAbbr)}`)
        if (response.ok) {
          const data = await response.json()
          if (data.data) {
            setSupplierDetails(data.data)
          }
        }
      } catch (error) {
        console.error('Error fetching supplier details:', error)
        setSupplierDetails(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSupplierDetails()
  }, [formData.supplier, fetchWithAuth, setSupplierDetails, setIsLoading, propSupplierDetails])

  // Set default posting_date to today (solo en modo creación)
  useEffect(() => {
    if (!isEditing && !formData.posting_date) {
      const today = new Date('2024-11-02').toISOString().split('T')[0]
      setFormData(prev => ({
        ...prev,
        posting_date: today
      }))
    }
  }, [formData.posting_date, setFormData, isEditing])

  // Inyectar items formateados cuando initialRemitoData cambie (modo edición)
  useEffect(() => {
    if (isEditing && initialRemitoData && initialRemitoData.items) {
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
            try {
              const candidates = availableWarehousesRef.current || []
              const cleaned = (s) => (s || '').toString().replace(/\[.*?\]/g, '').replace(/__.*$/, '').trim()
              const rawClean = norm(cleaned(rawWarehouse))
              for (const aw of candidates) {
                try {
                  const an = norm(aw.name)
                  const awn = norm(aw.warehouse_name || aw.display_name || '')
                  const aSimple = norm(cleaned(aw.name))
                  if (an === rawClean || awn === rawClean || aSimple === rawClean) {
                    candidate = aw
                    break
                  }
                  if (rawClean && (an.includes(rawClean) || rawClean.includes(an) || awn.includes(rawClean) || rawClean.includes(awn))) {
                    candidate = aw
                    break
                  }
                } catch (e) {}
              }
            } catch (e) {}
          }
          if (candidate) {
            // use base warehouse name so it matches availableWarehouses options
            warehouseValue = candidate.name || warehouseValue
            // Detect CON/VCON from the raw warehouse name (ERPNext variant naming)
            const rawUpper = norm(rawWarehouse)
            if (rawUpper.includes('__VCON[')) {
              propiedad = 'Mercadería en local del proveedor'
            } else if (rawUpper.includes('__CON[')) {
              propiedad = 'Consignación'
            } else if (candidate.has_consignment && !item.propiedad) {
              propiedad = 'Consignación'
            }
          }
        } catch (e) {
          console.error('--- RemitoModal: error normalizing initial item warehouse', e)
        }

        return {
          item_code: item.item_code || '',
          item_name: item.item_name || item.item_code || '',
          description: item.description || '',
          // Mostrar cantidades siempre positivas en la UI aunque ERP las guarde negativas para devoluciones
          qty: Math.abs(item.qty || 0) || 0,
          uom: item.uom || 'Unit',
          propiedad: propiedad,
          warehouse: warehouseValue
        }
      })

      try {
        console.log('--- RemitoModal: normalized initial items (effect) ->', formattedItems.map(it => ({ code: it.item_code, warehouse: it.warehouse, propiedad: it.propiedad })))
      } catch (e) {}

      setFormData(prev => ({
        ...prev,
        items: formattedItems
      }))
    }
  }, [isEditing, initialRemitoData, setFormData])

}

export default useRemitoEffects
