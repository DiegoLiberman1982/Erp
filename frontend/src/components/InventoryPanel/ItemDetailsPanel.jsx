import React, { useMemo } from 'react'
import { Edit, Trash2, Save, FileText, Package, Plus, Lock, Unlock } from 'lucide-react'
import Select from 'react-select'
import CreatableSelect from 'react-select/creatable'
import { extractItemCodeDisplay, extractItemGroupName, getPlatformStyle } from './inventoryUtils'

const ItemDetailsPanel = ({
  selectedItem,
  itemDetails,
  isEditingItem,
  itemTab,
  editedItemData,
  savingItem,
  uoms,
  itemGroups,
  warehouses,
  brands,
  availableExpenseAccounts,
  availableIncomeAccounts,
  availableAssetAccounts,
  activeCompany,
  extractAccountName,
  handleEditItem,
  handleDeleteItem,
  handleCancelEdit,
  handleSaveItem,
  handleCreateItem,
  setItemTab,
  handleEditChange,
  setIsUomModalOpen,
  createItemGroup,
  createBrand,
  handleUomAdded,
  taxSales = [],
  taxPurchase = [],
  rateToTemplateMap = {}
}) => {
  // Compute available IVA rate options from rateToTemplateMap
  const ivaOptions = useMemo(() => {
    const flat = (rateToTemplateMap && rateToTemplateMap.flat) || {}
    const keys = Object.keys(flat).map(k => parseFloat(k)).filter(n => !isNaN(n))
    keys.sort((a, b) => a - b)
    return keys.map(k => ({ value: String(k), label: `${k}%` }))
  }, [rateToTemplateMap])

  // Helper to get current IVA rate from item taxes
  const getCurrentIvaRate = () => {
    // Try to infer from item taxes
    const taxes = itemDetails?.taxes || []
    if (taxes.length === 0) return null
    const salesMap = (rateToTemplateMap && rateToTemplateMap.sales) || {}
    const purchaseMap = (rateToTemplateMap && rateToTemplateMap.purchase) || {}
    for (const tax of taxes) {
      const templateName = tax.item_tax_template
      // Find rate key from maps
      for (const [rate, name] of Object.entries(salesMap)) {
        if (name === templateName) return rate
      }
      for (const [rate, name] of Object.entries(purchaseMap)) {
        if (name === templateName) return rate
      }
    }
    return null
  }

  return (
    <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-visible min-w-0">
      <div className="accounting-card-title bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-200 rounded-lg">
              <FileText className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900">
                {isEditingItem && selectedItem === 'new' ? 'Nuevo Item' :
                 selectedItem ? `Item: ${itemDetails?.item_name || selectedItem}` : 'Selecciona un item'}
              </h3>
              {selectedItem && itemDetails && (
                <p className="text-sm text-gray-600 font-medium">
                  {itemDetails.item_group && `Grupo: ${itemDetails.item_group}`}
                </p>
              )}
            </div>
          </div>
          {selectedItem && selectedItem !== 'new' && (
            <div className="flex gap-2">
              {!isEditingItem ? (
                <>
                  <button
                    className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                    title="Editar item"
                    onClick={handleEditItem}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                    title="Eliminar item"
                    onClick={handleDeleteItem}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelEdit}
                    disabled={savingItem}
                    className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveItem}
                    disabled={savingItem}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                  >
                    {savingItem ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Guardar Cambios
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
          {selectedItem === 'new' && (
            <div className="flex gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={savingItem}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateItem}
                disabled={savingItem}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
              >
                {savingItem ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Creando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Crear Item
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-gray-50 relative" style={{ zIndex: 50 }}>
        {isEditingItem ? (
          <>
            {/* Pestañas para edición */}
            <nav className="tab-nav mb-6">
              <button
                onClick={() => setItemTab('general')}
                className={`tab-button ${itemTab === 'general' ? 'active' : ''}`}
              >
                General
              </button>
              <button
                onClick={() => setItemTab('sales_purchase')}
                className={`tab-button ${itemTab === 'sales_purchase' ? 'active' : ''}`}
              >
                Ventas y Compras
              </button>
              <button
                onClick={() => setItemTab('inventory')}
                className={`tab-button ${itemTab === 'inventory' ? 'active' : ''}`}
              >
                Inventario
              </button>
              <button
                onClick={() => setItemTab('accounting')}
                className={`tab-button ${itemTab === 'accounting' ? 'active' : ''}`}
              >
                Cuentas Contables
              </button>
              <button
                onClick={() => setItemTab('description')}
                className={`tab-button ${itemTab === 'description' ? 'active' : ''}`}
              >
                Descripción
              </button>
              <button
                onClick={() => setItemTab('links')}
                className={`tab-button ${itemTab === 'links' ? 'active' : ''}`}
              >
                Enlaces
              </button>
            </nav>

            {/* Contenido de las pestañas de edición */}
            {itemTab === 'general' && (
              <div className="space-y-6">
                {/* Primera fila: Código, Tipo, UOM */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Código *</label>
                    <input
                      type="text"
                      value={editedItemData.item_code || ''}
                      onChange={(e) => handleEditChange('item_code', e.target.value)}
                      placeholder="Código"
                      disabled={selectedItem !== 'new'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-5">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de item</label>
                    <div className="flex gap-6 items-center h-[42px]">
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="radio"
                          checked={editedItemData.is_stock_item === 1}
                          onChange={() => handleEditChange('is_stock_item', 1)}
                          className="form-radio h-4 w-4 text-blue-600"
                        />
                        <span className="ml-2 text-gray-700">Producto (con stock)</span>
                      </label>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="radio"
                          checked={editedItemData.is_stock_item === 0}
                          onChange={() => handleEditChange('is_stock_item', 0)}
                          className="form-radio h-4 w-4 text-blue-600"
                        />
                        <span className="ml-2 text-gray-700">Servicio (sin stock)</span>
                      </label>
                    </div>
                  </div>
                  <div className="col-span-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Unidad de medida</label>
                    <div className="flex gap-2">
                      <select
                        value={editedItemData.stock_uom || 'Unit'}
                        onChange={(e) => handleEditChange('stock_uom', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {uoms.map(uom => (
                          <option key={uom.name} value={uom.name}>
                            {uom.uom_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsUomModalOpen(true)}
                        className="px-3 py-2 bg-gray-100 text-black border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors duration-200"
                        title="Agregar nueva unidad de medida"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
                  <input
                    type="text"
                    value={editedItemData.item_name || ''}
                    onChange={(e) => handleEditChange('item_name', e.target.value)}
                    placeholder="Nombre del item"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Grupo de item</label>
                    <CreatableSelect
                      value={(() => {
                        const selectedGroup = itemGroups.find(group => group.item_group_name === editedItemData.item_group)
                        return selectedGroup ? { value: selectedGroup.item_group_name, label: extractItemGroupName(selectedGroup) } : null
                      })()}
                      onChange={async (selectedOption, actionMeta) => {
                        if (actionMeta.action === 'create-option') {
                          // Crear nuevo grupo
                          const newGroup = await createItemGroup(selectedOption.label)
                          if (newGroup) {
                            handleEditChange('item_group', newGroup.item_group_name)
                          }
                        } else {
                          handleEditChange('item_group', selectedOption ? selectedOption.value : '')
                        }
                      }}
                      options={itemGroups.map((group) => ({
                        value: group.item_group_name,
                        label: extractItemGroupName(group)
                      }))}
                      placeholder="Seleccionar grupo..."
                      isClearable
                      isSearchable
                      formatCreateLabel={(inputValue) => `Crear "${inputValue}"`}
                      className="w-full"
                      classNamePrefix="react-select"
                      styles={{
                        control: (provided, state) => ({
                          ...provided,
                          border: '1px solid #d1d5db',
                          borderRadius: '0.5rem',
                          padding: '0.125rem',
                          '&:hover': {
                            borderColor: '#3b82f6'
                          },
                          boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                        }),
                        option: (provided, state) => ({
                          ...provided,
                          backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                          color: state.isSelected ? 'white' : '#374151'
                        }),
                        menu: (provided) => ({
                          ...provided,
                          zIndex: 99999
                        }),
                        menuPortal: (provided) => ({
                          ...provided,
                          zIndex: 99999
                        })
                      }}
                      menuPortalTarget={document.body}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Almacén por defecto</label>
                    <Select
                      value={warehouses && Array.isArray(warehouses) && warehouses.find(wh => wh.name === editedItemData.default_warehouse) ?
                        { value: editedItemData.default_warehouse, label: warehouses.find(wh => wh.name === editedItemData.default_warehouse).warehouse_name } : null}
                      onChange={(selectedOption) => handleEditChange('default_warehouse', selectedOption ? selectedOption.value : '')}
                      options={warehouses && Array.isArray(warehouses) ? warehouses.map((warehouse) => ({
                        value: warehouse.name,
                        label: warehouse.warehouse_name
                      })) : []}
                      placeholder="Seleccionar almacén..."
                      isClearable
                      isSearchable
                      className="w-full"
                      classNamePrefix="react-select"
                      styles={{
                        control: (provided, state) => ({
                          ...provided,
                          border: '1px solid #d1d5db',
                          borderRadius: '0.5rem',
                          padding: '0.125rem',
                          '&:hover': {
                            borderColor: '#3b82f6'
                          },
                          boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                        }),
                        option: (provided, state) => ({
                          ...provided,
                          backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                          color: state.isSelected ? 'white' : '#374151'
                        }),
                        menu: (provided) => ({
                          ...provided,
                          zIndex: 99999
                        }),
                        menuPortal: (provided) => ({
                          ...provided,
                          zIndex: 99999
                        })
                      }}
                      menuPortalTarget={document.body}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Marca</label>
                  <CreatableSelect
                    value={editedItemData.brand ? { value: editedItemData.brand, label: editedItemData.brand } : null}
                    onChange={async (selectedOption, actionMeta) => {
                      if (actionMeta.action === 'create-option') {
                        // Crear nueva marca
                        const newBrand = await createBrand(selectedOption.label)
                        if (newBrand) {
                          handleEditChange('brand', newBrand.brand)
                        }
                      } else {
                        handleEditChange('brand', selectedOption ? selectedOption.value : '')
                      }
                    }}
                    options={brands.map((brand) => ({
                      value: brand.brand,
                      label: brand.brand
                    }))}
                    placeholder="Marca del producto"
                    isClearable
                    isSearchable
                    formatCreateLabel={(inputValue) => `Crear "${inputValue}"`}
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': {
                          borderColor: '#3b82f6'
                        },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      }),
                      menuPortal: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>
              </div>
            )}

            {itemTab === 'sales_purchase' && (
              <div className="space-y-6">
                {/* Selector de Tasa de IVA */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tasa de IVA</label>
                  <Select
                    value={(() => {
                      const editedRate = editedItemData.iva_percent !== undefined ? String(editedItemData.iva_percent) : null
                      const currentRate = editedRate || getCurrentIvaRate()
                      if (!currentRate) return null
                      return ivaOptions.find(opt => opt.value === currentRate) || null
                    })()}
                    onChange={(selectedOption) => {
                      handleEditChange('iva_percent', selectedOption ? parseFloat(selectedOption.value) : null)
                    }}
                    options={ivaOptions}
                    placeholder="Seleccionar tasa de IVA..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': {
                          borderColor: '#3b82f6'
                        },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      }),
                      menuPortal: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is_sales_item"
                      checked={editedItemData.is_sales_item === 1}
                      onChange={(e) => handleEditChange('is_sales_item', e.target.checked ? 1 : 0)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="is_sales_item" className="ml-2 text-sm font-medium text-gray-700">
                      Item de venta
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is_purchase_item"
                      checked={editedItemData.is_purchase_item === 1}
                      onChange={(e) => handleEditChange('is_purchase_item', e.target.checked ? 1 : 0)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="is_purchase_item" className="ml-2 text-sm font-medium text-gray-700">
                      Item de compra
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="grant_commission"
                      checked={editedItemData.grant_commission === 1}
                      onChange={(e) => handleEditChange('grant_commission', e.target.checked ? 1 : 0)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="grant_commission" className="ml-2 text-sm font-medium text-gray-700">
                      Otorgar comisión
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Descuento máximo (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedItemData.max_discount || 0}
                      onChange={(e) => handleEditChange('max_discount', parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'inventory' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cantidad mínima de orden</label>
                    <input
                      type="number"
                      step="1"
                      value={editedItemData.min_order_qty || 0}
                      onChange={(e) => handleEditChange('min_order_qty', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stock de seguridad</label>
                    <input
                      type="number"
                      step="1"
                      value={editedItemData.safety_stock || 0}
                      onChange={(e) => handleEditChange('safety_stock', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Días de tiempo de entrega</label>
                    <input
                      type="number"
                      step="1"
                      value={editedItemData.lead_time_days || 0}
                      onChange={(e) => handleEditChange('lead_time_days', parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'accounting' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta compras (Gastos)</label>
                  <Select
                    value={availableExpenseAccounts.find(acc => acc.name === editedItemData.expense_account) ?
                      { value: editedItemData.expense_account, label: availableExpenseAccounts.find(acc => acc.name === editedItemData.expense_account).account_name } : null}
                    onChange={(selectedOption) => handleEditChange('expense_account', selectedOption ? selectedOption.value : '')}
                    options={availableExpenseAccounts.map((account) => ({
                      value: account.name,
                      label: account.account_name
                    }))}
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': { borderColor: '#3b82f6' },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({ ...provided, zIndex: 99999 }),
                      menuPortal: (provided) => ({ ...provided, zIndex: 99999 })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta de Inventario</label>
                  <Select
                    value={availableAssetAccounts.find(acc => acc.name === editedItemData.asset_account) ?
                      { value: editedItemData.asset_account, label: availableAssetAccounts.find(acc => acc.name === editedItemData.asset_account).account_name } : null}
                    onChange={(selectedOption) => handleEditChange('asset_account', selectedOption ? selectedOption.value : '')}
                    options={availableAssetAccounts.map((account) => ({
                      value: account.name,
                      label: account.account_name
                    }))}
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': { borderColor: '#3b82f6' },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({ ...provided, zIndex: 99999 }),
                      menuPortal: (provided) => ({ ...provided, zIndex: 99999 })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta ventas (Ingresos)</label>
                  <Select
                    value={availableIncomeAccounts.find(acc => acc.name === editedItemData.income_account) ?
                      { value: editedItemData.income_account, label: availableIncomeAccounts.find(acc => acc.name === editedItemData.income_account).account_name } : null}
                    onChange={(selectedOption) => handleEditChange('income_account', selectedOption ? selectedOption.value : '')}
                    options={availableIncomeAccounts.map((account) => ({
                      value: account.name,
                      label: account.account_name
                    }))}
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': { borderColor: '#3b82f6' },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({ ...provided, zIndex: 99999 }),
                      menuPortal: (provided) => ({ ...provided, zIndex: 99999 })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>
              </div>
            )}

            {itemTab === 'description' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de descripción</label>
                  <div className="flex gap-4 mb-4">
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        name="description_type"
                        checked={editedItemData.custom_description_type === 'Plain Text' || !editedItemData.custom_description_type}
                        onChange={() => handleEditChange('custom_description_type', 'Plain Text')}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Texto plano</span>
                    </label>
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        name="description_type"
                        checked={editedItemData.custom_description_type === 'HTML' || !editedItemData.custom_description_type}
                        onChange={() => handleEditChange('custom_description_type', 'HTML')}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">HTML</span>
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Descripción detallada</label>
                  {editedItemData.custom_description_type === 'HTML' ? (
                    <textarea
                      value={editedItemData.description || ''}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      placeholder="Ingrese descripción en formato HTML..."
                      rows="8"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    />
                  ) : (
                    <textarea
                      value={editedItemData.description || ''}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      placeholder="Ingrese descripción en texto plano..."
                      rows="8"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  )}
                </div>
              </div>
            )}

            {itemTab === 'links' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Enlaces del producto</label>
                  <p className="text-sm text-gray-500 mb-4">Agregue enlaces a plataformas externas donde se vende o promociona este producto.</p>

                  {/* Lista de enlaces existentes */}
                  <div className="space-y-3 mb-4">
                    {(editedItemData.custom_product_links || []).map((link, index) => (
                      <div key={index} className="flex gap-3 items-center p-3 bg-gray-50 rounded-lg">
                        <select
                          value={link.platform || ''}
                          onChange={(e) => {
                            const updatedLinks = [...(editedItemData.custom_product_links || [])];
                            updatedLinks[index] = { ...link, platform: e.target.value };
                            handleEditChange('custom_product_links', updatedLinks);
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Seleccionar plataforma...</option>
                          <option value="mercadolibre">Mercado Libre</option>
                          <option value="amazon">Amazon</option>
                          <option value="ebay">eBay</option>
                          <option value="aliexpress">AliExpress</option>
                          <option value="shopify">Shopify</option>
                          <option value="woocommerce">WooCommerce</option>
                          <option value="website">Sitio Web</option>
                          <option value="other">Otro</option>
                        </select>
                        <input
                          type="url"
                          value={link.url || ''}
                          onChange={(e) => {
                            const updatedLinks = [...(editedItemData.custom_product_links || [])];
                            updatedLinks[index] = { ...link, url: e.target.value };
                            handleEditChange('custom_product_links', updatedLinks);
                          }}
                          placeholder="https://..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updatedLinks = (editedItemData.custom_product_links || []).filter((_, i) => i !== index);
                            handleEditChange('custom_product_links', updatedLinks);
                          }}
                          className="px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    {/* Input vacío siempre disponible para nuevo enlace */}
                    <div className="flex gap-3 items-center p-3 bg-blue-50 border-2 border-dashed border-blue-200 rounded-lg">
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            const updatedLinks = [...(editedItemData.custom_product_links || []), { platform: e.target.value, url: '' }];
                            handleEditChange('custom_product_links', updatedLinks);
                          }
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        <option value="">Seleccionar plataforma...</option>
                        <option value="mercadolibre">Mercado Libre</option>
                        <option value="amazon">Amazon</option>
                        <option value="ebay">eBay</option>
                        <option value="aliexpress">AliExpress</option>
                        <option value="shopify">Shopify</option>
                        <option value="woocommerce">WooCommerce</option>
                        <option value="website">Sitio Web</option>
                        <option value="other">Otro</option>
                      </select>
                      <input
                        type="url"
                        value=""
                        placeholder="https://..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        readOnly
                      />
                      <div className="px-3 py-2 text-gray-400">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Botón para agregar nuevo enlace (opcional, ya que hay input vacío) */}
                  <button
                    type="button"
                    onClick={() => {
                      const updatedLinks = [...(editedItemData.custom_product_links || []), { platform: '', url: '' }];
                      handleEditChange('custom_product_links', updatedLinks);
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Agregar otro enlace
                  </button>
                </div>
              </div>
            )}
          </>
        ) : itemDetails ? (
          <>
            {/* Pestañas para visualización */}
            <nav className="tab-nav mb-6">
              <button
                onClick={() => setItemTab('general')}
                className={`tab-button ${itemTab === 'general' ? 'active' : ''}`}
              >
                General
              </button>
              <button
                onClick={() => setItemTab('sales_purchase')}
                className={`tab-button ${itemTab === 'sales_purchase' ? 'active' : ''}`}
              >
                Ventas y Compras
              </button>
              <button
                onClick={() => setItemTab('accounting')}
                className={`tab-button ${itemTab === 'accounting' ? 'active' : ''}`}
              >
                Cuentas Contables
              </button>
              <button
                onClick={() => setItemTab('description')}
                className={`tab-button ${itemTab === 'description' ? 'active' : ''}`}
              >
                Descripción
              </button>
              <button
                onClick={() => setItemTab('links')}
                className={`tab-button ${itemTab === 'links' ? 'active' : ''}`}
              >
                Enlaces
              </button>
            </nav>

            {/* Contenido de las pestañas de visualización */}
            {itemTab === 'general' && (
              <div className="space-y-2 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-stretch">
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col justify-center">
                    <span className="text-sm font-semibold text-gray-600">Código</span>
                    <div className="text-gray-900 font-medium mt-1 truncate" title={extractItemCodeDisplay(itemDetails.item_code)}>{extractItemCodeDisplay(itemDetails.item_code)}</div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col justify-center">
                    <span className="text-sm font-semibold text-gray-600">Descripción</span>
                    <div className="text-gray-900 font-medium mt-1 truncate" title={itemDetails.item_name || itemDetails.description}>{itemDetails.item_name || itemDetails.description || ''}</div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-gray-600">Categoría</span>
                      <div className="text-sm text-green-600 font-medium mt-1 truncate" title={extractItemGroupName(itemDetails.item_group) || 'Sin grupo'}>{extractItemGroupName(itemDetails.item_group) || 'Sin grupo'}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-gray-600">UOM</span>
                      <div className="text-gray-900 font-medium mt-1">{itemDetails.stock_uom}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'sales_purchase' && (
              <div className="space-y-2 mt-4">
                {/* Tasa de IVA - Mostrar primero */}
                <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 mb-4">
                  <span className="text-sm font-semibold text-gray-600">Tasa de IVA:</span>
                  <span className="text-gray-900 font-medium ml-2">
                    {(() => {
                      const currentRate = getCurrentIvaRate()
                      return currentRate ? `${currentRate}%` : 'No especificada'
                    })()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Item de venta:</span>
                    <span className={`font-medium ml-2 ${itemDetails.is_sales_item === 1 ? 'text-green-600' : 'text-gray-400'}`}>
                      {itemDetails.is_sales_item === 1 ? 'Sí' : 'No'}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Item de compra:</span>
                    <span className={`font-medium ml-2 ${itemDetails.is_purchase_item === 1 ? 'text-green-600' : 'text-gray-400'}`}>
                      {itemDetails.is_purchase_item === 1 ? 'Sí' : 'No'}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Otorgar comisión:</span>
                    <span className={`font-medium ml-2 ${itemDetails.grant_commission === 1 ? 'text-green-600' : 'text-gray-400'}`}>
                      {itemDetails.grant_commission === 1 ? 'Sí' : 'No'}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Descuento máximo:</span>
                    <span className="text-gray-900 font-medium ml-2">
                      {itemDetails.max_discount ? `${itemDetails.max_discount}%` : 'No especificado'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'inventory' && (
              <div className="space-y-2 mt-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Cantidad mínima de orden:</span>
                    <span className="text-gray-900 font-medium ml-2">
                      {itemDetails.min_order_qty || 0}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Stock de seguridad:</span>
                    <span className="text-gray-900 font-medium ml-2">
                      {itemDetails.safety_stock || 0}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Días de tiempo de entrega:</span>
                    <span className="text-gray-900 font-medium ml-2">
                      {itemDetails.lead_time_days || 0} días
                    </span>
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'accounting' && (() => {
              const companyDefault = itemDetails.item_defaults?.find(
                def => def.company === activeCompany
              ) || {}

              return (
                <div className="space-y-2 mt-4">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Cuenta compras:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {companyDefault.expense_account ? extractAccountName(companyDefault.expense_account) : 'No especificada'}
                      </span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Cuenta ventas:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {companyDefault.income_account ? extractAccountName(companyDefault.income_account) : 'No especificada'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}

            {itemTab === 'description' && (
              <div className="space-y-4 mt-4">
                <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-600 mb-3">Tipo de descripción</h4>
                  <div className="flex gap-4 mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      itemDetails.custom_description_type === 'HTML' || !itemDetails.custom_description_type
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {itemDetails.custom_description_type === 'HTML' ? 'HTML' : 'Texto plano'}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-gray-600 mb-3">Descripción detallada</h4>
                  <div className="bg-gray-50 p-4 rounded-lg border">
                    {itemDetails.description_type === 'html' ? (
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: itemDetails.description || 'No hay descripción disponible.' }}
                      />
                    ) : (
                      <p className="text-gray-900 whitespace-pre-wrap">
                        {itemDetails.description || 'No hay descripción disponible.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {itemTab === 'links' && (
              <div className="space-y-4 mt-4">
                <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-600 mb-3">Enlaces del producto</h4>
                  {itemDetails.custom_product_links && itemDetails.custom_product_links.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {itemDetails.custom_product_links.map((link, index) => {
                        const platformStyle = getPlatformStyle(link.platform);
                        return (
                          <div key={index} className="group relative">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:scale-105 border border-gray-200 hover:border-gray-300"
                            >
                              {/* Header con gradiente de plataforma */}
                              <div className={`bg-gradient-to-r ${platformStyle.bg} p-4 text-white`}>
                                <div className="flex items-center justify-between">
                                  <div className="text-2xl">{platformStyle.icon}</div>
                                  <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </div>
                              </div>

                              {/* Contenido */}
                              <div className="p-4">
                                <h3 className="font-semibold text-gray-900 mb-1">{platformStyle.text}</h3>
                                <p className="text-sm text-gray-600 mb-2">{platformStyle.description}</p>
                                <div className="text-xs text-gray-500 truncate">
                                  {link.url.replace(/^https?:\/\//, '')}
                                </div>
                              </div>
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <p className="text-sm">No hay enlaces configurados para este producto.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Selecciona un item del panel izquierdo para ver sus detalles</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ItemDetailsPanel