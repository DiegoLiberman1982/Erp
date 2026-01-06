import React, { useState, useContext, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { 
  AlertTriangle, 
  X, 
  Trash2, 
  Link2, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  FileText,
  Building2,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'

/**
 * Modal para el proceso de borrado de compañía con flujo multi-paso:
 * 1. Verificar contraseña del usuario
 * 2. Borrar transacciones (opcional)
 * 3. Verificar links residuales
 * 4. Borrar la compañía
 */
const DeleteCompanyModal = ({ isOpen, onClose, companyName, onCompanyDeleted }) => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification, showSuccess, showError, showWarning } = useNotification()

  // Estados del flujo
  const [currentStep, setCurrentStep] = useState('password') // 'password', 'options', 'processing', 'links', 'complete'
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordVerified, setPasswordVerified] = useState(false)
  
  // Estados de verificación
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isDeletingTransactions, setIsDeletingTransactions] = useState(false)
  const [isCheckingLinks, setIsCheckingLinks] = useState(false)
  const [isDeletingCompany, setIsDeletingCompany] = useState(false)
  const [isDeletingDocs, setIsDeletingDocs] = useState(false)

  // Datos del proceso
  const [deletionStatus, setDeletionStatus] = useState(null)
  const [tdlDetails, setTdlDetails] = useState(null)
  const [isCancelingTdl, setIsCancelingTdl] = useState(false)
  const [linkedDoctypes, setLinkedDoctypes] = useState([])
  const [linkedDocuments, setLinkedDocuments] = useState([])
  const [transactionResult, setTransactionResult] = useState(null)
  const [deleteResult, setDeleteResult] = useState(null)
  const [expandedDoctypes, setExpandedDoctypes] = useState({})

  // Reset states when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('password')
      setPassword('')
      setShowPassword(false)
      setPasswordVerified(false)
      setDeletionStatus(null)
      setLinkedDoctypes([])
      setLinkedDocuments([])
      setTransactionResult(null)
      setDeleteResult(null)
      setExpandedDoctypes({})
    }
  }, [isOpen])

  // Verificar contraseña
  const handleVerifyPassword = async () => {
    if (!password.trim()) {
      showWarning('Por favor ingresa tu contraseña')
      return
    }

    setIsVerifyingPassword(true)
    try {
      const response = await fetchWithAuth('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      if (response.ok) {
        setPasswordVerified(true)
        setCurrentStep('options')
        showSuccess('Contraseña verificada correctamente')
        // Verificar si hay un proceso de borrado corriendo
        checkDeletionStatus()
      } else {
        const data = await response.json()
        showError(data.message || 'Contraseña incorrecta')
      }
    } catch (error) {
      console.error('Error verificando contraseña:', error)
      showError('Error al verificar contraseña')
    } finally {
      setIsVerifyingPassword(false)
    }
  }

  // Verificar estado de borrado de transacciones
  const checkDeletionStatus = async () => {
    setIsCheckingStatus(true)
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/check-deletion-status`, {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        setDeletionStatus(data)
        if (data.is_running) {
          showWarning('Hay un proceso de borrado de transacciones en curso')
        }
        return data
      }
    } catch (error) {
      console.error('Error verificando estado:', error)
    } finally {
      setIsCheckingStatus(false)
    }
    return null
  }

  // Verificar links de la compañía
  const checkCompanyLinks = async () => {
    setIsCheckingLinks(true)
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/check-links`)

      if (response.ok) {
        const data = await response.json()
        setLinkedDoctypes(data.linked_doctypes || [])
        return data.linked_doctypes || []
      }
    } catch (error) {
      console.error('Error verificando links:', error)
    } finally {
      setIsCheckingLinks(false)
    }
    return []
  }

  // Borrar transacciones
  const handleDeleteTransactions = async () => {
    setIsDeletingTransactions(true)
    setCurrentStep('processing')
    
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/delete-transactions`, {
        method: 'POST'
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setTransactionResult({
          success: true,
          message: data.message || 'Solicitud de borrado de transacciones creada',
          tdl_name: data.tdl_name
        })
        showSuccess(data.message || 'Solicitud de borrado de transacciones creada correctamente')
        // Después de crear el TDL, volver a opciones
        setCurrentStep('options')
        // Actualizar estado
        checkDeletionStatus()
      } else {
        // Manejar caso especial: ya existe un TDL
        if (data.already_exists) {
          setDeletionStatus({
            is_running: true,
            deletion_info: {
              tdl_name: data.tdl_name,
              status: data.tdl_status || 'Queued'
            }
          })
          setTransactionResult({
            success: false,
            already_exists: true,
            message: data.message,
            tdl_name: data.tdl_name
          })
          showWarning(data.message || 'Ya existe un proceso de borrado para esta compañía')
        } else {
          setTransactionResult({
            success: false,
            message: data.message || 'Error al crear solicitud de borrado'
          })
          showError(data.message || 'Error al crear solicitud de borrado de transacciones')
        }
        setCurrentStep('options')
      }
    } catch (error) {
      console.error('Error borrando transacciones:', error)
      setTransactionResult({
        success: false,
        message: 'Error de conexión'
      })
      showError('Error al procesar la solicitud')
      setCurrentStep('options')
    } finally {
      setIsDeletingTransactions(false)
    }
  }

  // Obtener detalles de un TDL por nombre
  const fetchTdlDetails = async (tdlName) => {
    if (!tdlName) return null
    try {
      const resp = await fetchWithAuth(`/api/transaction-deletions/${encodeURIComponent(tdlName)}`)
      if (resp.ok) {
        const data = await resp.json()
        if (data.success) {
          setTdlDetails(data.data)
          return data.data
        }
      }
    } catch (err) {
      console.error('Error fetching TDL details', err)
    }
    return null
  }

  // Cancelar un TDL
  const cancelTdl = async (tdlName) => {
    if (!tdlName) return
    const confirmed = window.confirm(`¿Cancelar la solicitud ${tdlName}? Esto detendrá el proceso.`)
    if (!confirmed) return

    setIsCancelingTdl(true)
    try {
      const resp = await fetchWithAuth(`/api/transaction-deletions/${encodeURIComponent(tdlName)}/cancel`, {
        method: 'POST'
      })
      const data = await resp.json()
      if (resp.ok && data.success) {
        showSuccess(data.message || `TDL ${tdlName} cancelado`)
        // refrescar estados
        await checkDeletionStatus()
        await fetchTdlDetails(tdlName)
      } else {
        showError(data.message || 'No se pudo cancelar el TDL')
      }
    } catch (err) {
      console.error('Error canceling TDL', err)
      showError('Error al cancelar TDL')
    } finally {
      setIsCancelingTdl(false)
    }
  }

  // Intentar borrar la compañía
  const handleDeleteCompany = async () => {
    setIsDeletingCompany(true)
    setCurrentStep('processing')

    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/force-delete`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setDeleteResult({
          success: true,
          message: data.message
        })
        showSuccess(`Compañía "${companyName}" eliminada correctamente`)
        setCurrentStep('complete')
        
        // Notificar al componente padre
        if (onCompanyDeleted) {
          onCompanyDeleted()
        }
      } else {
        // Si hay documentos vinculados, mostrar la pantalla de links
        if (data.has_linked_documents && data.linked_documents?.length > 0) {
          setLinkedDocuments(data.linked_documents)
          setCurrentStep('links')
          showWarning('La compañía tiene documentos vinculados que deben ser eliminados primero')
        } else {
          // Verificar links manualmente
          const links = await checkCompanyLinks()
          if (links.length > 0) {
            setCurrentStep('links')
            showWarning('La compañía tiene documentos vinculados')
          } else {
            setDeleteResult({
              success: false,
              message: data.message || 'Error al eliminar la compañía'
            })
            showError(data.message || 'Error al eliminar la compañía')
            setCurrentStep('options')
          }
        }
      }
    } catch (error) {
      console.error('Error borrando compañía:', error)
      showError('Error al procesar la solicitud')
      setCurrentStep('options')
    } finally {
      setIsDeletingCompany(false)
    }
  }

  // Borrar documentos vinculados
  const handleDeleteLinkedDocs = async (doctypes) => {
    setIsDeletingDocs(true)
    
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}/delete-linked-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctypes })
      })

      const data = await response.json()

      if (data.success) {
        showSuccess(data.message || 'Documentos eliminados correctamente')
        // Actualizar la lista de links
        await checkCompanyLinks()
      } else {
        showError(data.message || 'Error al eliminar algunos documentos')
      }
    } catch (error) {
      console.error('Error borrando documentos:', error)
      showError('Error al procesar la solicitud')
    } finally {
      setIsDeletingDocs(false)
    }
  }

  const toggleDoctypeExpand = (doctype) => {
    setExpandedDoctypes(prev => ({
      ...prev,
      [doctype]: !prev[doctype]
    }))
  }

  // Polling: cuando hay un TDL en curso, refrescar estado y detalles periódicamente
  useEffect(() => {
    if (!deletionStatus?.is_running) return

    let timer = null
    const poll = async () => {
      try {
        const data = await checkDeletionStatus()
        // Si hay TDL identificado, obtener detalles
        const tdlName = data?.deletion_info?.tdl_name
        if (tdlName) await fetchTdlDetails(tdlName)

        // Si ya no hay proceso en curso, parar polling
        if (!data?.is_running) {
          clearInterval(timer)
        }
      } catch (err) {
        console.error('Polling TDL error', err)
      }
    }

    // Ejecutar inmediatamente y luego cada 8s
    poll()
    timer = setInterval(poll, 8000)

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [deletionStatus?.is_running])

  // Cuando se detecta un tdl_name en deletionStatus, traer detalles
  useEffect(() => {
    const name = deletionStatus?.deletion_info?.tdl_name || transactionResult?.tdl_name
    if (name) {
      fetchTdlDetails(name)
    }
  }, [deletionStatus?.deletion_info?.tdl_name, transactionResult?.tdl_name])

  if (!isOpen) return null

  const renderPasswordStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Verificar Identidad</h3>
        <p className="text-gray-600">
          Para eliminar la empresa <strong>"{companyName}"</strong>, por favor verifica tu contraseña.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyPassword()}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent pr-12"
              placeholder="Ingresa tu contraseña"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <button onClick={onClose} className="confirm-modal-btn-cancel">
          Cancelar
        </button>
        <button
          onClick={handleVerifyPassword}
          disabled={isVerifyingPassword || !password.trim()}
          className="confirm-modal-btn-confirm error"
        >
          {isVerifyingPassword ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Verificando...
            </>
          ) : (
            'Verificar y Continuar'
          )}
        </button>
      </div>
    </div>
  )

  const renderOptionsStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Eliminar Empresa</h3>
        <p className="text-gray-600">
          Selecciona una opción para eliminar <strong>"{companyName}"</strong>
        </p>
      </div>

      {/* Estado de borrado de transacciones */}
      {deletionStatus?.is_running && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center space-x-2 text-yellow-800">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-medium">Proceso de borrado de transacciones en curso</span>
          </div>
          <p className="text-sm text-yellow-700 mt-1">
            {deletionStatus.deletion_info?.tdl_name && (
              <span className="font-medium">{deletionStatus.deletion_info.tdl_name}</span>
            )}
            {deletionStatus.deletion_info?.status && (
              <span> - Estado: {deletionStatus.deletion_info.status}</span>
            )}
            {!deletionStatus.deletion_info?.tdl_name && (
              <span>Espera a que termine el proceso antes de continuar.</span>
            )}
          </p>
          <p className="text-xs text-yellow-600 mt-2">
            {deletionStatus.deletion_info?.tdl_url ? (
              <a href={deletionStatus.deletion_info.tdl_url} target="_blank" rel="noreferrer" className="underline text-sm text-yellow-700 mr-3">
                Abrir TDL en ERPNext
              </a>
            ) : null}
            Puedes verificar el progreso en ERPNext o esperar a que termine automáticamente.
          </p>
          {/* Si tenemos tdlDetails o tdl name, permitir cancelar */}
          {deletionStatus.deletion_info?.tdl_name && (
            <div className="mt-3 flex items-center space-x-2">
              <span className="text-sm text-yellow-700">TDL: <strong>{deletionStatus.deletion_info.tdl_name}</strong></span>
              <button
                onClick={() => cancelTdl(deletionStatus.deletion_info.tdl_name)}
                disabled={isCancelingTdl}
                className="px-3 py-1 text-xs rounded-xl bg-red-50 text-red-700 border border-red-100 hover:bg-red-100"
              >
                {isCancelingTdl ? 'Cancelando...' : 'Cancelar TDL'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Resultado del borrado de transacciones */}
      {transactionResult && (
        <div className={`rounded-xl p-4 ${
          transactionResult.success 
            ? 'bg-green-50 border border-green-200' 
            : transactionResult.already_exists 
              ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center space-x-2">
            {transactionResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : transactionResult.already_exists ? (
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600" />
            )}
            <span className={`font-medium ${
              transactionResult.success 
                ? 'text-green-800' 
                : transactionResult.already_exists 
                  ? 'text-yellow-800'
                  : 'text-red-800'
            }`}>
              {transactionResult.message}
            </span>
          </div>
          {transactionResult.tdl_name && (
            <div className="mt-2 flex items-center space-x-3">
              <p className={`text-sm mt-1 ${transactionResult.success ? 'text-green-700' : 'text-yellow-700'}`}>
                Documento: {transactionResult.tdl_name}
              </p>
              {transactionResult.tdl_name && (
                <button
                  onClick={() => fetchTdlDetails(transactionResult.tdl_name)}
                  className="px-2 py-1 text-xs rounded-xl bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200"
                >
                  Ver detalles
                </button>
              )}
              {transactionResult.tdl_name && (
                <button
                  onClick={() => cancelTdl(transactionResult.tdl_name)}
                  disabled={isCancelingTdl}
                  className="px-2 py-1 text-xs rounded-xl bg-red-50 text-red-700 border border-red-100 hover:bg-red-100"
                >
                  {isCancelingTdl ? 'Cancelando...' : 'Cancelar'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Opciones de borrado */}
      <div className="space-y-4">
        {/* Opción 1: Borrar transacciones */}
        <div className="border border-gray-200 rounded-xl p-4 hover:border-orange-300 transition-colors">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-orange-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-1">Borrar Transacciones</h4>
              <p className="text-sm text-gray-600 mb-3">
                Crea una solicitud para borrar todas las transacciones (facturas, pagos, asientos, etc.) de la compañía. 
                ERPNext procesará esto en segundo plano.
              </p>
              <button
                onClick={handleDeleteTransactions}
                disabled={isDeletingTransactions || deletionStatus?.is_running}
                className="btn-secondary text-sm"
              >
                {isDeletingTransactions ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Borrar Transacciones
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Opción 2: Borrar compañía (verificar links) */}
        <div className="border border-gray-200 rounded-xl p-4 hover:border-red-300 transition-colors">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Building2 className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-1">Eliminar Compañía</h4>
              <p className="text-sm text-gray-600 mb-3">
                Intenta eliminar la compañía. Si hay documentos vinculados (items, grupos, cuentas, etc.), 
                te mostrará qué queda por borrar.
              </p>
              <button
                onClick={handleDeleteCompany}
                disabled={isDeletingCompany || deletionStatus?.is_running}
                className="confirm-modal-btn-confirm error text-sm"
              >
                {isDeletingCompany ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Eliminar Compañía
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Opción 3: Verificar links primero */}
        <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Link2 className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-1">Verificar Links Residuales</h4>
              <p className="text-sm text-gray-600 mb-3">
                Revisa qué documentos están vinculados a la compañía antes de intentar borrarla.
              </p>
              <button
                onClick={async () => {
                  const links = await checkCompanyLinks()
                  if (links.length > 0) {
                    setCurrentStep('links')
                  } else {
                    showSuccess('No hay documentos vinculados. Puedes eliminar la compañía.')
                  }
                }}
                disabled={isCheckingLinks}
                className="btn-secondary text-sm"
              >
                {isCheckingLinks ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4 mr-2" />
                    Verificar Links
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button onClick={onClose} className="confirm-modal-btn-cancel">
          Cerrar
        </button>
      </div>
    </div>
  )

  const renderLinksStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Link2 className="w-8 h-8 text-orange-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Documentos Vinculados</h3>
        <p className="text-gray-600">
          La compañía <strong>"{companyName}"</strong> tiene los siguientes documentos vinculados:
        </p>
      </div>

      {/* Lista de doctypes vinculados */}
      <div className="max-h-80 overflow-y-auto space-y-2">
        {(linkedDoctypes.length > 0 ? linkedDoctypes : linkedDocuments).map((item, index) => {
          const doctype = item.doctype
          const count = item.count || item.total || (item.items?.length || 0)
          const items = item.items || []
          const isExpanded = expandedDoctypes[doctype]

          return (
            <div key={index} className="border border-gray-200 rounded-xl overflow-hidden">
              <div 
                className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => items.length > 0 && toggleDoctypeExpand(doctype)}
              >
                <div className="flex items-center space-x-3">
                  <FileText className="w-5 h-5 text-gray-500" />
                  <span className="font-medium text-gray-900">{doctype}</span>
                  <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-1 rounded-full">
                    {count} documento{count !== 1 ? 's' : ''}
                  </span>
                </div>
                {items.length > 0 && (
                  isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
              
              {/* Lista expandida de items */}
              {isExpanded && items.length > 0 && (
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-gray-600">
                    {items.slice(0, 9).map((itemName, idx) => (
                      <span key={idx} className="truncate">{itemName}</span>
                    ))}
                    {items.length > 9 && (
                      <span className="text-gray-400">...y {items.length - 9} más</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Acciones */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-yellow-800 font-medium">
              Debes eliminar estos documentos antes de poder borrar la compañía.
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              Puedes usar "Borrar Transacciones" para eliminar facturas y pagos, o eliminar manualmente los items y grupos.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={() => {
            setCurrentStep('options')
            setLinkedDocuments([])
          }}
          className="confirm-modal-btn-cancel"
        >
          ← Volver
        </button>
        <div className="flex space-x-3">
          {tdlDetails && (
            <div className="text-xs text-gray-600 mr-2 flex items-center">
              <div className="mr-2 text-sm">Estado TDL: <strong>{tdlDetails.status || tdlDetails.docstatus}</strong></div>
            </div>
          )}
          <button
            onClick={() => checkCompanyLinks()}
            disabled={isCheckingLinks}
            className="btn-secondary"
          >
            {isCheckingLinks ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Actualizar
          </button>
          <button
            onClick={handleDeleteCompany}
            disabled={isDeletingCompany}
            className="confirm-modal-btn-confirm error"
          >
            {isDeletingCompany ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Reintentar Borrado
          </button>
        </div>
      </div>
    </div>
  )

  const renderProcessingStep = () => (
    <div className="space-y-6">
      <div className="text-center py-8">
        <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-bold text-gray-900 mb-2">Procesando...</h3>
        <p className="text-gray-600">
          Por favor espera mientras se procesa la solicitud.
        </p>
      </div>
    </div>
  )

  const renderCompleteStep = () => (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">¡Compañía Eliminada!</h3>
        <p className="text-gray-600">
          La empresa <strong>"{companyName}"</strong> ha sido eliminada correctamente.
        </p>
      </div>

      <div className="flex justify-center pt-4">
        <button onClick={onClose} className="btn-secondary">
          Cerrar
        </button>
      </div>
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'password':
        return renderPasswordStep()
      case 'options':
        return renderOptionsStep()
      case 'processing':
        return renderProcessingStep()
      case 'links':
        return renderLinksStep()
      case 'complete':
        return renderCompleteStep()
      default:
        return renderPasswordStep()
    }
  }

  const modalContent = (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal-content" style={{ maxWidth: '600px' }}>
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-section">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            <h3 className="confirm-modal-title">Eliminar Empresa</h3>
          </div>
          <button onClick={onClose} className="confirm-modal-close-btn">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="confirm-modal-body">
          {renderCurrentStep()}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default DeleteCompanyModal
