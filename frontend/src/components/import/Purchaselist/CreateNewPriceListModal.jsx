import React, { useState, useContext, useEffect } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import API_ROUTES from '../../../apiRoutes'
import Modal from '../../Modal'
import { Plus, RefreshCw, Upload, DollarSign, Info } from 'lucide-react'

export default function CreateNewPriceListModal({
  isOpen,
  onClose,
  onComplete
}) {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  const [suppliers, setSuppliers] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [exchangeRates, setExchangeRates] = useState({})

  // Estado para detalles de la empresa activa (para obtener moneda por defecto)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()

  const [formData, setFormData] = useState({
    supplier: '',
    currency: companyCurrency || '',
    exchangeRate: '1',
    priceListName: '',
    validFrom: new Date().toISOString().split('T')[0]
  })

  const [creating, setCreating] = useState(false)
  const [counting, setCounting] = useState(false)
  const [countResult, setCountResult] = useState(null)

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
    if (isOpen && activeCompany) {
      fetchSuppliers()
      fetchCurrencies()
      fetchExchangeRates()
    }
  }, [isOpen, activeCompany])

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
      ;(payload.data || []).forEach(rate => {
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

  const handleCountItems = async () => {
    if (!formData.supplier) {
      showNotification('Por favor selecciona un proveedor', 'warning')
      return
    }

    setCounting(true)
    try {
      // Aquí iría la lógica para contar items válidos
      // Por ahora simulamos un conteo
      const mockResult = {
        totalItems: 150,
        validItems: 120,
        invalidItems: 30
      }

      setCountResult(mockResult)
      showNotification(`Encontrados ${mockResult.validItems} items válidos de ${mockResult.totalItems} totales`, 'info')
    } catch (error) {
      console.error('Error counting items:', error)
      showNotification('Error al contar items', 'error')
    } finally {
      setCounting(false)
    }
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

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/purchase-price-lists/create-empty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createData)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Lista de precios creada exitosamente', 'success')

          // Llamar al callback con los datos de la nueva lista
          if (onComplete) {
            onComplete({
              supplier: formData.supplier,
              currency: formData.currency,
              exchangeRate: formData.exchangeRate,
              priceListName: formData.priceListName,
              validFrom: formData.validFrom,
              priceListId: data.price_list_id
            })
          }

          onClose()
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

  const handleClose = () => {
    setFormData({
      supplier: '',
      currency: companyCurrency || '',
      exchangeRate: '1',
      priceListName: '',
      validFrom: new Date().toISOString().split('T')[0]
    })
    setCountResult(null)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Crear Nueva Lista de Precios"
      size="medium"
    >
      <div className="space-y-6">
        {/* Información del conteo */}
        {countResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-5 h-5 text-blue-600" />
              <h4 className="text-sm font-semibold text-blue-900">Resumen de Items</h4>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{countResult.totalItems}</div>
                <div className="text-blue-700">Total</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{countResult.validItems}</div>
                <div className="text-green-700">Válidos</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{countResult.invalidItems}</div>
                <div className="text-red-700">Inválidos</div>
              </div>
            </div>
          </div>
        )}

        {/* Formulario */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Proveedor *
            </label>
            <select
              value={formData.supplier}
              onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Seleccionar proveedor...</option>
              {suppliers.map(supplier => (
                <option key={supplier.name} value={supplier.name}>
                  {supplier.supplier_name || supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Moneda *
              </label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {currencies.map(currency => (
                  <option key={currency.name} value={currency.name}>
                    {currency.currency_name || currency.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cotización
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.exchangeRate}
                onChange={(e) => setFormData(prev => ({ ...prev, exchangeRate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="1.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre de Lista de Precios *
            </label>
            <input
              type="text"
              value={formData.priceListName}
              onChange={(e) => setFormData(prev => ({ ...prev, priceListName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Nombre automático generado"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Válida Desde
            </label>
            <input
              type="date"
              value={formData.validFrom}
              onChange={(e) => setFormData(prev => ({ ...prev, validFrom: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleCountItems}
            disabled={counting || !formData.supplier}
            className="flex-1 btn-action-primary"
          >
            {counting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Contando...
              </>
            ) : (
              <>
                <Info className="w-4 h-4 mr-2" />
                Contar Items Válidos
              </>
            )}
          </button>

          <button
            onClick={handleCreate}
            disabled={creating || !formData.supplier || !formData.priceListName.trim()}
            className="flex-1 btn-action-success"
          >
            {creating ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Creando...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Crear Lista de Precios
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
