import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'
import { X, Plus, Edit, Trash2, Save, MapPin, Building, Warehouse, Truck, Home, Star } from 'lucide-react'
import Modal from '../Modal'

export default function CompanyAddressModal({ isOpen, onClose, companyName, onSave }) {
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingAddress, setEditingAddress] = useState(null)
  const [companyAbbr, setCompanyAbbr] = useState('')
  const [formData, setFormData] = useState({
    address_title: '',
    address_type: 'Billing',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'Argentina',
    custom_type: '',
    is_primary: false
  })

  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()

  // Tipos de direcciones disponibles
  const addressTypes = [
    { value: 'Billing', label: 'Dirección Fiscal', icon: Star },
    { value: 'Shipping', label: 'Dirección de Envío', icon: Truck },
    { value: 'Office', label: 'Dirección de Oficina', icon: Building },
    { value: 'Warehouse', label: 'Dirección de Depósito', icon: Warehouse },
    { value: 'Branch', label: 'Sucursal', icon: MapPin },
    { value: 'Home', label: 'Dirección Particular', icon: Home },
    { value: 'Other', label: 'Otra', icon: MapPin }
  ]

  // Función para verificar si ya existe una dirección fiscal
  const hasFiscalAddress = () => {
    return addresses.some(address => {
      const type = (address.address_type || '').toString().trim()
      const custom = (address.custom_type || '').toString().trim().toLowerCase()
      return (
        type.toLowerCase() === 'billing' ||
        type === 'Dirección Fiscal' ||
        (type.toLowerCase() === 'other' && custom === 'fiscal')
      )
    })
  }

  // Filtrar tipos de dirección disponibles (excluir Dirección Fiscal si ya existe)
  const getAvailableAddressTypes = () => {
    const fiscalExists = hasFiscalAddress()

    // Si estamos editando una dirección fiscal existente, incluir todas las opciones (permitir ver/modificar)
    if (editingAddress) {
      const type = (editingAddress.address_type || '').toString().trim()
      const custom = (editingAddress.custom_type || '').toString().trim().toLowerCase()
      const editingIsFiscal = (
        type.toLowerCase() === 'billing' ||
        type === 'Dirección Fiscal' ||
        (type.toLowerCase() === 'other' && custom === 'fiscal')
      )
      if (editingIsFiscal) return addressTypes
    }

    // Si no existe dirección fiscal, incluir todos los tipos
    if (!fiscalExists) return addressTypes

    // Si ya existe dirección fiscal, excluir "Billing" (Dirección Fiscal) del selector para evitar duplicados
    return addressTypes.filter(type => type.value.toLowerCase() !== 'billing')
  }

  // Cargar direcciones de la compañía y obtener abreviatura
  useEffect(() => {
    if (isOpen && companyName) {
      fetchAddresses()
      fetchCompanyAbbr()
    }
  }, [isOpen, companyName])

  // Obtener la abreviatura de la compañía
  const fetchCompanyAbbr = async () => {
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/abbr`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.abbr) {
          setCompanyAbbr(data.abbr)
          console.log('Company abbr loaded:', data.abbr)
        }
      }
    } catch (error) {
      console.error('Error fetching company abbr:', error)
    }
  }

  const fetchAddresses = async () => {
    try {
      setLoading(true)
      const url = `/api/companies/${encodeURIComponent(companyName)}/addresses`
      console.log('Fetching company addresses from URL:', url)

      const response = await fetchWithAuth(url)
      console.log('Response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        console.log('Response data:', data)
        if (data.success) {
          setAddresses(data.data || [])
          console.log('Company addresses loaded:', data.data?.length || 0)
        }
      } else {
        console.error('Error fetching company addresses:', response.status)
      }
    } catch (error) {
      console.error('Error fetching company addresses:', error)
      showNotification('Error al cargar direcciones de la compañía', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const resetForm = () => {
    const fiscalExists = hasFiscalAddress()
    const available = getAvailableAddressTypes()
    const defaultType = available && available.length > 0 ? available[0].value : (fiscalExists ? 'Shipping' : 'Billing')

    setFormData({
      address_title: '',
      address_type: defaultType,
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'Argentina',
      custom_type: '',
      is_primary: false
    })
    setIsEditing(false)
    setEditingAddress(null)
  }

  const handleAddAddress = () => {
    resetForm()
    // Asegurarse que el tipo seleccionado por defecto sea una opción disponible
    const available = getAvailableAddressTypes()
    if (available && available.length > 0) {
      setFormData(prev => ({ ...prev, address_type: available[0].value }))
    }
    setIsEditing(true)
  }

  const handleEditAddress = (address) => {
    // Al editar, quitar el sufijo de abbr del título si existe
    let cleanTitle = address.address_title || ''
    if (companyAbbr && cleanTitle.endsWith(` - ${companyAbbr}`)) {
      cleanTitle = cleanTitle.slice(0, -(` - ${companyAbbr}`.length))
    }

    setFormData({
      address_title: cleanTitle,
      address_type: address.address_type || 'Billing',
      address_line1: address.address_line1 || '',
      address_line2: address.address_line2 || '',
      city: address.city || '',
      state: address.state || '',
      pincode: address.pincode || '',
      country: address.country || 'Argentina',
      custom_type: address.custom_type || '',
      is_primary: address.is_primary || false
    })
    setEditingAddress(address)
    setIsEditing(true)
  }

  const handleSaveAddress = async () => {
    try {
      setLoading(true)

      // Validar que no se cree una segunda dirección fiscal
      if (!editingAddress && (formData.address_type === 'Billing' ||
          (formData.address_type === 'Other' && formData.custom_type === 'Fiscal'))) {
        const fiscalExists = hasFiscalAddress()
        if (fiscalExists) {
          showNotification('Ya existe una dirección fiscal para esta compañía. No se puede crear otra.', 'error')
          return
        }
      }

      // Preparar datos para enviar
      const addressData = {
        ...formData,
        link_doctype: 'Company',
        link_name: companyName
      }

      // Determinar el título base de la dirección
      let baseTitle = formData.address_title
      if (formData.address_type === 'Other' && formData.custom_type) {
        baseTitle = formData.custom_type
      } else if (!baseTitle) {
        // Si no hay título, usar el label del tipo de dirección
        const typeConfig = addressTypes.find(t => t.value === formData.address_type)
        baseTitle = typeConfig ? typeConfig.label : formData.address_type
      }

      // Agregar la abreviatura de la compañía al título (si existe y no está ya incluida)
      if (companyAbbr && !baseTitle.endsWith(` - ${companyAbbr}`)) {
        addressData.address_title = `${baseTitle} - ${companyAbbr}`
      } else {
        addressData.address_title = baseTitle
      }

      let response
      if (editingAddress) {
        // Actualizar dirección existente
        response = await fetchWithAuth(`/api/addresses/${encodeURIComponent(editingAddress.name)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(addressData),
        })
      } else {
        // Crear nueva dirección
        response = await fetchWithAuth('/api/addresses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(addressData),
        })
      }

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(
            editingAddress ? 'Dirección actualizada exitosamente' : 'Dirección creada exitosamente',
            'success'
          )
          fetchAddresses() // Recargar direcciones
          resetForm()

          // Llamar al callback onSave si existe
          if (onSave) {
            onSave(addressData)
          }
        } else {
          showNotification('Error al guardar dirección', 'error')
        }
      } else {
        showNotification('Error al guardar dirección', 'error')
      }
    } catch (error) {
      console.error('Error saving company address:', error)
      showNotification('Error al guardar dirección', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAddress = async (address) => {
    const confirmed = await confirm({
      title: 'Eliminar Dirección',
      message: `¿Estás seguro de que quieres eliminar la dirección "${address.address_title}"?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'danger'
    })

    if (!confirmed) return

    try {
      setLoading(true)
      const response = await fetchWithAuth(`/api/addresses/${encodeURIComponent(address.name)}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        showNotification('Dirección eliminada exitosamente', 'success')
        fetchAddresses() // Recargar direcciones
      } else {
        showNotification('Error al eliminar dirección', 'error')
      }
    } catch (error) {
      console.error('Error deleting address:', error)
      showNotification('Error al eliminar dirección', 'error')
    } finally {
      setLoading(false)
    }
  }

  const getAddressTypeIcon = (type) => {
    const typeConfig = addressTypes.find(t => t.value === type)
    return typeConfig ? typeConfig.icon : MapPin
  }

  const getAddressTypeLabel = (type, customType) => {
    if (type === 'Other' && customType) {
      return customType
    }
    const typeConfig = addressTypes.find(t => t.value === type)
    return typeConfig ? typeConfig.label : type
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Direcciones - ${companyName}`}
      size="default"
      initialPosition={{ x: 200, y: 50 }}
    >
      {/* Header con botón principal */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-300/60">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Direcciones de la Compañía</h2>
          <p className="text-sm text-gray-600">Gestiona todas las direcciones asociadas</p>
        </div>
        <button
          onClick={handleAddAddress}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
          disabled={loading}
        >
          <Plus size={16} className="mr-2" />
          Agregar Dirección
        </button>
      </div>

      <div className="flex h-full min-h-[500px]">
        {/* Lista de direcciones */}
        <div className="w-1/3 border-r border-gray-300/60 bg-gray-50/50 p-3 overflow-y-auto min-h-[450px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-md font-semibold text-gray-900">Direcciones</h3>
            <button
              onClick={handleAddAddress}
              className="flex items-center gap-1 bg-blue-600 text-white px-2 py-1.5 rounded-md hover:bg-blue-700 transition-all duration-300 hover:scale-105 text-sm"
              disabled={loading}
            >
              <Plus size={14} />
              Agregar
            </button>
          </div>

          {loading && addresses.length === 0 ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Cargando direcciones...</p>
            </div>
          ) : addresses.length === 0 ? (
            <div className="text-center py-6">
              <MapPin size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-3">No hay direcciones registradas</p>
              <button
                onClick={handleAddAddress}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all duration-300 hover:scale-105 mx-auto text-sm font-medium"
              >
                <Plus size={16} />
                Agregar Dirección
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {addresses.map((address) => {
                const IconComponent = getAddressTypeIcon(address.address_type)
                return (
                  <div
                    key={address.name}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-300 ${
                      editingAddress?.name === address.name
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                    }`}
                    onClick={() => handleEditAddress(address)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <IconComponent size={20} className="text-gray-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 truncate">
                            {address.address_title || getAddressTypeLabel(address.address_type, address.custom_type)}
                          </h4>
                          <p className="text-sm text-gray-600 truncate">
                            {address.address_line1 || 'Sin dirección'}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {address.city && address.state ? `${address.city}, ${address.state}` : 'Sin ubicación'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteAddress(address)
                        }}
                        className="text-red-500 hover:text-red-700 p-1 transition-colors"
                        disabled={loading}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Formulario de edición */}
        <div className="flex-1 p-4 overflow-y-auto min-h-[450px]">
          {isEditing ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-semibold text-gray-900">
                  {editingAddress ? 'Editar Dirección' : 'Nueva Dirección'}
                </h3>
                <button
                  onClick={resetForm}
                  className="text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Tipo de dirección */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Dirección
                  </label>
                  <select
                    value={formData.address_type}
                    onChange={(e) => handleInputChange('address_type', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                  >
                    {getAvailableAddressTypes().map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Nombre personalizado (solo para tipo "Other") */}
                {formData.address_type === 'Other' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nombre Personalizado
                    </label>
                    <input
                      type="text"
                      value={formData.custom_type}
                      onChange={(e) => handleInputChange('custom_type', e.target.value)}
                      placeholder="Ej: Sucursal Centro, Depósito Norte"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                )}

                {/* Título de la dirección */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Título de la Dirección
                  </label>
                  <input
                    type="text"
                    value={formData.address_title}
                    onChange={(e) => handleInputChange('address_title', e.target.value)}
                    placeholder="Ej: Oficina Principal, Sucursal Córdoba"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                  />
                </div>

                {/* Dirección línea 1 */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dirección Línea 1
                  </label>
                  <input
                    type="text"
                    value={formData.address_line1}
                    onChange={(e) => handleInputChange('address_line1', e.target.value)}
                    placeholder="Calle, número, piso, departamento"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                  />
                </div>

                {/* Dirección línea 2 */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dirección Línea 2 (Opcional)
                  </label>
                  <input
                    type="text"
                    value={formData.address_line2}
                    onChange={(e) => handleInputChange('address_line2', e.target.value)}
                    placeholder="Referencias adicionales"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                  />
                </div>

                {/* Ciudad */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Ciudad
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>

                {/* Provincia/Estado */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Provincia/Estado
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>

                {/* Código Postal */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Código Postal
                  </label>
                  <input
                    type="text"
                    value={formData.pincode}
                    onChange={(e) => handleInputChange('pincode', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>

                {/* País */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    País
                  </label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={(e) => handleInputChange('country', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Botones */}
              <div className="flex justify-end gap-2 pt-3 border-t border-gray-300/60">
                <button
                  onClick={resetForm}
                  className="px-3 py-1.5 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-all duration-300 text-sm"
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveAddress}
                  disabled={loading}
                  className="btn-manage-addresses"
                >
                  <Save size={14} />
                  {loading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <MapPin size={32} className="text-gray-300 mx-auto mb-3" />
              <h3 className="text-md font-semibold text-gray-900 mb-2">
                Gestiona las direcciones
              </h3>
              <p className="text-gray-500 mb-4 text-sm">
                Selecciona una dirección para editarla o agrega una nueva.
              </p>
              <button
                onClick={handleAddAddress}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all duration-300 hover:scale-105 mx-auto text-sm font-medium"
              >
                <Plus size={16} />
                Nueva Dirección
              </button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </Modal>
  )
}