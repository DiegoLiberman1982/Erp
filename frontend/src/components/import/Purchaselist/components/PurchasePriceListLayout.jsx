import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  Calculator,
  CheckCircle,
  DollarSign,
  Eraser,
  Filter,
  Info,
  RotateCcw,
  Save,
  Settings,
  Trash2
} from 'lucide-react'
import CalculatorModal from '../../../modals/CalculatorModal'
import PurchasePriceListManagementModal from '../PurchasePriceListManagementModal'
import loadingGif from '../../../../media/Carga1-1.gif'

export default function PurchasePriceListLayout(props) {
  const {
    activeCompany,
    activeFilter,
    creationMode,
    decimalSeparator,
    duplicateRemovalOptions,
    duplicateRemovalStrategy,
    currencies = [],
    companyCurrency = '',
    handleApplyFormula,
    handleApplyInflationResult,
    handleToggleSelectAll,
    deleteSelectedItems,
    executeDeleteSelectedItems,
    filterStats,
    findAndFocusFirstDuplicate,
    handleRemoveDuplicates,
    getSaveableCount,
    handleFetchExchangeRate,
    handleFilterChange,
    handleLoadData,
    handlePasteSkus,
    handleClearTable,
    handlePriceListSelection,
    handleSavePriceList,
    hasDuplicatesWithPrice,
    hasAnyDuplicates,
    iframeRef,
    inputMode,
    isCalculatorOpen,
    isLoadingExchangeRate,
    isManagementModalOpen,
    items,
    openDecimalFormatModal,
    loadPurchasePriceLists,
    getInflationItems,
    newListCurrency,
    newListExchangeMode,
    newListExchangeRate,
    newListName,
    priceListCurrency,
    priceListExchangeMode,
    priceListExchangeRate,
    priceListMetaChanged,
    purchasePriceLists,
    savePriceList,
    saveProgress,
    saving,
    selectedPriceList,
    selectedRows,
    selectedSupplier,
    selectAll,
    setCreationMode,
    setIsCalculatorOpen,
    setIsManagementModalOpen,
    setNewListCurrency,
    setNewListExchangeMode,
    setNewListExchangeRate,
    setNewListName,
    setPriceListCurrency,
    setPriceListExchangeMode,
    setPriceListExchangeRate,
    setDuplicateRemovalStrategy,
    setSelectedSupplier,
    setShowDeleteConfirm,
    showDeleteConfirm,
    showNotification,
    suppliers,
    visibleItems,
    isLoadingItems,
    loadingItemsMessage
  } = props

  const currencyOptions = Array.isArray(currencies) ? currencies : []

  const [showDuplicateOptions, setShowDuplicateOptions] = useState(false)
  const decimalFormatLabel = {
    auto: 'Automatico',
    comma: 'Coma decimal',
    dot: 'Punto decimal'
  }[decimalSeparator] || 'Automatico'

  useEffect(() => {
    if (!hasAnyDuplicates) {
      setShowDuplicateOptions(false)
    }
  }, [hasAnyDuplicates])

  return (
    <div className="h-full relative flex flex-col bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-visible">
      <style>
        {`
          .dynamic-section {
            transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
          }
          .dynamic-section.hidden {
            opacity: 0;
            transform: translateY(-10px);
            pointer-events: none;
            position: absolute;
          }
        `}
      </style>

      {isLoadingItems && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6">
          <div className="bg-white/90 backdrop-blur-lg shadow-2xl border border-gray-200/60 rounded-2xl px-8 py-6 flex flex-col items-center gap-4 max-w-md w-full text-center">
            <div className="w-28 h-28 rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
              <img src={loadingGif} alt="Cargando" className="w-full h-full object-contain" />
            </div>
            <div className="text-base font-semibold text-gray-800">Cargando datos de la lista...</div>
            <div className="text-sm text-gray-600 leading-snug">
              {loadingItemsMessage || 'Esto puede tardar unos segundos mientras buscamos SKUs y precios previos.'}
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Gestión</div>
              <div className="text-xl font-bold text-gray-800">Listas de Precios de Compra</div>
            </div>
          </div>

          <button
            onClick={() => setIsManagementModalOpen(true)}
            className="btn-secondary"
            title="Gestionar listas de precios de compra (habilitar/deshabilitar/eliminar)"
          >
            <Settings className="w-4 h-4" />
            Gestionar Listas
          </button>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
              <button
                className={`btn-mode-selector ${creationMode === 'update' ? 'active' : ''}`}
                onClick={() => setCreationMode('update')}
              >
                Actualizar Existentes
              </button>
              <button
                className={`btn-mode-selector ${creationMode === 'manual' ? 'active' : ''}`}
                onClick={() => setCreationMode('manual')}
              >
                Crear Nueva
              </button>
            </div>
          </div>

          <div className="flex items-end gap-4 flex-1 min-w-[300px] justify-end">
            <button
              className="flex items-center gap-2 h-9 px-4 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-all disabled:bg-gray-400"
              title="Calculadora de Precios"
              onClick={() => setIsCalculatorOpen(true)}
              disabled={items.length === 0}
            >
              <Calculator className="w-4 h-4" />
              <span>Calculadora</span>
            </button>

            {creationMode === 'update' ? (
              <div className="flex items-end gap-3 flex-wrap md:flex-nowrap">
                <div>
                  <label htmlFor="existing-price-list" className="block text-xs font-medium text-gray-600 mb-1">Lista Existente</label>
                  <select
                    id="existing-price-list"
                    name="existing-price-list"
                    value={selectedPriceList}
                    onChange={(e) => handlePriceListSelection(e.target.value)}
                    className="form-select w-full sm:w-52 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    {purchasePriceLists.map(list => (
                      <option key={list.name} value={list.name}>{list.price_list_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="price-list-currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
                  <select
                    id="price-list-currency"
                    name="price-list-currency"
                    value={priceListCurrency}
                    onChange={(e) => setPriceListCurrency(e.target.value)}
                    className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    <option value="">Seleccionar...</option>
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
                </div>
                {Boolean(companyCurrency) && priceListCurrency && priceListCurrency !== companyCurrency && (
                  <div className="flex flex-col justify-end min-w-[220px]">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cotización</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={priceListExchangeMode}
                        onChange={(e) => setPriceListExchangeMode(e.target.value)}
                        className="form-select bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-2 h-9"
                        title={priceListExchangeMode === 'general'
                          ? 'General = usa la cotización global del sistema. Para actualizar la cotización global vaya a Dashboard -> Cotizaciones.'
                          : 'Específica = esta lista usará la cotización numérica ingresada aquí.'}
                      >
                        <option value="specific">Específica</option>
                        <option value="general">General</option>
                      </select>

                      <div className="flex gap-1 items-center">
                        <input
                          type="number"
                          id="price-list-exchange-rate"
                          name="price-list-exchange-rate"
                          value={priceListExchangeRate}
                          onChange={(e) => {
                            const v = e.target.value
                            if (Number(v) < 0) {
                              showNotification('No se permiten valores negativos en la cotización', 'warning')
                              return
                            }
                            setPriceListExchangeRate(v)
                          }}
                          title={priceListExchangeMode === 'general'
                            ? 'La cotización usa la tasa global del sistema (no editable). Para actualizar la cotización vaya a Dashboard -> Cotizaciones.'
                            : 'Ingresa la cotización numérica para esta lista.'}
                          min="0"
                          step="0.0001"
                          placeholder="1.0000"
                          className="form-input w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                          readOnly={priceListExchangeMode === 'general'}
                        />
                        {priceListExchangeMode === 'specific' ? (
                          <button
                            type="button"
                            onClick={() => handleFetchExchangeRate(priceListCurrency, setPriceListExchangeRate)}
                            disabled={isLoadingExchangeRate}
                            className="inline-flex items-center justify-center w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg transition-colors duration-200 exchange-rate-btn"
                            title={priceListExchangeMode === 'general' ? 'Refrescar tasa global' : 'Obtener cotización del BCRA'}
                            style={{ minWidth: '36px', minHeight: '36px' }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 ${isLoadingExchangeRate ? 'animate-spin' : ''}`}>
                              <path d="M12 15V3"></path>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <path d="m7 10 5 5 5-5"></path>
                            </svg>
                          </button>
                        ) : null}
                      </div>
                      {priceListExchangeMode === 'general' && (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold" title="Usa la tasa global del sistema. Para actualizar la cotización vaya a Dashboard -> Cotizaciones">Usa tasa global</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-col justify-end">
                  <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
                    <button
                      onClick={handlePasteSkus}
                      className={`btn-mode-selector ${inputMode === 'paste' ? 'active' : ''}`}
                    >
                      Pegar SKUs
                    </button>
                    <button
                      onClick={handleLoadData}
                      className={`btn-mode-selector ${inputMode === 'load_all' ? 'active' : ''}`}
                      disabled={!selectedPriceList}
                      title={!selectedPriceList ? 'Selecciona una lista de precios primero' : 'Cargar items de la lista seleccionada'}
                    >
                      Cargar Datos
                    </button>
                  </div>
                </div>

                <button
                  className={`flex items-center gap-2 h-9 px-4 font-semibold rounded-lg shadow-md transition-all ${
                    hasDuplicatesWithPrice
                      ? 'bg-red-600 hover:bg-red-700 cursor-not-allowed btn-save-dup-disabled'
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400'
                  } text-white`}
                  title={hasDuplicatesWithPrice
                    ? 'No se puede guardar: hay SKUs duplicados con precio nuevo. Elimina los duplicados o quita el precio.'
                    : 'Guardar Cambios'}
                  onClick={savePriceList}
                  disabled={(getSaveableCount() === 0 && !priceListMetaChanged) || saving || !selectedPriceList || hasDuplicatesWithPrice}
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Guardando...' : `Guardar (${getSaveableCount()})`}</span>
                </button>
              </div>
            ) : creationMode === 'manual' ? (
              <div className="flex items-end gap-3">
                <div>
                  <label htmlFor="supplier-select" className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
                  <select
                    id="supplier-select"
                    name="supplier-select"
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="form-select w-full sm:w-40 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.name} value={supplier.name}>{supplier.supplier_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="new-list-name" className="block text-xs font-medium text-gray-600 mb-1">Nombre Lista</label>
                  <input
                    type="text"
                    id="new-list-name"
                    name="new-list-name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="Nombre de la lista"
                    className="form-input w-full sm:w-40 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  />
                </div>

                <div>
                  <label htmlFor="new-list-currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
                  <select
                    id="new-list-currency"
                    name="new-list-currency"
                    value={newListCurrency}
                    onChange={(e) => setNewListCurrency(e.target.value)}
                    className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    <option value="">Seleccionar...</option>
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
                </div>

                {Boolean(companyCurrency) && newListCurrency && newListCurrency !== companyCurrency && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cotización</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={newListExchangeMode}
                        onChange={(e) => setNewListExchangeMode(e.target.value)}
                        className="form-select bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-2 h-9"
                        title={newListExchangeMode === 'general'
                          ? 'General = usa la cotización global del sistema. Para actualizar la cotización global vaya a Dashboard → Cotizaciones.'
                          : 'Específica = esta lista usará la cotización numérica ingresada aquí.'}
                      >
                        <option value="specific">Específica</option>
                        <option value="general">General</option>
                      </select>

                      <div className="flex gap-1 items-center">
                        <input
                          type="number"
                          id="new-list-exchange-rate"
                          name="new-list-exchange-rate"
                          value={newListExchangeRate}
                          onChange={(e) => {
                            const v = e.target.value
                            if (Number(v) < 0) {
                              showNotification('No se permiten valores negativos en la cotización', 'warning')
                              return
                            }
                            setNewListExchangeRate(v)
                          }}
                          title={newListExchangeMode === 'general'
                            ? 'La cotización usa la tasa global del sistema (no editable). Para actualizar la cotización vaya a Dashboard → Cotizaciones.'
                            : 'Ingresa la cotización numérica para esta lista.'}
                          min="0"
                          step="0.0001"
                          placeholder="1.0000"
                          className="form-input w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                          readOnly={newListExchangeMode === 'general'}
                        />
                        {newListExchangeMode === 'specific' ? (
                          <button
                            type="button"
                            onClick={() => handleFetchExchangeRate(newListCurrency, setNewListExchangeRate)}
                            disabled={isLoadingExchangeRate}
                            className="inline-flex items-center justify-center w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg transition-colors duration-200 exchange-rate-btn"
                            title="Obtener cotización del BCRA"
                            style={{ minWidth: '36px', minHeight: '36px' }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 ${isLoadingExchangeRate ? 'animate-spin' : ''}`}>
                              <path d="M12 15V3"></path>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <path d="m7 10 5 5 5-5"></path>
                            </svg>
                          </button>
                        ) : null}
                      </div>
                      {newListExchangeMode === 'general' && (
                        <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold" title="Usa la tasa global del sistema. Para actualizar la cotización vaya a Dashboard → Cotizaciones">Usa tasa global</span>
                      )}
                    </div>
                  </div>
                )}

                <button
                  className={`flex items-center gap-2 h-9 px-4 font-semibold rounded-lg shadow-md transition-all ${
                    hasDuplicatesWithPrice
                      ? 'bg-red-600 hover:bg-red-700 cursor-not-allowed btn-save-dup-disabled'
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400'
                  } text-white`}
                  title={hasDuplicatesWithPrice
                    ? 'No se puede guardar: hay SKUs duplicados con precio nuevo. Elimina los duplicados o quita el precio.'
                    : 'Guardar Lista de Precios'}
                  onClick={handleSavePriceList}
                  disabled={getSaveableCount() === 0 || !newListName.trim() || !selectedSupplier || hasDuplicatesWithPrice}
                >
                  <Save className="w-4 h-4" />
                  <span>{`Guardar (${getSaveableCount()})`}</span>
                </button>
              </div>
            ) : null}

          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 flex flex-col h-full">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleToggleSelectAll}
                className="btn-filter"
                title={selectAll ? 'Deseleccionar todos los items visibles' : 'Seleccionar todos los items visibles'}
              >
                <CheckCircle className="w-3 h-3 text-green-600" />
              </button>

              <button
                onClick={deleteSelectedItems}
                disabled={selectedRows.size === 0}
                className={`btn-filter ${selectedRows.size > 0 ? 'btn-filter-danger-active' : 'opacity-50 cursor-not-allowed'}`}
                title={selectedRows.size > 0 ? `Eliminar ${selectedRows.size} fila(s) seleccionada(s)` : 'Selecciona filas para eliminar'}
              >
                <Trash2 className="w-3 h-3" />
              </button>

              <button
                onClick={handleClearTable}
                disabled={items.length === 0}
                className={`btn-filter ${items.length > 0 ? '' : 'opacity-50 cursor-not-allowed'}`}
                title="Vaciar la tabla (solo limpia esta vista, no borra datos en ERPNext)"
              >
                <RotateCcw className="w-3 h-3 text-blue-600" />
              </button>

              <button
                onClick={findAndFocusFirstDuplicate}
                className="btn-filter"
                title="Ir al primer SKU duplicado"
              >
                <AlertCircle className="w-3 h-3 text-red-600" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowDuplicateOptions(prev => !prev)}
                  className={`btn-filter ${hasAnyDuplicates ? '' : 'opacity-50 cursor-not-allowed'}`}
                  title={hasAnyDuplicates ? 'Eliminar duplicados según un criterio' : 'No hay duplicados detectados'}
                  disabled={!hasAnyDuplicates}
                >
                  <Eraser className="w-3 h-3 text-purple-600" />
                </button>

                {showDuplicateOptions && hasAnyDuplicates && (
                  <div className="absolute z-20 right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Eliminar duplicados</div>
                    <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="duplicate-removal-mode">
                      Criterio
                    </label>
                    <select
                      id="duplicate-removal-mode"
                      value={duplicateRemovalStrategy}
                      onChange={(e) => setDuplicateRemovalStrategy(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {duplicateRemovalOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>

                      <div className="flex justify-end gap-2 mt-3">
                        <button
                          type="button"
                          className="btn-mode-selector"
                          onClick={() => setShowDuplicateOptions(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            handleRemoveDuplicates()
                            setShowDuplicateOptions(false)
                          }}
                        >
                          Aplicar
                        </button>
                      </div>
                  </div>
                )}
              </div>

              <div className="h-8 w-px bg-gray-300"></div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={activeFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[180px]"
                  title="Filtrar items visibles"
                >
                  <option value="none">Sin filtro</option>
                  <option value="selected">Solo seleccionados</option>
                  <option value="with-price" disabled={!filterStats.canFilterWithPrice}>
                    Con precio nuevo {!filterStats.canFilterWithPrice ? '(N/A)' : ''}
                  </option>
                  <option value="without-price" disabled={!filterStats.canFilterWithoutPrice}>
                    Sin precio nuevo {!filterStats.canFilterWithoutPrice ? '(N/A)' : ''}
                  </option>
                  <option value="duplicates">Duplicados</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Formato</span>
                <span className="text-xs font-semibold text-gray-800">{decimalFormatLabel}</span>
                <button
                  type="button"
                  className="btn-filter"
                  onClick={openDecimalFormatModal}
                  title="Configurar separador decimal para los importes pegados"
                >
                  Formato precios
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>{`${selectedRows.size} ${selectedRows.size === 1 ? 'seleccionado' : 'seleccionados'}`}</span>
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1">
                <Filter className="w-4 h-4 text-blue-500" />
                <span>{`${visibleItems.length} ${visibleItems.length === 1 ? 'visible' : 'visibles'}`}</span>
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1">
                <Info className="w-4 h-4 text-gray-500" />
                <span>{`${items.length} ${items.length === 1 ? 'total' : 'totales'}`}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col" style={{ minHeight: '600px' }}>
            <iframe
              ref={iframeRef}
              src="/handsontable-demo.html"
              className="w-full flex-1 border-0"
              title="Tabla Base de Gestión"
              style={{ minHeight: '600px', height: '100%' }}
            />
          </div>
        </div>

        {saveProgress && saveProgress.status === 'completed' && (
          <div className="p-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">
                  ¡Lista guardada exitosamente! {saveProgress.saved} items guardados, {saveProgress.failed} fallidos.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <CalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
        onApplyFormula={handleApplyFormula}
        onApplyInflation={handleApplyInflationResult}
        getInflationItems={getInflationItems}
        currentItemsCount={items.filter(item => item.existing_price > 0).length}
        mode="purchase"
      />

      <PurchasePriceListManagementModal
        isOpen={isManagementModalOpen}
        onClose={() => setIsManagementModalOpen(false)}
        onListUpdated={loadPurchasePriceLists}
        currentCompany={activeCompany}
      />

      {showDeleteConfirm && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-header">
              <div className="confirm-modal-title-section">
                <span className="text-2xl">⚠️</span>
                <h3 className="confirm-modal-title">Confirmar Eliminación de Artículos</h3>
              </div>
              <button onClick={() => setShowDeleteConfirm(false)} className="confirm-modal-close-btn">×</button>
            </div>
            <div className="confirm-modal-body">
              <p className="confirm-modal-message text-red-600 font-semibold mb-3">
                ATENCIÓN: Esta acción no se puede deshacer
              </p>
              <p className="confirm-modal-message mb-2">
                ¿Eliminar definitivamente {selectedRows.size} artículo(s) de la lista de precios "{purchasePriceLists.find(list => list.name === selectedPriceList)?.price_list_name || selectedPriceList}"?
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                Los artículos serán eliminados permanentemente de la lista de precios seleccionada.
                Los items en sí no serán afectados, solo se removerán de esta lista específica.
              </p>
            </div>
            <div className="confirm-modal-footer">
              <button onClick={() => setShowDeleteConfirm(false)} className="confirm-modal-btn-cancel">
                Cancelar
              </button>
              <button onClick={executeDeleteSelectedItems} className="confirm-modal-btn-confirm error">
                Eliminar de Lista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
