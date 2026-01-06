import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'
import { X, Plus, Edit, Trash2, Save, MapPin, Building, Warehouse, Truck, Home, Star } from 'lucide-react'
import Modal from '../Modal'
import { addCompanyAbbrToSupplier } from '../Supplierpanel/supplierHandlers'

export default function SupplierAddressModal({ isOpen, onClose, supplierName, supplierId }) {
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
    const availableTypes = [...addressTypes]

    if (hasFiscalAddress() && !isEditing) {
      return availableTypes.filter(type => type.value !== 'Billing')
    }

    return availableTypes
  }

  // Cargar direcciones al abrir el modal
  useEffect(() => {
    if (isOpen && supplierName) {
      loadAddresses()
    }
  }, [isOpen, supplierName])

  const loadAddresses = async () => {
    if (!supplierName) return

    try {
      setLoading(true)
      // Agregar sigla de compañía al supplier name para la API
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/addresses`)

      if (response.ok) {
        const data = await response.json()
        setAddresses(data.addresses || [])
      } else {
        showNotification('Error al cargar direcciones', 'error')
      }
    } catch (error) {
      console.error('Error loading addresses:', error)
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
    setFormData({
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
  }

  const handleAddAddress = () => {
    setIsEditing(false)
    setEditingAddress(null)
    resetForm()
    setFormData(prev => ({
      ...prev,
      address_title: `Dirección de ${supplierName}`,
      address_type: hasFiscalAddress() ? 'Shipping' : 'Billing'
    }))
  }

  const handleEditAddress = (address) => {
    setIsEditing(true)
    setEditingAddress(address)
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
  }

  const handleSaveAddress = async () => {
    if (!supplierName) return

    try {
      setLoading(true)

      const addressData = {
        address_title: formData.address_title,
        address_type: formData.address_type,
        address_line1: formData.address_line1,
        address_line2: formData.address_line2,
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
        country: formData.country,
        custom_type: formData.custom_type,
        is_primary: formData.is_primary
      }

      // Agregar sigla de compañía al supplier name para la API
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)

      let response
      if (isEditing && editingAddress) {
        // Actualizar dirección existente
        response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/addresses/${editingAddress.name}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ address: addressData }),
        })
      } else {
        // Crear nueva dirección
        response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/addresses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ address: addressData }),
        })
      }

      if (response.ok) {
        const data = await response.json()
        showNotification(
          isEditing ? 'Dirección actualizada exitosamente' : 'Dirección creada exitosamente',
          'success'
        )
        loadAddresses()
        resetForm()
        setIsEditing(false)
        setEditingAddress(null)
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar dirección', 'error')
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
      // Agregar sigla de compañía al supplier name para la API
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/addresses/${address.name}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        showNotification('Dirección eliminada exitosamente', 'success')
        loadAddresses()
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar dirección', 'error')
      }
    } catch (error) {
      console.error('Error deleting address:', error)
      showNotification('Error al eliminar dirección', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    resetForm()
    setIsEditing(false)
    setEditingAddress(null)
  }

  const getAddressTypeIcon = (addressType) => {
    const type = addressTypes.find(t => t.value === addressType)
    return type ? type.icon : MapPin
  }

  const getAddressTypeLabel = (addressType, customType) => {
    if (addressType === 'Other' && customType) {
      return customType
    }
    const type = addressTypes.find(t => t.value === addressType)
    return type ? type.label : addressType
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Direcciones de ${supplierName}`}>
      <div className="space-y-6">
        {/* Lista de direcciones existentes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Direcciones existentes</h3>
            <button
              onClick={handleAddAddress}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            >
              <Plus className="w-4 h-4 mr-2" />
              Agregar Dirección
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Cargando direcciones...</span>
            </div>
          ) : addresses.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MapPin className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No hay direcciones registradas</p>
              <p className="text-sm mt-2">Haz clic en "Agregar Dirección" para crear la primera</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {addresses.map((address) => {
                const IconComponent = getAddressTypeIcon(address.address_type)
                return (
                  <div key={address.name} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <IconComponent className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{address.address_title}</h4>
                          <p className="text-sm text-gray-600 mb-2">
                            {getAddressTypeLabel(address.address_type, address.custom_type)}
                          </p>
                          <div className="text-sm text-gray-700 space-y-1">
                            {address.address_line1 && <p>{address.address_line1}</p>}
                            {address.address_line2 && <p>{address.address_line2}</p>}
                            <p>
                              {[address.city, address.state, address.pincode].filter(Boolean).join(', ')}
                            </p>
                            {address.country && <p>{address.country}</p>}
                          </div>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEditAddress(address)}
                          className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Editar dirección"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAddress(address)}
                          className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors"
                          title="Eliminar dirección"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Formulario de edición/creación */}
        {(isEditing || editingAddress === null) && (
          <div className="border-t pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {isEditing ? 'Editar Dirección' : 'Nueva Dirección'}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Título de la dirección *
                </label>
                <input
                  type="text"
                  value={formData.address_title}
                  onChange={(e) => handleInputChange('address_title', e.target.value)}
                  placeholder="Ej: Oficina Central, Depósito Norte"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de dirección *
                </label>
                <select
                  value={formData.address_type}
                  onChange={(e) => handleInputChange('address_type', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {getAvailableAddressTypes().map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {formData.address_type === 'Other' && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tipo personalizado
                  </label>
                  <input
                    type="text"
                    value={formData.custom_type}
                    onChange={(e) => handleInputChange('custom_type', e.target.value)}
                    placeholder="Ej: Punto de venta, Centro de distribución"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dirección línea 1 *
                </label>
                <input
                  type="text"
                  value={formData.address_line1}
                  onChange={(e) => handleInputChange('address_line1', e.target.value)}
                  placeholder="Calle, número, piso, departamento"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dirección línea 2
                </label>
                <input
                  type="text"
                  value={formData.address_line2}
                  onChange={(e) => handleInputChange('address_line2', e.target.value)}
                  placeholder="Información adicional (opcional)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ciudad *
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  placeholder="Ciudad"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Provincia/Estado *
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  placeholder="Provincia o Estado"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Código Postal
                </label>
                <input
                  type="text"
                  value={formData.pincode}
                  onChange={(e) => handleInputChange('pincode', e.target.value)}
                  placeholder="Código postal"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  País *
                </label>
                <select
                  value={formData.country}
                  onChange={(e) => handleInputChange('country', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="Argentina">Argentina</option>
                  <option value="Chile">Chile</option>
                  <option value="Uruguay">Uruguay</option>
                  <option value="Paraguay">Paraguay</option>
                  <option value="Bolivia">Bolivia</option>
                  <option value="Brasil">Brasil</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={handleCancel}
                disabled={loading}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAddress}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Guardar Dirección
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </Modal>
  )
}