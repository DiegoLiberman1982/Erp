import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { Edit, Trash2, Save, Package, Plus } from 'lucide-react'
import Select from 'react-select'
import CreatableSelect from 'react-select/creatable'
import { extractItemCodeDisplay } from './inventoryUtils'

const KitDetailsPanel = ({
  selectedKit,
  kitDetails,
  isEditingKit,
  setIsEditingKit,
  editedKitData,
  setEditedKitData,
  onSaveKit,
  onCancelEdit,
  onDeleteKit,
  inventoryItems,
  showNotification,
  savingKit,
  itemGroups = [],
  brands = [],
  createBrand = null,
  createItemGroup = null,
  companyDefaults = {}
}) => {
  const removeCompanyAbbr = (s) => {
    if (!s) return s
    if (s.includes(' - ')) return s.split(' - ').slice(0, -1).join(' - ').trim()
    return s
  }

  const handleEditKit = () => {
    if (!kitDetails) return
    setIsEditingKit(true)
    // Prepare editedKitData: include a single kit description and do not copy
    // per-component descriptions into component rows (we treat description
    // as a kit-level field only).
    // Use 'description' as the kit's name. We intentionally do not expose item_group.
    setEditedKitData({
      new_item_code: kitDetails.new_item_code,
      // parent item name (used to set Item.item_name) vs bundle description
      item_name: kitDetails.description || kitDetails.item_name || kitDetails.parent_item?.item_name || '',
      description: kitDetails.description || kitDetails.item_name || '',
      item_group: kitDetails.item_group || '',
      brand: kitDetails.parent_item?.brand || kitDetails.brand || '',
      __isNewItemGroup: false,
      // Normalize component rows by removing per-component description
      items: kitDetails.items ? kitDetails.items.map(item => ({ item_code: item.item_code || '', qty: item.qty || 1, uom: item.uom || 'Unit' })) : []
    })
  }

  const handleCancelEdit = () => {
    onCancelEdit()
  }

  const handleItemChange = (index, field, value) => {
    setEditedKitData(prev => ({
      ...prev,
      items: (prev.items || []).map((item, i) => (i === index ? { ...item, [field]: value } : item))
    }))
  }

  const handleEditChange = (field, value) => {
    setEditedKitData(prev => ({ ...prev, [field]: value }))
  }

  const addItemToKit = () => {
    // Don't add per-component description field — kit uses a single description
    setEditedKitData(prev => ({ ...prev, items: [ ...(prev.items || []), { item_code: '', qty: 1, uom: 'Unit' }] }))
  }

  const removeItemFromKit = (index) => {
    if ((editedKitData.items || []).length <= 2) {
      showNotification('Un kit debe tener al menos 2 componentes', 'error')
      return
    }
    setEditedKitData(prev => ({ ...prev, items: (prev.items || []).filter((_, i) => i !== index) }))
  }

  const getItemOptions = () => (inventoryItems || []).map(it => {
    const rawCode = it.item_code || it.name || ''
    const code = removeCompanyAbbr(rawCode)
    const name = it.item_name || it.description || ''
    return { value: code, label: `${code} - ${name}`.trim(), item: it }
  })

  // Kits no longer support categories (item_group). Keep componentStocks only.
  const [kitTab, setKitTab] = useState('general')
  const [componentStocks, setComponentStocks] = useState({})
  const [itemGroupOptions, setItemGroupOptions] = useState([])
  const [brandOptions, setBrandOptions] = useState([])
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  useEffect(() => setKitTab('general'), [selectedKit])

  useEffect(() => {
    // prepare options for selects — ensure we only pass primitive strings as labels
    const normalizeGroup = (g) => {
      if (!g && g !== 0) return ''
      if (typeof g === 'string') return g
      if (typeof g === 'object') return g.item_group_name || g.name || JSON.stringify(g)
      return String(g)
    }

    setItemGroupOptions((itemGroups || []).map(g => {
      const label = normalizeGroup(g)
      return { value: label, label }
    }))

    setBrandOptions((brands || []).map(b => {
      const name = b?.name || b?.brand || (typeof b === 'string' ? b : JSON.stringify(b))
      return { value: name, label: name }
    }))
  }, [itemGroups, brands])

  // When kit details change, fetch per-component available quantities
  useEffect(() => {
    const fetchComponentStock = async () => {
      if (!kitDetails?.items || !activeCompany) return
      try {
        const payload = {
          company: activeCompany,
          include_bins: false,
          items: kitDetails.items.map(i => ({ display_code: i.item_code }))
        }
        const res = await fetchWithAuth('/api/inventory/items/bulk-stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) return
        const data = await res.json()
        if (!data.success) return
        setComponentStocks(data.data || {})
      } catch (err) {
        console.error('Error fetching component stock:', err)
      }
    }

    fetchComponentStock()
  }, [kitDetails, activeCompany, fetchWithAuth])

  // Compute a suggested brand from selected components (when editing)
  const computeSuggestedBrand = () => {
    try {
      if (!editedKitData?.items || (editedKitData.items || []).length === 0) return ''
      const brandsSet = new Set()
      for (const it of editedKitData.items) {
        const code = (it.item_code || '').toString().trim()
        if (!code) continue
        // match against inventoryItems (we store display code as value)
        const match = (inventoryItems || []).find(inv => {
          const raw = inv.item_code || inv.name || ''
          const display = raw.includes(' - ') ? raw.split(' - ').slice(0, -1).join(' - ').trim() : raw
          return display === code || raw === code
        })
        if (match && (match.brand || match.brand === '')) brandsSet.add(match.brand)
      }
      const list = Array.from(brandsSet).filter(Boolean)
      if (list.length === 1) return list[0]
      if (list.length > 1) return list.sort().join(' + ')
      return ''
    } catch (e) {
      return ''
    }
  }

  const suggestedBrand = isEditingKit ? computeSuggestedBrand() : ''

  if (!selectedKit) {
    return (
      <div className="kit-details-card">
        <div className="accounting-card-title bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-200 rounded-lg"><Package className="w-5 h-5 text-gray-600" /></div>
            <div>
              <h3 className="text-lg font-black text-gray-900">Detalles del Kit</h3>
              <p className="text-sm text-gray-600 font-medium">Selecciona un kit para ver sus detalles</p>
            </div>
          </div>
        </div>
        <div className="p-8 text-center">
          <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">Selecciona un kit de la lista para ver sus componentes</p>
        </div>
      </div>
    )
  }

  return (
    <div className="kit-details-card">
      <div className="accounting-card-title bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-200 rounded-lg"><Package className="w-5 h-5 text-gray-600" /></div>
              <div>
                <h3 className="text-lg font-black text-gray-900">{isEditingKit && selectedKit === 'new' ? 'Nuevo Kit' : selectedKit ? `Kit: ${extractItemCodeDisplay(kitDetails?.new_item_code || selectedKit)}` : 'Detalles del Kit'}</h3>
                {selectedKit && kitDetails && (<p className="text-sm text-gray-600 font-medium">{kitDetails.description || kitDetails.item_name || kitDetails.parent_item?.item_name}</p>)}
              </div>
          </div>

          {selectedKit && selectedKit !== 'new' && (
            <div className="flex gap-2">
                {!isEditingKit ? (
                <>
                  <button className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300" title="Editar kit" onClick={handleEditKit}><Edit className="w-4 h-4" /></button>
                  {typeof onDeleteKit === 'function' ? (
                    <button onClick={() => onDeleteKit(selectedKit)} title="Eliminar kit" className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-xl transition-all duration-300"><Trash2 className="w-4 h-4" /></button>
                  ) : null}
                </>
              ) : (
                <div className="flex gap-2">
                  <button onClick={handleCancelEdit} disabled={savingKit} className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300">Cancelar</button>
                  <button onClick={() => onSaveKit(editedKitData)} disabled={savingKit} className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none">
                    {savingKit ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>Guardando...</>) : (<><Save className="w-4 h-4 mr-2" />Guardar Cambios</>)}
                  </button>
                </div>
              )}
            </div>
          )}

          {selectedKit === 'new' && (
            <div className="flex gap-2">
              <button onClick={handleCancelEdit} disabled={savingKit} className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300">Cancelar</button>
              <button onClick={() => onSaveKit(editedKitData)} disabled={savingKit} className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none">
                {savingKit ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>Creando...</>) : (<><Save className="w-4 h-4 mr-2" />Crear Kit</>)}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-gray-50 relative" style={{ zIndex: 50 }}>
        <nav className="tab-nav mb-6">
          <button onClick={() => setKitTab('general')} className={`tab-button ${kitTab === 'general' ? 'active' : ''}`}>General</button>
          <button onClick={() => setKitTab('componentes')} className={`tab-button ${kitTab === 'componentes' ? 'active' : ''}`}>Componentes</button>
        </nav>

        {isEditingKit ? (
          <div className="space-y-6">
            {kitTab === 'general' && (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Código del Kit *</label>
                      <input type="text" value={editedKitData.new_item_code || ''} onChange={(e) => handleEditChange('new_item_code', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="KIT-001" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Grupo de producto</label>
                        <CreatableSelect
                          value={editedKitData.item_group ? { value: editedKitData.item_group, label: editedKitData.item_group } : null}
                          onChange={(option) => {
                            if (!option) return handleEditChange('item_group', '')
                            if (option.__isNew__) {
                              handleEditChange('__isNewItemGroup', true)
                              handleEditChange('item_group', option.value)
                            } else {
                              handleEditChange('__isNewItemGroup', false)
                              handleEditChange('item_group', option.value)
                            }
                          }}
                          options={itemGroupOptions}
                          classNamePrefix="react-select"
                          placeholder="Seleccionar o crear grupo"
                          menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                          styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Marca sugerida</label>
                        <CreatableSelect
                          value={editedKitData.brand ? { value: editedKitData.brand, label: editedKitData.brand } : (suggestedBrand ? { value: suggestedBrand, label: suggestedBrand } : null)}
                          onChange={async (opt) => {
                            if (!opt) return handleEditChange('brand', '')
                            if (opt.__isNew__ && typeof createBrand === 'function') {
                              const newB = await createBrand(opt.value)
                              if (newB) handleEditChange('brand', newB.name || newB.brand || opt.value)
                              else handleEditChange('brand', opt.value)
                            } else {
                              handleEditChange('brand', opt.value)
                            }
                          }}
                          options={brandOptions}
                          isClearable
                          classNamePrefix="react-select"
                          placeholder={suggestedBrand ? `Sugerida: ${suggestedBrand}` : 'Seleccionar marca'}
                          menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                          styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
                        />
                      </div>
                      {selectedKit !== 'new' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Tasa IVA (heredada de componentes)</label>
                          <div className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700">
                            {(() => {
                              const taxes = kitDetails?.parent_item?.taxes || []
                              if (taxes.length === 0) return 'Sin IVA'
                              // Extract rate from template name, e.g., "IVA 21 Ventas - ANC" -> 21
                              const template = taxes[0]?.item_tax_template || ''
                              const match = template.match(/IVA (\d+)/)
                              return match ? `${match[1]}%` : template
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Descripción del Kit *</label>
                      <input type="text" value={editedKitData.description || ''} onChange={(e) => handleEditChange('description', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Descripción del Kit (visible en lista)" />
                    </div>
                  </div>
                  {/* Categories removed for kits to simplify model */}
                </div>
              </div>
            )}

            {kitTab === 'componentes' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-semibold text-gray-900">Componentes del Kit</h4>
                  <button onClick={addItemToKit} className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300"><Plus className="w-4 h-4 mr-2" />Agregar Componente</button>
                </div>

                <div className="space-y-3">
                  {editedKitData.items?.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="flex-1">
                        <Select value={getItemOptions().find(opt => { const normalize = (s) => (s || '').toString().trim(); const itemCode = normalize(item.item_code); return normalize(opt.value) === normalize(itemCode) || normalize(opt.value) === normalize(itemCode.split(' - ')[0]) }) || null} onChange={(selected) => handleItemChange(index, 'item_code', selected?.value || '')} options={getItemOptions()} placeholder="Item *" className="text-sm" classNamePrefix="react-select" menuPortalTarget={typeof document !== 'undefined' ? document.body : null} menuPosition="fixed" styles={{ control: (base) => ({ ...base, minHeight: '34px', height: '34px' }), valueContainer: (base) => ({ ...base, padding: '0 6px' }), indicatorsContainer: (base) => ({ ...base, height: '34px' }), menuPortal: (base) => ({ ...base, zIndex: 99999 }) }} />
                      </div>

                      <div className="w-20">
                        <input type="number" min="0.01" step="0.01" value={item.qty || ''} onChange={(e) => handleItemChange(index, 'qty', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Qty" title="Cantidad" />
                      </div>

                      <div className="w-20">
                        <input type="text" value={item.uom || 'Unit'} onChange={(e) => handleItemChange(index, 'uom', e.target.value)} className="w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="UOM" title="Unidad" />
                      </div>


                      {editedKitData.items.length > 2 && (
                        <button onClick={() => removeItemFromKit(index)} className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded transition-colors" title="Eliminar componente"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : kitDetails ? (
          <div className="space-y-6">
            {kitTab === 'general' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                  <span className="text-sm font-semibold text-gray-600">Código:</span>
                  <div className="text-gray-900 font-medium ml-2 mt-1">{extractItemCodeDisplay(kitDetails.new_item_code)}</div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 md:col-span-1">
                  <div>
                    <span className="text-sm font-semibold text-gray-600">Descripción del Kit:</span>
                    <div className="text-gray-900 font-medium ml-2 mt-1 truncate">{kitDetails.description || kitDetails.item_name || ''}</div>
                  </div>
                </div>
                {/* Removed 'Disponibles' summary per request — availability is shown elsewhere */}
              </div>
            )}

            {kitTab === 'componentes' && (
              <div>
                <div className="space-y-3">
                  {kitDetails.items?.map((item, index) => {
                    const searchCode = removeCompanyAbbr(item.item_code)
                    const invRaw = (inventoryItems || []).find(inv => {
                      const base = inv.item || inv
                      const raw = base.item_code || base.value || base.name || ''
                      return removeCompanyAbbr(raw) === searchCode
                    })
                    const itemInfo = invRaw ? (invRaw.item || invRaw) : null
                    return (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                          <span className="text-sm font-semibold text-gray-600">Código</span>
                          <div className="text-sm text-gray-900 font-medium mt-1 truncate">{item.item_code}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                          <span className="text-sm font-semibold text-gray-600">Descripción</span>
                          <div className="text-sm text-gray-900 font-medium mt-1 truncate">{kitDetails.description || kitDetails.item_name || ''}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                          <span className="text-sm font-semibold text-gray-600">Cantidad</span>
                          <div className="text-sm text-gray-900 font-medium mt-1">{item.qty}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                          <span className="text-sm font-semibold text-gray-600">UOM</span>
                          <div className="text-sm text-gray-900 font-medium mt-1">{item.uom}</div>
                        </div>
                        {/* 'Disponible' per-component removed — availability shown elsewhere */}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">Cargando detalles del kit...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default KitDetailsPanel