import React, { useState, useEffect, useContext, forwardRef, useImperativeHandle } from 'react'
import { Building2, Plus, Edit, Save, X, Receipt, Trash2, Ban } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'

const TalonariosTab = forwardRef(function TalonariosTab({ onOpenTalonarioModal }, ref) {
  const [talonarios, setTalonarios] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedTalonario, setSelectedTalonario] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const { fetchWithAuth, activeCompany: activeCompanyFromContext } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  // Cargar talonarios al montar
  useEffect(() => {
    if (activeCompanyFromContext) {
      loadTalonarios()
    }
  }, [activeCompanyFromContext])

  const loadTalonarios = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(`/api/talonarios?compania=${activeCompanyFromContext}`)

      if (response.ok) {
        const data = await response.json()
        console.log('Talonarios data received:', data)
        console.log('First talonario letras:', data.data?.[0]?.letras)
        console.log('First talonario letras type:', typeof data.data?.[0]?.letras)
        if (data.data?.[0]?.letras) {
          console.log('First talonario letras content:', JSON.stringify(data.data[0].letras, null, 2))
        }
        setTalonarios(data.data || [])
      } else if (response.status === 417) {
        // DocType no existe o no está configurado
        showNotification('El DocType "Talonario" no está configurado. Ejecute la configuración inicial de AFIP primero.', 'warning')
        setTalonarios([])
      } else {
        showNotification('Error al cargar talonarios', 'error')
      }
    } catch (error) {
      console.error('Error loading talonarios:', error)
      showNotification('Error de conexión', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectTalonario = (talonario) => {
    onOpenTalonarioModal(talonario)
  }

  const handleCreateNew = () => {
    onOpenTalonarioModal()
  }

  const handleDeleteTalonario = async (talonarioName) => {
    const confirmed = await confirm({
      title: 'Confirmar eliminación',
      message: `¿Está seguro de que desea eliminar el talonario "${talonarioName}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })

    if (!confirmed) {
      return
    }

    try {
      setLoading(true)
      const response = await fetchWithAuth(`/api/talonarios/${talonarioName}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        showNotification(data.message, 'success')
        loadTalonarios() // Recargar la lista
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error eliminando talonario', 'error')
      }
    } catch (error) {
      console.error('Error deleting talonario:', error)
      showNotification('Error de conexión', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDisableTalonario = async (talonario) => {
    if (!talonario?.name || talonario.docstatus === 2) return

    const confirmed = await confirm({
      title: 'Deshabilitar talonario',
      message: `El talonario "${talonario.descripcion || talonario.name}" se cancelará y no podrá usarse para emitir documentos. ¿Continuar?`,
      confirmText: 'Deshabilitar',
      cancelText: 'Cancelar',
      type: 'warning'
    })

    if (!confirmed) return

    try {
      setLoading(true)
      const response = await fetchWithAuth(`/api/talonarios/${talonario.name}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ docstatus: 2 })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        showNotification(payload.message || 'No se pudo deshabilitar el talonario', 'error')
        return
      }

      showNotification(payload.message || 'Talonario deshabilitado correctamente', 'success')
      loadTalonarios()
    } catch (error) {
      console.error('Error disabling talonario:', error)
      showNotification('Error de conexión al deshabilitar el talonario', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 'estado' badge column removed — docstatus still used by buttons (disable)

  // Exponer la función loadTalonarios para que pueda ser llamada desde el padre
  useImperativeHandle(ref, () => ({
    refreshTalonarios: loadTalonarios
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-600">Cargando talonarios...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Gestión de Talonarios</h3>
          <p className="text-gray-600">Administra los talonarios de facturación de la empresa</p>
        </div>
        <button
          onClick={handleCreateNew}
          className="btn-manage-addresses flex items-center"
          disabled={!activeCompanyFromContext}
        >
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Talonario
        </button>
      </div>

      {!activeCompanyFromContext && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">Debe seleccionar una empresa activa para gestionar talonarios.</p>
        </div>
      )}

      {activeCompanyFromContext && (
        <>
          {/* Lista de Talonarios */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h4 className="text-lg font-semibold text-gray-900">Lista de Talonarios</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo de letras admitidas</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo de Talonario</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Último Número Utilizado</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción Talonario</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Punto de Venta</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Por Defecto</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Factura Electrónica</th>
                      {/* Removed "Estado" column - no longer displayed */}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {talonarios.length === 0 ? (
                    <tr>
                       <td colSpan="8" className="px-6 py-4 text-center text-gray-500">
                        No hay talonarios configurados
                      </td>
                    </tr>
                  ) : (
                    talonarios.map((talonario) => (
                      <tr key={talonario.name} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {talonario.letras ? talonario.letras.map(l => l.letra).join(', ') : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{talonario.tipo_de_talonario || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{talonario.ultimo_numero_utilizado || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{talonario.descripcion || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{talonario.punto_de_venta || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {talonario.por_defecto ? 'Sí' : 'No'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {talonario.factura_electronica ? 'Sí' : 'No'}
                        </td>
                        {/* Estado column removed from rows */}
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex flex-col space-y-2">
                            <button
                              onClick={() => handleSelectTalonario(talonario)}
                              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                              title="Editar talonario"
                            >
                              <Edit className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDisableTalonario(talonario)}
                              className={`p-2 rounded-xl transition-all duration-300 ${talonario.docstatus === 2
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-amber-600 hover:text-amber-800 hover:bg-amber-100/80'}`}
                              title={talonario.docstatus === 2 ? 'Talonario deshabilitado' : 'Deshabilitar talonario'}
                              disabled={talonario.docstatus === 2}
                            >
                              <Ban className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTalonario(talonario.name)}
                              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                              title="Eliminar talonario"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* Paginación simple */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Mostrando 1 - {talonarios.length} de {talonarios.length}
              </div>
              <div className="text-sm text-gray-700">
                Página 1 de 1
              </div>
            </div>
          </div>
        </>
      )}
      <ConfirmDialog />
    </div>
  )
})

TalonariosTab.displayName = 'TalonariosTab'

export default TalonariosTab
