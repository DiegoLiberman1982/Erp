import React, { useState, useContext, useEffect } from 'react'
import { Building2, Plus, Edit, Trash2, Check, X, Save, MapPin } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import DeleteCompanyModal from '../modals/DeleteCompanyModal'
const CompanyTab = ({ onRequestOpenCompanyAddresses, onAddCompanyClick }) => {
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingCompany, setEditingCompany] = useState(null)
  const [editedData, setEditedData] = useState({})
  const [saving, setSaving] = useState(false)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const { fetchWithAuth, activeCompany: activeCompanyFromContext, refreshCompanies } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  // Estados para gestión de direcciones de compañía
  const [companyAddresses, setCompanyAddresses] = useState([])
  const [loadingAddresses, setLoadingAddresses] = useState(false)
  const [editingFiscalAddress, setEditingFiscalAddress] = useState(false)
  const [fiscalAddressForm, setFiscalAddressForm] = useState({
    address_title: 'Dirección Fiscal',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'Argentina'
  })

  // Estados para monedas disponibles
  const [availableCurrencies, setAvailableCurrencies] = useState([])
  const [loadingCurrencies, setLoadingCurrencies] = useState(false)

  // Estados para búsqueda predictiva de monedas
  const [currencySearchResults, setCurrencySearchResults] = useState([])
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false)
  const [currencySearchQuery, setCurrencySearchQuery] = useState('')

  // Estado para modal de eliminación de compañía
  const [showDeleteCompanyModal, setShowDeleteCompanyModal] = useState(false)
  const [companyToDelete, setCompanyToDelete] = useState(null)

  // Cargar empresas al montar el componente
  useEffect(() => {
    fetchCompanies()
    fetchAvailableCurrencies()
  }, [])

  // Cargar detalles de la empresa activa cuando cambia
  useEffect(() => {
    if (activeCompanyFromContext) {
      console.log('Loading details for active company:', activeCompanyFromContext)
      fetchCompanyDetails(activeCompanyFromContext).then(details => {
        setActiveCompanyDetails(details)
        // Cargar direcciones de la compañía
        fetchCompanyAddresses()
      })
    } else {
      setActiveCompanyDetails(null)
    }
  }, [activeCompanyFromContext])

  // Actualizar el query de búsqueda de moneda cuando cambian los detalles o las monedas
  useEffect(() => {
    if (activeCompanyDetails?.default_currency && availableCurrencies.length > 0) {
      const selectedCurrency = availableCurrencies.find(c => c.name === activeCompanyDetails.default_currency)
      if (selectedCurrency) {
        setCurrencySearchQuery(`${selectedCurrency.currency_name} (${selectedCurrency.symbol || selectedCurrency.name})`)
      }
    }
  }, [activeCompanyDetails?.default_currency, availableCurrencies])

  // Función para obtener la lista de empresas
  const fetchCompanies = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetchWithAuth('/api/companies')

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Obtener detalles adicionales para cada empresa
          const companiesWithDetails = data.data.map(company => ({
            ...company,
            isActive: company.name === activeCompanyFromContext
          }))
          setCompanies(companiesWithDetails)
        } else {
          setError('Error al obtener empresas')
        }
      } else {
        setError('Error al conectar con el servidor')
      }
    } catch (error) {
      console.error('Error fetching companies:', error)
      setError('Error al cargar empresas')
    } finally {
      setLoading(false)
    }
  }

  // Función para obtener los datos detallados de una empresa específica
  const fetchCompanyDetails = async (companyName) => {
    try {
      const response = await fetchWithAuth(`/api/companies/${companyName}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          return data.data
        }
      }
      return null
    } catch (error) {
      console.error('Error fetching company details:', error)
      return null
    }
  }

  // Función para cargar monedas disponibles
  const fetchAvailableCurrencies = async () => {
    try {
      setLoadingCurrencies(true)
      const response = await fetchWithAuth('/api/currencies')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailableCurrencies(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching currencies:', error)
    } finally {
      setLoadingCurrencies(false)
    }
  }

  // Función para buscar monedas
  const searchCurrencies = (query) => {
    if (!query || query.length < 1) {
      setCurrencySearchResults([])
      return
    }

    const filtered = availableCurrencies.filter(currency =>
      currency.currency_name.toLowerCase().includes(query.toLowerCase()) ||
      currency.name.toLowerCase().includes(query.toLowerCase()) ||
      (currency.symbol && currency.symbol.toLowerCase().includes(query.toLowerCase()))
    )

    setCurrencySearchResults(filtered.slice(0, 10)) // Limitar a 10 resultados
  }

  // Función para seleccionar una moneda
  const selectCurrency = (currency) => {
    setEditedData(prev => ({ ...prev, default_currency: currency.name }))
    setCurrencySearchQuery(`${currency.currency_name} (${currency.symbol || currency.name})`)
    setCurrencySearchResults([])
    setShowCurrencyDropdown(false)
  }

  // Función para manejar cambios en el input de búsqueda de monedas
  const handleCurrencySearchChange = (value) => {
    setCurrencySearchQuery(value)
    setEditedData(prev => ({ ...prev, default_currency: '' })) // Limpiar selección cuando se busca
    searchCurrencies(value)
  }

  // Función para obtener la dirección fiscal de la compañía
  const getCompanyFiscalAddress = () => {
    // Primero buscar por tipo 'Billing' (Dirección Fiscal)
    let fiscalAddress = companyAddresses.find(address =>
      address.address_type === 'Billing' ||
      address.address_type === 'Dirección Fiscal' ||
      (address.address_type === 'Other' && address.custom_type === 'Fiscal')
    )

    // Si no encuentra, buscar por título que contenga "Fiscal" o "Principal"
    if (!fiscalAddress) {
      fiscalAddress = companyAddresses.find(address =>
        address.address_title?.toLowerCase().includes('fiscal') ||
        address.address_title?.toLowerCase().includes('principal') ||
        address.address_title?.toLowerCase().includes('sede')
      )
    }

    // Si aún no encuentra, usar la primera dirección disponible
    if (!fiscalAddress && companyAddresses.length > 0) {
      fiscalAddress = companyAddresses[0]
    }

    return fiscalAddress
  }

  // Función para cargar direcciones de la compañía
  const fetchCompanyAddresses = async () => {
    if (!activeCompanyFromContext) return

    try {
      setLoadingAddresses(true)
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}/addresses`)

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const addresses = data.data || []
          setCompanyAddresses(addresses)

          // Actualizar el formulario de dirección fiscal con los datos de la dirección fiscal encontrada
          const fiscalAddress = addresses.find(address =>
            address.address_type === 'Billing' ||
            address.address_type === 'Dirección Fiscal' ||
            (address.address_type === 'Other' && address.custom_type === 'Fiscal') ||
            address.address_title?.toLowerCase().includes('fiscal') ||
            address.address_title?.toLowerCase().includes('principal') ||
            address.address_title?.toLowerCase().includes('sede')
          ) || (addresses.length > 0 ? addresses[0] : null)

          if (fiscalAddress) {
            setFiscalAddressForm({
              address_title: fiscalAddress.address_title || 'Dirección Fiscal',
              address_line1: fiscalAddress.address_line1 || '',
              address_line2: fiscalAddress.address_line2 || '',
              city: fiscalAddress.city || '',
              state: fiscalAddress.state || '',
              pincode: fiscalAddress.pincode || '',
              country: fiscalAddress.country || 'Argentina'
            })
          }
        }
      } else if (response.status === 404) {
        // Endpoint no existe aún, usar lista vacía
        console.log('Company addresses endpoint not implemented yet')
        setCompanyAddresses([])
      } else {
        console.error('Error fetching company addresses:', response.status)
        setCompanyAddresses([])
      }
    } catch (error) {
      console.error('Error fetching company addresses:', error)
      setCompanyAddresses([])
    } finally {
      setLoadingAddresses(false)
    }
  }

  // Función para guardar dirección de compañía
  const handleSaveCompanyAddress = async (addressData) => {
    try {
      showNotification('La gestión de direcciones de compañía no está implementada aún', 'warning')
      return false
    } catch (error) {
      console.error('Error saving company address:', error)
      showNotification('Error al guardar dirección', 'error')
      return false
    }
  }

  // Función para actualizar la dirección principal de la compañía
  const updateCompanyAddress = async (addressName) => {
    if (!activeCompanyFromContext) return

    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            address: addressName
          }
        }),
      })

      if (response.ok) {
        console.log('Company address updated successfully')
      } else {
        console.error('Error updating company address')
      }
    } catch (error) {
      console.error('Error updating company address:', error)
    }
  }

  // Función para eliminar dirección de compañía
  const handleDeleteCompanyAddress = async (address) => {
    showNotification('La gestión de direcciones de compañía no está implementada aún', 'warning')
  }

  // Nota: el modal se controla desde el componente padre (ConfigurationSettings)

  // Funciones para editar dirección fiscal directamente
  const handleEditFiscalAddress = () => {
    const fiscalAddress = getCompanyFiscalAddress()
    if (fiscalAddress) {
      setFiscalAddressForm({
        address_title: fiscalAddress.address_title || 'Dirección Fiscal',
        address_line1: fiscalAddress.address_line1 || '',
        address_line2: fiscalAddress.address_line2 || '',
        city: fiscalAddress.city || '',
        state: fiscalAddress.state || '',
        pincode: fiscalAddress.pincode || '',
        country: fiscalAddress.country || 'Argentina'
      })
    } else {
      // Si no hay dirección fiscal, inicializar con valores por defecto
      setFiscalAddressForm({
        address_title: 'Dirección Fiscal',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        pincode: '',
        country: 'Argentina'
      })
    }
    setEditingFiscalAddress(true)
  }

  const handleCancelEditFiscalAddress = () => {
    setEditingFiscalAddress(false)
    setFiscalAddressForm({
      address_title: 'Dirección Fiscal',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'Argentina'
    })
  }

  const handleSaveFiscalAddress = async () => {
    try {
      setLoadingAddresses(true)
      // Build payload from form
      const payload = {
        address_title: fiscalAddressForm.address_title || 'Dirección Fiscal',
        address_line1: fiscalAddressForm.address_line1 || '',
        address_line2: fiscalAddressForm.address_line2 || '',
        city: fiscalAddressForm.city || '',
        state: fiscalAddressForm.state || '',
        pincode: fiscalAddressForm.pincode || '',
        country: fiscalAddressForm.country || 'Argentina',
        // Mark as company address so ERPNext flags it (and to make it easier to find)
        is_your_company_address: true
      }

      const fiscalAddress = getCompanyFiscalAddress()

      // If company abbr exists, ensure title ends with " - {abbr}"
      const abbr = activeCompanyDetails?.abbr
      if (payload.address_title && abbr && !payload.address_title.endsWith(` - ${abbr}`)) {
        payload.address_title = `${payload.address_title} - ${abbr}`
      }

      let response
      if (fiscalAddress && fiscalAddress.name) {
        // update existing fiscal address
        response = await fetchWithAuth(`/api/addresses/${encodeURIComponent(fiscalAddress.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } else {
        // create a new address and link to company
        response = await fetchWithAuth('/api/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            link_doctype: 'Company',
            link_name: activeCompanyFromContext
          })
        })
      }

      if (response && response.ok) {
        showNotification('Dirección fiscal guardada correctamente', 'success')
        fetchCompanyAddresses()
        setEditingFiscalAddress(false)
      } else {
        console.error('Error saving fiscal address:', response)
        showNotification('Error al guardar dirección fiscal', 'error')
      }
    } catch (error) {
      console.error('Error saving fiscal address:', error)
      showNotification('Error al guardar dirección fiscal', 'error')
    } finally {
      setLoadingAddresses(false)
    }
  }

  const handleFiscalAddressInputChange = (field, value) => {
    setFiscalAddressForm(prev => ({
      ...prev,
      [field]: value
    }))
  }

  // Función para iniciar la edición
  const startEditing = (company) => {
    console.log('Edit button clicked, activeCompanyFromContext:', activeCompanyFromContext)
    setEditingCompany(activeCompanyFromContext)
    setEditedData({
      company_name: activeCompanyDetails?.company_name || '',
      country: activeCompanyDetails?.country || '',
      default_currency: activeCompanyDetails?.default_currency || '',
      phone_no: activeCompanyDetails?.phone_no || '',
      registration_details: activeCompanyDetails?.registration_details || '',
      personeria: activeCompanyDetails?.custom_personeria || ''
    })

    // Inicializar el query de búsqueda de moneda
    if (activeCompanyDetails?.default_currency && availableCurrencies.length > 0) {
      const selectedCurrency = availableCurrencies.find(c => c.name === activeCompanyDetails.default_currency)
      if (selectedCurrency) {
        setCurrencySearchQuery(`${selectedCurrency.currency_name} (${selectedCurrency.symbol || selectedCurrency.name})`)
      } else {
        setCurrencySearchQuery('')
      }
    } else {
      setCurrencySearchQuery('')
    }
  }

  // Función para cancelar la edición
  const cancelEditing = () => {
    setEditingCompany(null)
    setEditedData({})
    setCurrencySearchQuery('')
    setCurrencySearchResults([])
    setShowCurrencyDropdown(false)
  }

  // Función para manejar cambios en los campos de edición
  const handleEditChange = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }))
  }

  // Función para verificar si hay cambios
  const hasChanges = () => {
    if (!activeCompanyDetails) return false

    return (
      editedData.company_name !== (activeCompanyDetails.company_name || '') ||
      editedData.country !== (activeCompanyDetails.country || '') ||
      editedData.default_currency !== (activeCompanyDetails.default_currency || '') ||
      editedData.phone_no !== (activeCompanyDetails.phone_no || '') ||
      editedData.personeria !== (activeCompanyDetails.custom_personeria || '')
    )
  }

  // Función para guardar los cambios
  const saveChanges = async () => {
    if (!activeCompanyFromContext || !hasChanges()) return

    try {
      setSaving(true)
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: editedData }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Empresa actualizada exitosamente', 'success')
          setEditingCompany(null)
          setEditedData({})
          // Recargar detalles de la empresa
          const updatedDetails = await fetchCompanyDetails(activeCompanyFromContext)
          setActiveCompanyDetails(updatedDetails)
          refreshCompanies()
        } else {
          showNotification('Error al actualizar empresa', 'error')
        }
      } else {
        showNotification('Error al actualizar empresa', 'error')
      }
    } catch (error) {
      console.error('Error updating company:', error)
      showNotification('Error al actualizar empresa', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Función para abrir el modal de eliminación de empresa
  const openDeleteCompanyModal = (companyName) => {
    setCompanyToDelete(companyName)
    setShowDeleteCompanyModal(true)
  }

  // Función callback cuando se elimina la compañía exitosamente
  const handleCompanyDeleted = () => {
    setActiveCompanyDetails(null)
    refreshCompanies()
    fetchCompanies()
    setShowDeleteCompanyModal(false)
    setCompanyToDelete(null)
  }

  

  return (
    <div className="space-y-6">
      {/* Header */}
  <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Empresa Activa</h2>
            <p className="text-gray-600 font-medium">Información de la empresa actualmente seleccionada</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (typeof onAddCompanyClick === 'function') {
              onAddCompanyClick()
            } else {
              console.log('No onAddCompanyClick handler provided')
            }
          }}
          className="btn-manage-addresses"
        >
          <Plus className="w-4 h-4" />
          Agregar Empresa
        </button>
      </div>

      {/* Empresa creación / success messages are shown by the parent */}

      {/* Active Company Card */}
      {activeCompanyFromContext ? (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
          {editingCompany === activeCompanyFromContext ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Nombre (ID):</label>
                  <div className="flex items-center space-x-2">
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.name || activeCompanyFromContext || 'No disponible'}</p>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">No editable</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Razón Social:</label>
                  <input
                    type="text"
                    value={editedData.company_name || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, company_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Razón social"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">País:</label>
                  <input
                    type="text"
                    value={editedData.country || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, country: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="País"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Moneda por defecto:</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Buscar moneda..."
                      value={currencySearchQuery}
                      onChange={(e) => handleCurrencySearchChange(e.target.value)}
                      onFocus={() => {
                        setShowCurrencyDropdown(true)
                        if (availableCurrencies.length > 0 && !currencySearchQuery) {
                          setCurrencySearchResults(availableCurrencies.slice(0, 10))
                        }
                      }}
                      onBlur={() => setTimeout(() => setShowCurrencyDropdown(false), 200)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={loadingCurrencies}
                    />
                    {showCurrencyDropdown && currencySearchResults.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto mt-1">
                        {currencySearchResults.map((currency) => (
                          <div
                            key={currency.name}
                            onClick={() => selectCurrency(currency)}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium">{currency.currency_name}</div>
                            <div className="text-xs text-gray-500">{currency.name} {currency.symbol && `(${currency.symbol})`}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {loadingCurrencies && (
                    <p className="text-xs text-gray-500 mt-1">Cargando monedas...</p>
                  )}
                  {availableCurrencies.length === 0 && !loadingCurrencies && (
                    <p className="text-xs text-red-500 mt-1">No se pudieron cargar las monedas</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Teléfono:</label>
                  <input
                    type="tel"
                    value={editedData.phone_no || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, phone_no: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Teléfono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Personería:</label>
                  <select
                    value={editedData.personeria || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, personeria: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Seleccionar personería...</option>
                    <option value="Sociedad Colectiva (SC)">Sociedad Colectiva (SC)</option>
                    <option value="Sociedad en Comandita Simple (SCS)">Sociedad en Comandita Simple (SCS)</option>
                    <option value="Sociedad de Capital e Industria (SCI)">Sociedad de Capital e Industria (SCI)</option>
                    <option value="Sociedad de Responsabilidad Limitada (S.R.L.)">Sociedad de Responsabilidad Limitada (S.R.L.)</option>
                    <option value="Sociedad Anónima (S.A.)">Sociedad Anónima (S.A.)</option>
                    <option value="Sociedad por Acciones Simplificada (S.A.S.)">Sociedad por Acciones Simplificada (S.A.S.)</option>
                    <option value="Sociedad en Comandita por Acciones (SCA)">Sociedad en Comandita por Acciones (SCA)</option>
                    <option value="Sociedad Anónima Unipersonal (S.A.U.)">Sociedad Anónima Unipersonal (S.A.U.)</option>
                    <option value="Monotributista">Monotributista</option>
                    <option value="Unipersonal">Unipersonal</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-black text-gray-700 mb-1">Detalles de registro:</label>
                  <textarea
                    value={editedData.registration_details || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, registration_details: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Detalles de registro"
                    rows="3"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Fecha de creación:</label>
                  <p className="text-gray-900 font-bold">{activeCompanyDetails?.creation ? new Date(activeCompanyDetails.creation).toLocaleDateString() : 'No disponible'}</p>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Última modificación:</label>
                  <p className="text-gray-900 font-bold">{activeCompanyDetails?.modified ? new Date(activeCompanyDetails.modified).toLocaleDateString() : 'No disponible'}</p>
                </div>
              </div>

              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveChanges}
                  disabled={saving || !hasChanges()}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                >
                  {saving ? (
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
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Nombre (ID):</label>
                    <div className="flex items-center space-x-2">
                      <p className="text-gray-900 font-bold">{activeCompanyDetails?.name || activeCompanyFromContext || 'No disponible'}</p>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">No editable</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Razón Social:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.company_name || activeCompanyDetails?.name || activeCompanyFromContext || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">País:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.country || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Moneda por defecto:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.default_currency || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Teléfono:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.phone_no || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Personería:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_personeria || 'No disponible'}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-black text-gray-700 mb-1">Detalles de registro:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.registration_details || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Fecha de creación:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.creation ? new Date(activeCompanyDetails.creation).toLocaleDateString() : 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Última modificación:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.modified ? new Date(activeCompanyDetails.modified).toLocaleDateString() : 'No disponible'}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={() => {
                    console.log('Edit button clicked, activeCompanyFromContext:', activeCompanyFromContext)
                    startEditing(activeCompanyFromContext)
                  }}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                  title="Editar empresa"
                >
                  <Edit className="w-5 h-5" />
                </button>
                <button
                  onClick={() => openDeleteCompanyModal(activeCompanyFromContext)}
                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                  title="Eliminar empresa"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-center">
          <Building2 className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
          <h3 className="text-lg font-black text-gray-900 mb-2">No hay empresa activa</h3>
          <p className="text-gray-600 mb-4">Selecciona una empresa desde el header para poder configurarla aquí.</p>
          <p className="text-sm text-gray-500">Las empresas se activan desde el selector en la parte superior de la página.</p>
        </div>
      )}

      {/* Sección Direcciones de la Compañía */}
      {activeCompanyFromContext && (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">Direcciones de la Compañía</h3>
                <p className="text-sm text-gray-600 font-medium">Gestiona las direcciones asociadas a la empresa</p>
              </div>
            </div>
            <button
              onClick={() => {
                // delegate opening to parent component to avoid stacking context issues
                if (typeof onRequestOpenCompanyAddresses === 'function') {
                  onRequestOpenCompanyAddresses(activeCompanyFromContext)
                } else {
                  console.log('No onRequestOpenCompanyAddresses handler provided')
                }
              }}
              className="btn-manage-addresses"
              disabled={loadingAddresses}
            >
              <Plus size={16} className="mr-2" />
              Gestionar Direcciones
            </button>
          </div>

          {/* Dirección Fiscal */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-medium text-gray-900">Dirección Fiscal</h4>
              {(() => {
                const fiscalAddress = getCompanyFiscalAddress()
                return fiscalAddress && !editingFiscalAddress ? (
                  <button
                    onClick={handleEditFiscalAddress}
                    className="text-gray-500 hover:text-gray-700 transition-colors p-1"
                    title="Editar dirección fiscal"
                  >
                    <Edit size={18} />
                  </button>
                ) : null
              })()}
            </div>
            {(() => {
              const fiscalAddress = getCompanyFiscalAddress()
              return fiscalAddress && !editingFiscalAddress ? (
                <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                  <div className="flex items-start justify-between mb-2">
                    <h5 className="text-md font-semibold text-gray-900">
                      {fiscalAddress.address_title || 'Dirección Fiscal'}
                    </h5>
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Dirección Fiscal
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-600">Dirección:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {fiscalAddress.address_line1 || 'No especificada'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Ciudad:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {fiscalAddress.city || 'No especificada'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Código Postal:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {fiscalAddress.pincode || 'No especificado'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Provincia:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {fiscalAddress.state || 'No especificada'}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-gray-600">País:</span>
                      <span className="text-gray-900 font-medium ml-2">
                        {fiscalAddress.country || 'Argentina'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h5 className="text-md font-semibold text-gray-900">
                      {editingFiscalAddress ? 'Editar Dirección Fiscal' : 'Dirección Fiscal'}
                    </h5>
                    {editingFiscalAddress && (
                      <button
                        onClick={handleCancelEditFiscalAddress}
                        className="text-gray-500 hover:text-gray-700 transition-colors p-1"
                        title="Cancelar edición"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Dirección Línea 1 *
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.address_line1}
                        onChange={(e) => handleFiscalAddressInputChange('address_line1', e.target.value)}
                        placeholder="Calle, número, piso, departamento"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Dirección Línea 2 (Opcional)
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.address_line2}
                        onChange={(e) => handleFiscalAddressInputChange('address_line2', e.target.value)}
                        placeholder="Referencias adicionales"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Ciudad *
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.city}
                        onChange={(e) => handleFiscalAddressInputChange('city', e.target.value)}
                        placeholder="Ciudad"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Provincia *
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.state}
                        onChange={(e) => handleFiscalAddressInputChange('state', e.target.value)}
                        placeholder="Provincia"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Código Postal
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.pincode}
                        onChange={(e) => handleFiscalAddressInputChange('pincode', e.target.value)}
                        placeholder="Código postal"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        País
                      </label>
                      <input
                        type="text"
                        value={fiscalAddressForm.country}
                        onChange={(e) => handleFiscalAddressInputChange('country', e.target.value)}
                        placeholder="País"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        disabled={loadingAddresses}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
                    {editingFiscalAddress && fiscalAddress && (
                      <button
                        onClick={handleCancelEditFiscalAddress}
                        className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all duration-300"
                        disabled={loadingAddresses}
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      onClick={handleSaveFiscalAddress}
                      disabled={loadingAddresses || !fiscalAddressForm.address_line1 || !fiscalAddressForm.city || !fiscalAddressForm.state}
                      className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all duration-300 hover:scale-105 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                    >
                      <Save size={16} />
                      {loadingAddresses ? 'Guardando...' : (editingFiscalAddress ? 'Actualizar' : 'Guardar Dirección Fiscal')}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Loading State */}
          {loadingAddresses && (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mr-2"></div>
              <span className="text-gray-600">Cargando direcciones...</span>
            </div>
          )}
        </div>
      )}

      {/* No mostrar otras empresas - se activan desde el header */}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
          <div className="text-xl font-bold text-gray-900">Cargando empresas...</div>
        </div>
      )}

      <ConfirmDialog />

      {/* Modal de eliminación de compañía */}
      <DeleteCompanyModal
        isOpen={showDeleteCompanyModal}
        onClose={() => {
          setShowDeleteCompanyModal(false)
          setCompanyToDelete(null)
        }}
        companyName={companyToDelete}
        onCompanyDeleted={handleCompanyDeleted}
      />

      {/* Modal para agregar empresa y Modal de Direcciones de Compañía son renderizados por el componente padre (ConfigurationSettings) */}
    </div>
  )
}

export default CompanyTab