import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { useNotification } from '../../../contexts/NotificationContext'
import API_ROUTES from '../../../apiRoutes'
import Modal from '../../Modal'
import { Trash2, Power, PowerOff, AlertTriangle, X } from 'lucide-react'

export default function PurchasePriceListManagementModal({ isOpen, onClose, onListUpdated }) {
  const { showNotification } = useNotification()
  const { fetchWithAuth } = useContext(AuthContext)

  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null) // ID de la lista que se está procesando
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(null)

  // Cargar listas de precios al abrir el modal
  useEffect(() => {
    if (isOpen) {
      loadPurchasePriceLists()
    }
  }, [isOpen])

  const loadPurchasePriceLists = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
      if (response.ok) {
        const data = await response.json()
        setPurchasePriceLists(data.data || [])
      } else {
        showNotification('Error al cargar listas de precios de compra', 'error')
      }
    } catch (error) {
      console.error('Error loading purchase price lists:', error)
      showNotification('Error al cargar listas de precios de compra', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePriceList = async (priceList) => {
    setActionLoading(priceList.name)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceList}${encodeURIComponent(priceList.price_list_name)}`, {
        method: 'DELETE'
      })

      let result = null
      try {
        result = await response.json()
      } catch (parseError) {
        result = null
      }

      const requestSuccessful = response.ok && (result?.success !== false)

      if (requestSuccessful) {
        const successMessage = result?.message || `Lista "${priceList.price_list_name}" eliminada exitosamente`
        showNotification(successMessage, 'success')
        setPurchasePriceLists(prev => prev.filter(list => list.name !== priceList.name))
        setShowDeleteConfirm(null)
        onListUpdated && onListUpdated()
      } else {
        const errorMessage =
          result?.message ||
          (!response.ok ? `Error ${response.status} al eliminar la lista de precios` : 'Error al eliminar la lista de precios')
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error deleting price list:', error)
      showNotification('Error al eliminar la lista de precios', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleStatus = async (priceList, enable) => {
    setActionLoading(priceList.name)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListStatus}${encodeURIComponent(priceList.name)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable })
      })

      if (response.ok) {
        const result = await response.json()
        showNotification(result.message, 'success')

        // Actualizar la lista local
        setPurchasePriceLists(prev => prev.map(list =>
          list.name === priceList.name
            ? { ...list, enabled: enable ? 1 : 0 }
            : list
        ))

        setShowDisableConfirm(null)
        onListUpdated && onListUpdated()
      } else {
        showNotification('Error al cambiar el estado de la lista', 'error')
      }
    } catch (error) {
      console.error('Error toggling price list status:', error)
      showNotification('Error al cambiar el estado de la lista', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gestión de listas de precios de compra"
      subtitle="Administrá el estado de las listas de compra"
      size="lg"
    >
      <div className="space-y-6">
        {/* Lista de precios */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Cargando listas de precios...</p>
            </div>
          ) : purchasePriceLists.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No hay listas de precios disponibles</p>
            </div>
          ) : (
            <div className="space-y-3">
              {purchasePriceLists.map((priceList) => {
                const isEnabled = priceList.enabled === 1
                return (
                  <div
                    key={priceList.name}
                    className={`border border-gray-200 rounded-lg p-4 transition-colors ${
                      isEnabled ? 'bg-white hover:bg-gray-50' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className={`text-lg font-semibold ${isEnabled ? 'text-gray-900' : 'text-gray-600'}`}>
                            {priceList.price_list_name}
                          </h3>
                          <span className={`text-sm font-semibold ${isEnabled ? 'text-green-600' : 'text-gray-500'}`}>
                            {isEnabled ? 'Habilitada' : 'Deshabilitada'}
                          </span>
                        </div>
                        <div className={`mt-1 text-sm ${isEnabled ? 'text-gray-600' : 'text-gray-500'}`}>
                          <span>Moneda: {priceList.currency}</span>
                          {priceList.valid_up_to && (
                            <span className="ml-4">
                              Válida hasta: {new Date(priceList.valid_up_to).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Botón Habilitar/Deshabilitar */}
                        <button
                          onClick={() => {
                            if (!isEnabled) {
                              handleToggleStatus(priceList, true)
                            } else {
                              setShowDisableConfirm(priceList)
                            }
                          }}
                          disabled={actionLoading === priceList.name}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isEnabled
                              ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={isEnabled ? 'Deshabilitar lista' : 'Habilitar lista'}
                        >
                          {actionLoading === priceList.name ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                          ) : isEnabled ? (
                            <PowerOff className="w-4 h-4" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )}
                          {isEnabled ? 'Deshabilitar' : 'Habilitar'}
                        </button>

                        {/* Botón Eliminar */}
                        <button
                          onClick={() => setShowDeleteConfirm(priceList)}
                          disabled={actionLoading === priceList.name}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="Eliminar lista permanentemente"
                        >
                          <Trash2 className="w-4 h-4" />
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal de confirmación para eliminar */}
        {showDeleteConfirm && (
          <div className="confirm-modal-overlay">
            <div className="confirm-modal-content">
              <div className="confirm-modal-header">
                <div className="confirm-modal-title-section">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                  <h3 className="confirm-modal-title">Confirmar Eliminación</h3>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="confirm-modal-close-btn"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="confirm-modal-body">
                <p className="confirm-modal-message">
                  ¿Estás seguro de que deseas eliminar permanentemente la lista de precios de compra
                  <strong> "{showDeleteConfirm.price_list_name}"</strong>?
                  Esta acción eliminará todos los precios asociados y no se puede deshacer.
                </p>
              </div>
              <div className="confirm-modal-footer">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="confirm-modal-btn-cancel"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeletePriceList(showDeleteConfirm)}
                  disabled={actionLoading === showDeleteConfirm.name}
                  className="confirm-modal-btn-confirm error"
                >
                  {actionLoading === showDeleteConfirm.name ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmación para deshabilitar */}
        {showDisableConfirm && (
          <div className="confirm-modal-overlay">
            <div className="confirm-modal-content">
              <div className="confirm-modal-header">
                <div className="confirm-modal-title-section">
                  <PowerOff className="w-6 h-6 text-orange-500" />
                  <h3 className="confirm-modal-title">Deshabilitar lista de precios</h3>
                </div>
                <button
                  onClick={() => setShowDisableConfirm(null)}
                  className="confirm-modal-close-btn"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="confirm-modal-body">
                <p className="confirm-modal-message">
                  ¿Querés deshabilitar la lista de precios de compra
                  <strong> "{showDisableConfirm.price_list_name}"</strong>? Podés volver a habilitarla cuando quieras.
                </p>
              </div>
              <div className="confirm-modal-footer">
                <button
                  onClick={() => setShowDisableConfirm(null)}
                  className="confirm-modal-btn-cancel btn-action-primary"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleToggleStatus(showDisableConfirm, false)}
                  disabled={actionLoading === showDisableConfirm.name}
                  className="confirm-modal-btn-confirm btn-action-danger"
                >
                  {actionLoading === showDisableConfirm.name ? 'Deshabilitando...' : 'Deshabilitar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
