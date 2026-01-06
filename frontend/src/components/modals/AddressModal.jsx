import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'
import { X, Plus, Edit, Trash2, Save, MapPin, Building, Warehouse, Truck, Home, Star } from 'lucide-react'
import Modal from '../Modal'

export default function AddressModal({ isOpen, onClose, customerName, customerId }) {
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingAddress, setEditingAddress] = useState(null)
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
    return addresses.some(address => 
      address.address_type === 'Billing' || 
      address.address_type === 'Dirección Fiscal' ||
      (address.address_type === 'Other' && address.custom_type === 'Fiscal')
    )
  }

  // Filtrar tipos de dirección disponibles (excluir Dirección Fiscal si ya existe)
  const getAvailableAddressTypes = () => {
    const fiscalExists = hasFiscalAddress()
    
    // Si estamos editando una dirección fiscal existente, incluirla
    if (editingAddress && (editingAddress.address_type === 'Billing' || 
                          editingAddress.address_type === 'Dirección Fiscal' ||
                          (editingAddress.address_type === 'Other' && editingAddress.custom_type === 'Fiscal'))) {
      return addressTypes
    }
    
    // Si no existe dirección fiscal, incluir todos los tipos
    if (!fiscalExists) {
      return addressTypes
    }
    
    // Si ya existe dirección fiscal, excluir "Dirección Fiscal" del selector
    return addressTypes.filter(type => type.value !== 'Billing')
  }

  // Cargar direcciones del cliente
  useEffect(() => {
    if (isOpen && customerName) {
      fetchAddresses()
    }
  }, [isOpen, customerName])

  const fetchAddresses = async () => {
    try {
      setLoading(true)
      const url = `${API_ROUTES.customerAddresses}${encodeURIComponent(customerName)}/addresses`
      console.log('Fetching addresses from URL:', url)

      const response = await fetchWithAuth(url)
      console.log('Response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        console.log('Response data:', data)
        if (data.success) {
          setAddresses(data.data || [])
          console.log('Addresses loaded:', data.data?.length || 0)
        }
      } else {
        console.error('Error fetching addresses:', response.status)
      }
    } catch (error) {
      console.error('Error fetching addresses:', error)
      showNotification('Error al cargar direcciones', 'error')
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
    setFormData({
      address_title: '',
      address_type: fiscalExists ? 'Shipping' : 'Billing',
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
    const fiscalExists = hasFiscalAddress()
    resetForm()
    // Si ya existe dirección fiscal, usar 'Shipping' como tipo por defecto
    setFormData(prev => ({
      ...prev,
      address_type: fiscalExists ? 'Shipping' : 'Billing'
    }))
    setIsEditing(true)
  }

  const handleEditAddress = (address) => {
    setFormData({
      address_title: address.address_title || '',
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
          showNotification('Ya existe una dirección fiscal para este cliente. No se puede crear otra.', 'error')
          return
        }
      }

      // Preparar datos para enviar
      const addressData = {
        ...formData,
        link_doctype: 'Customer',
        link_name: customerName
      }

      // Si es tipo "Other" y tiene custom_type, usar eso como título
      if (formData.address_type === 'Other' && formData.custom_type) {
        addressData.address_title = formData.custom_type
      }

      let response
      if (editingAddress) {
        // Actualizar dirección existente
        response = await fetchWithAuth(`${API_ROUTES.addressDetails}${encodeURIComponent(editingAddress.name)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(addressData),
        })
      } else {
        // Crear nueva dirección
        response = await fetchWithAuth(API_ROUTES.addresses, {
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
        } else {
          showNotification('Error al guardar dirección', 'error')
        }
      } else {
        showNotification('Error al guardar dirección', 'error')
      }
    } catch (error) {
      console.error('Error saving address:', error)
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
      const response = await fetchWithAuth(`${API_ROUTES.addressDetails}${encodeURIComponent(address.name)}`, {
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
      title={`Direcciones - ${customerName}`}
      size="medium"
      initialPosition={{ x: 50, y: 50 }}
    >
      {/* Header con botón principal */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-300/60">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Direcciones del Cliente</h2>
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

      <div className="flex h-full">
        {/* Lista de direcciones */}
        <div className="w-1/3 border-r border-gray-300/60 bg-gray-50/50 p-3 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-md font-semibold text-gray-900">Direcciones</h3>
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
        <div className="flex-1 p-4 overflow-y-auto">
          {isEditing ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-semibold text-gray-900">
                  {editingAddress ? 'Editar Dirección' : 'Nueva Dirección'}
                </h3>
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
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </Modal>
  )
}