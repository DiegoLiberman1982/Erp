import React, { useState, useContext, useEffect } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import { Upload, RefreshCw, Plus, DollarSign, Save } from 'lucide-react'
import PurchasePriceListTemplate from '../PurchasePriceListTemplate'
import API_ROUTES from '../../../apiRoutes'

export default function PurchasePriceListManager() {
  const { activeCompany, fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  const [mode, setMode] = useState('create') // 'create', 'existing', 'update'
  const [createdPriceList, setCreatedPriceList] = useState(null)

  // Estado para detalles de la empresa activa (para obtener moneda por defecto)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()

  // Estados para crear nueva lista
  const [suppliers, setSuppliers] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [exchangeRates, setExchangeRates] = useState({})
  const [formData, setFormData] = useState({
    supplier: '',
    currency: companyCurrency || '',
    exchangeRate: '1',
    priceListName: '',
    validFrom: new Date().toISOString().split('T')[0]
  })
  const [creating, setCreating] = useState(false)

  // Función para cargar detalles de la empresa activa
  const fetchActiveCompanyDetails = async (companyName) => {
    if (!companyName) return
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}`)
      if (response.ok) {
        const data = await response.json()
        setActiveCompanyDetails(data.data)
      }
    } catch (error) {
      console.error('Error fetching active company details:', error)
    }
  }

  // Cargar detalles de la empresa cuando cambie activeCompany
  useEffect(() => {
    if (activeCompany) {
      fetchActiveCompanyDetails(activeCompany)
    }
  }, [activeCompany])

  // Actualizar currency en formData cuando se cargue companyCurrency
  useEffect(() => {
    if (companyCurrency && !formData.currency) {
      setFormData(prev => ({ ...prev, currency: companyCurrency }))
    }
  }, [companyCurrency])

  // Cargar datos iniciales
  useEffect(() => {
    if (activeCompany) {
      fetchSuppliers()
      fetchCurrencies()
      fetchExchangeRates()
    }
  }, [activeCompany])

  const fetchSuppliers = async () => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.suppliers}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    }
  }

  const fetchCurrencies = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.currencies)
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      if (data && data.success) setCurrencies(data.data || [])
    } catch (error) {
      console.error('Error fetching currencies:', error)
    }
  }

  const fetchExchangeRates = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.exchangeRates)
      if (!response.ok) return
      const payload = await response.json().catch(() => ({}))
      if (!payload?.success) return

      const rates = {}
      ;(payload.data || []).forEach((rate) => {
        if (rate?.from_currency && rate?.exchange_rate != null) {
          rates[rate.from_currency] = String(rate.exchange_rate)
        }
      })
      setExchangeRates(rates)
    } catch (error) {
      console.error('Error fetching exchange rates:', error)
    }
  }

  // Actualizar cotización cuando cambia la moneda
  useEffect(() => {
    if (!formData.currency) return
    if (formData.currency === companyCurrency) {
      setFormData(prev => ({ ...prev, exchangeRate: '1' }))
      return
    }
    setFormData(prev => ({ ...prev, exchangeRate: exchangeRates[formData.currency] || '' }))
  }, [formData.currency, exchangeRates, companyCurrency])

  // Generar nombre automático de lista de precios
  useEffect(() => {
    if (formData.supplier && suppliers.length > 0) {
      const supplier = suppliers.find(s => s.name === formData.supplier)
      if (supplier) {
        const supplierName = supplier.supplier_name || supplier.name
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
        const priceListName = `${supplierName} - ${today}`
        setFormData(prev => ({ ...prev, priceListName }))
      }
    }
  }, [formData.supplier, suppliers])

  const handleCreateNew = () => {
    setMode('create')
    showNotification('Modo "Crear Nueva" seleccionado', 'info')
  }

  const handleExistingList = () => {
    setMode('existing')
    showNotification('Modo "Lista Existente" seleccionado', 'info')
  }

  const handleUpdateExisting = () => {
    setMode('update')
    showNotification('Modo "Actualizar Existentes" seleccionado', 'info')
  }

  const handleImportComplete = () => {
    showNotification('Importación completada exitosamente', 'success')
    // Reset to initial state
    setMode('create')
    setCreatedPriceList(null)
  }

  const handleCreate = async () => {
    if (!formData.supplier) {
      showNotification('Por favor selecciona un proveedor', 'warning')
      return
    }

    if (!formData.priceListName.trim()) {
      showNotification('Por favor ingresa un nombre para la lista de precios', 'warning')
      return
    }

    if (!companyCurrency) {
      showNotification('La empresa no tiene moneda por defecto definida', 'error')
      return
    }

    if (!formData.currency) {
      showNotification('Selecciona una moneda', 'warning')
      return
    }

    const isBaseCurrency = formData.currency === companyCurrency
    const parsedExchangeRate = isBaseCurrency ? 1 : Number(formData.exchangeRate)
    if (!isBaseCurrency && (!Number.isFinite(parsedExchangeRate) || parsedExchangeRate <= 0)) {
      showNotification(`No hay cotizacion valida para ${formData.currency}/${companyCurrency}`, 'error')
      return
    }

    setCreating(true)
    try {
      // Crear la lista de precios vacía
      const createData = {
        supplier: formData.supplier,
        currency: formData.currency,
        exchange_rate: parsedExchangeRate,
        price_list_name: formData.priceListName.trim(),
        valid_from: formData.validFrom,
        company: activeCompany
      }

      const response = await fetchWithAuth('/api/inventory/purchase-price-lists/create-empty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createData)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Lista de precios creada exitosamente', 'success')

          // Llamar al callback con los datos de la nueva lista
          setCreatedPriceList({
            supplier: formData.supplier,
            currency: formData.currency,
            exchangeRate: formData.exchangeRate,
            priceListName: formData.priceListName,
            validFrom: formData.validFrom,
            priceListId: data.price_list_id
          })
          setMode('import')
          showNotification('Lista de precios creada. Ahora puedes importar los precios.', 'success')

          // Reset form
          setFormData({
            supplier: '',
            currency: companyCurrency || '',
            exchangeRate: '1',
            priceListName: '',
            validFrom: new Date().toISOString().split('T')[0]
          })
        } else {
          showNotification(data.message || 'Error al crear la lista de precios', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al crear la lista de precios', 'error')
      }
    } catch (error) {
      console.error('Error creating price list:', error)
      showNotification('Error al crear la lista de precios', 'error')
    } finally {
      setCreating(false)
    }
  }

  if (mode === 'import' && createdPriceList) {
    return <PurchasePriceListTemplate />
  }

  return (
    <div className="h-full flex flex-col bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        {/* Título arriba de los botones */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-xl flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">Gestión</div>
            <div className="text-xl font-bold text-gray-800 flex items-center gap-2">
              Lista de Precios de Compra
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6">
          {/* Sección izquierda: Modos de gestión */}
          <div className="flex items-center gap-4">
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={handleCreateNew}
                className={`btn-mode-selector ${mode === 'create' ? 'active' : ''}`}
              >
                Crear Nuevos
              </button>
              <button
                onClick={handleExistingList}
                className={`btn-mode-selector ${mode === 'existing' ? 'active' : ''}`}
              >
                Lista Existente
              </button>
              <button
                onClick={handleUpdateExisting}
                className={`btn-mode-selector ${mode === 'update' ? 'active' : ''}`}
              >
                Actualizar Existentes
              </button>
            </div>
          </div>

          {/* Sección derecha: Controles del modo */}
          <div className="flex items-end gap-4 flex-1 min-w-[300px] justify-end">
            {mode === 'create' ? (
              <div className="flex items-end gap-3">
                <div>
                  <label htmlFor="supplier" className="block text-xs font-medium text-gray-600 mb-1">Proveedor *</label>
                  <select
                    id="supplier"
                    value={formData.supplier}
                    onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                    className="form-select w-full sm:w-40 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    required
                  >
                    <option value="">Seleccionar...</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.name} value={supplier.name}>
                        {supplier.supplier_name || supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda *</label>
                  <select
                    id="currency"
                    value={formData.currency}
                    onChange={(e) => setFormData(prev => ({ ...prev, currency: e.target.value }))}
                    className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    {currencies.map(currency => (
                      <option key={currency.name} value={currency.name}>
                        {currency.currency_name || currency.name}
                      </option>
                    ))}
                  </select>
                </div>
                {formData.currency && formData.currency !== companyCurrency && (
                  <div>
                    <label htmlFor="exchange-rate" className="block text-xs font-medium text-gray-600 mb-1">Cotización</label>
                    <input
                      type="number"
                      id="exchange-rate"
                      step="0.01"
                      value={formData.exchangeRate}
                      onChange={(e) => setFormData(prev => ({ ...prev, exchangeRate: e.target.value }))}
                      className="form-input w-full sm:w-24 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                      placeholder="1.00"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="price-list-name" className="block text-xs font-medium text-gray-600 mb-1">Nombre Lista *</label>
                  <input
                    type="text"
                    id="price-list-name"
                    value={formData.priceListName}
                    onChange={(e) => setFormData(prev => ({ ...prev, priceListName: e.target.value }))}
                    className="form-input w-full sm:w-48 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    placeholder="Nombre automático"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="valid-from" className="block text-xs font-medium text-gray-600 mb-1">Válida Desde</label>
                  <input
                    type="date"
                    id="valid-from"
                    value={formData.validFrom}
                    onChange={(e) => setFormData(prev => ({ ...prev, validFrom: e.target.value }))}
                    className="form-input w-full sm:w-32 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  />
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creating || !formData.supplier || !formData.priceListName.trim()}
                  className="btn-action-success"
                >
                  {creating ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Crear Lista
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                {mode === 'existing' && 'Trabajar con una lista de precios existente'}
                {mode === 'update' && 'Actualizar precios en listas existentes'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto">
          {mode === 'create' && (
            <div className="text-center py-12">
              <div className="mb-6">
                <Plus className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Crear Nueva Lista de Precios
                </h3>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  Usa los campos arriba para configurar tu nueva lista de precios.
                  Selecciona un proveedor, elige la moneda y establece la cotización si es necesario.
                  Una vez creada la lista, podrás importar los precios pegando los SKUs y valores desde Excel.
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-2xl mx-auto">
                <h4 className="font-semibold text-blue-900 mb-2">Pasos para crear una lista:</h4>
                <ol className="text-sm text-blue-800 space-y-1 text-left">
                  <li>1. Selecciona el proveedor de la lista</li>
                  <li>2. Elige la moneda</li>
                  <li>3. Si la moneda no es la base de la empresa, ingresa la cotización</li>
                  <li>4. El nombre se genera automáticamente o puedes editarlo</li>
                  <li>5. Opcionalmente, establece una fecha de validez</li>
                  <li>6. Haz clic en "Crear Lista" para continuar</li>
                </ol>
              </div>
            </div>
          )}

          {mode === 'existing' && (
            <div className="text-center py-12">
              <div className="mb-6">
                <Upload className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Lista Existente
                </h3>
                <p className="text-gray-600">
                  Selecciona una lista de precios existente para trabajar con ella.
                  Podrás agregar nuevos items o modificar precios existentes.
                </p>
              </div>
              <div className="text-sm text-gray-500">
                Funcionalidad en desarrollo...
              </div>
            </div>
          )}

          {mode === 'update' && (
            <div className="text-center py-12">
              <div className="mb-6">
                <RefreshCw className="w-16 h-16 text-orange-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Actualizar Existentes
                </h3>
                <p className="text-gray-600">
                  Actualiza los precios de items que ya existen en tus listas de precios.
                  Pega los SKUs y los nuevos precios para actualizar masivamente.
                </p>
              </div>
              <div className="text-sm text-gray-500">
                Funcionalidad en desarrollo...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
