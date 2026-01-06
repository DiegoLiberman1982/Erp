import React, { useState, useContext, useEffect } from 'react'
import { Save, X, FileText, Link2, Eye, AlertCircle, CheckCircle, Trash2, DollarSign, RefreshCw } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import { mapVoucherTypeToSigla } from '../../utils/comprobantes'

/**
 * ReconciliationModal - Modal para conciliar documentos de ventas o compras
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Si el modal está abierto
 * @param {function} props.onClose - Callback al cerrar
 * @param {string} props.partyType - Tipo de tercero: 'customer' (default) o 'supplier'
 * @param {string} props.party - Nombre del cliente o proveedor
 * @param {string} props.customer - (legacy) Nombre del cliente - si se pasa, se usa como party
 * @param {string} props.company - Nombre de la empresa activa
 */
const ReconciliationModal = ({ isOpen, onClose, partyType = 'customer', party, customer, company }) => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  // Determinar el party a usar (soporte legacy para customer prop)
  const effectiveParty = party || customer
  const isSupplier = partyType === 'supplier'
  const partyLabel = isSupplier ? 'Proveedor' : 'Cliente'

  // Estado de tabs
  const [activeTab, setActiveTab] = useState('pendientes')

  // Estados para Nueva Conciliación
  const [debitDocuments, setDebitDocuments] = useState([]) // Documentos con saldo positivo (facturas)
  const [creditDocuments, setCreditDocuments] = useState([]) // Documentos con saldo negativo (NC, pagos)
  const [selectedDebitDocs, setSelectedDebitDocs] = useState([]) // { voucher_no, amount, outstanding }
  const [selectedCreditDocs, setSelectedCreditDocs] = useState([]) // { voucher_no, amount, outstanding }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Estados para Ver Conciliaciones
  const [reconciliations, setReconciliations] = useState([])
  const [loadingReconciliations, setLoadingReconciliations] = useState(false)
  const [unreconciling, setUnreconciling] = useState(null)
  const [conflictPayments, setConflictPayments] = useState([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingUnreconcileId, setPendingUnreconcileId] = useState(null)
  const [pendingUnreconcileIsSupplier, setPendingUnreconcileIsSupplier] = useState(false)
  // Estados para pestaña Pendientes (selección de docs y conciliación objetivo)
  const [pendingSelectedDebitDocs, setPendingSelectedDebitDocs] = useState([])
  const [pendingSelectedCreditDocs, setPendingSelectedCreditDocs] = useState([])
  const [selectedPendingReconciliation, setSelectedPendingReconciliation] = useState(null)

  // Cargar datos cuando se abre el modal
  useEffect(() => {
    if (isOpen && effectiveParty && company) {
      loadDocuments()
      loadReconciliations()
    }
  }, [isOpen, effectiveParty, company])

  // Resetear el formulario cuando cambia de tab o se cierra
  useEffect(() => {
    if (!isOpen) {
      resetForm()
    }
  }, [isOpen])

  // Limpiar selecciones de pestaña pendientes cuando se sale de ella
  useEffect(() => {
    if (activeTab !== 'pendientes') {
      setPendingSelectedDebitDocs([])
      setPendingSelectedCreditDocs([])
      setSelectedPendingReconciliation(null)
    }
  }, [activeTab])

  const resetForm = () => {
    setSelectedDebitDocs([])
    setSelectedCreditDocs([])
    setActiveTab('nueva')
    setPendingSelectedDebitDocs([])
    setPendingSelectedCreditDocs([])
    setSelectedPendingReconciliation(null)
  }

  // Cargar documentos con saldo (positivo y negativo)
  const loadDocuments = async () => {
    setLoading(true)
    try {
      // Usar endpoint diferente según el tipo de party
      const statementsEndpoint = isSupplier
        ? API_ROUTES.supplierStatements(effectiveParty, company)
        : `${API_ROUTES.customerStatements}?customer=${encodeURIComponent(effectiveParty)}&company=${encodeURIComponent(company)}`
      
      const response = await fetchWithAuth(statementsEndpoint)

      if (response.ok) {
        const data = await response.json()
        const pendingInvoices = data.pending_invoices || []

        // Además, obtener conciliaciones actuales para evitar mostrar movimientos que ya participan
        // en alguna conciliación (incluso si el pago no tiene el campo custom_conciliation_id)
        const reconciliationsEndpoint = isSupplier
          ? API_ROUTES.supplierReconciliations(effectiveParty, company)
          : API_ROUTES.customerReconciliations(effectiveParty, company)
        let assignedVoucherSet = new Set()
        try {
          const recResp = await fetchWithAuth(reconciliationsEndpoint)
          if (recResp.ok) {
            const recData = await recResp.json()
            (recData.data || []).forEach(r => (r.documents || []).forEach(d => assignedVoucherSet.add(d.voucher_no)))
          }
        } catch (e) {
          // Si falla, no bloquear la carga de documentos
          console.warn('No se pudo cargar conciliaciones para filtrar documentos:', e)
        }

        // Filtrar documentos con saldo positivo (débito - facturas pendientes)
        // Excluir movimientos que ya tengan una conciliación asignada (no aparecen en "Nueva Conciliación")
        const debits = pendingInvoices.filter(
          (s) => parseFloat(s.outstanding_amount || 0) > 0 && !s.custom_conciliation_id && !assignedVoucherSet.has(s.name)
        ).map(s => {
          // Lógica especial para determinar el tipo de comprobante
          let voucher_type = s.voucher_type
          if (!voucher_type) {
            if (s.is_return) {
              voucher_type = isSupplier ? 'Nota de Débito' : 'Nota de Crédito'
            } else if (s.name && (s.name.includes('NDB') || s.name.includes('NDC'))) {
              voucher_type = isSupplier ? 'Nota de Crédito' : 'Nota de Débito'
            } else {
              voucher_type = 'Factura'
            }
          }
          const docType = s.doctype || (isSupplier ? 'Purchase Invoice' : 'Sales Invoice')
          return {
            voucher_no: s.name,
            posting_date: s.posting_date,
            voucher_type: voucher_type,
            grand_total: Math.abs(parseFloat(s.grand_total || 0)),
            outstanding_amount: parseFloat(s.outstanding_amount || 0),
            conciliation_id: s.custom_conciliation_id || null,
            doctype: docType
          }
        })

        // Filtrar documentos con saldo negativo (crédito - NC, pagos)
        // Para créditos (pagos / notas) también excluir los ya conciliados
        const credits = pendingInvoices.filter(
          (s) => parseFloat(s.outstanding_amount || 0) < 0 && !s.custom_conciliation_id && !assignedVoucherSet.has(s.name)
        ).map(s => {
          // Lógica especial para determinar el tipo de comprobante
          let voucher_type = s.voucher_type
          if (!voucher_type) {
            if (s.is_return || (s.name && (s.name.includes('NCV') || s.name.includes('NDC')))) {
              voucher_type = isSupplier ? 'Nota de Débito' : 'Nota de Crédito'
            } else {
              voucher_type = 'Pago'
            }
          }
          const docType = s.doctype || (isSupplier ? 'Payment Entry' : 'Payment Entry')
          return {
            voucher_no: s.name,
            posting_date: s.posting_date,
            voucher_type: voucher_type,
            grand_total: Math.abs(parseFloat(s.grand_total || 0)),
            outstanding_amount: Math.abs(parseFloat(s.outstanding_amount || 0)),
            conciliation_id: s.custom_conciliation_id || null,
            doctype: docType
          }
        })

        setDebitDocuments(debits)
        setCreditDocuments(credits)
      } else {
        showNotification('Error al cargar documentos', 'error')
      }
    } catch (error) {
      console.error('Error loading documents:', error)
      showNotification('Error al cargar documentos', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Cargar conciliaciones existentes
  const loadReconciliations = async () => {
    setLoadingReconciliations(true)
    try {
      // Usar endpoint diferente según el tipo de party
      const reconciliationsEndpoint = isSupplier
        ? API_ROUTES.supplierReconciliations(effectiveParty, company)
        : API_ROUTES.customerReconciliations(effectiveParty, company)
      
      const response = await fetchWithAuth(reconciliationsEndpoint)

      if (response.ok) {
        const data = await response.json()
        setReconciliations(data.data || [])
      } else {
        console.error('Error loading reconciliations')
      }
    } catch (error) {
      console.error('Error loading reconciliations:', error)
    } finally {
      setLoadingReconciliations(false)
    }
  }

  // Manejar selección/deselección de documento de débito
  const handleToggleDebitDoc = (doc) => {
    const existing = selectedDebitDocs.find(d => d.voucher_no === doc.voucher_no)
    
    if (existing) {
      // Deseleccionar
      setSelectedDebitDocs(selectedDebitDocs.filter(d => d.voucher_no !== doc.voucher_no))
    } else {
      // Seleccionar con el monto del saldo automáticamente
      setSelectedDebitDocs([
        ...selectedDebitDocs,
        {
          voucher_no: doc.voucher_no,
          posting_date: doc.posting_date,
          voucher_type: doc.voucher_type,
          outstanding: doc.outstanding_amount,
          doctype: doc.doctype
        }
      ])
    }
  }

  // Manejar selección/deselección de documento de crédito
  const handleToggleCreditDoc = (doc) => {
    const existing = selectedCreditDocs.find(d => d.voucher_no === doc.voucher_no)
    
    if (existing) {
      // Deseleccionar
      setSelectedCreditDocs(selectedCreditDocs.filter(d => d.voucher_no !== doc.voucher_no))
    } else {
      // Seleccionar con el monto del saldo automáticamente
      setSelectedCreditDocs([
        ...selectedCreditDocs,
        {
          voucher_no: doc.voucher_no,
          posting_date: doc.posting_date,
          voucher_type: doc.voucher_type,
          outstanding: doc.outstanding_amount,
          doctype: doc.doctype
        }
      ])
    }
  }

  // Manejar selección/deselección de documento en pestaña Pendientes (débito)
  const handleTogglePendingDebitDoc = (doc) => {
    const existing = pendingSelectedDebitDocs.find(d => d.voucher_no === doc.voucher_no)
    if (existing) {
      setPendingSelectedDebitDocs(pendingSelectedDebitDocs.filter(d => d.voucher_no !== doc.voucher_no))
    } else {
      setPendingSelectedDebitDocs([
        ...pendingSelectedDebitDocs,
        {
          voucher_no: doc.voucher_no,
          posting_date: doc.posting_date,
          voucher_type: doc.voucher_type,
          outstanding: doc.outstanding_amount,
          doctype: doc.doctype
        }
      ])
    }
  }

  // Manejar selección/deselección de documento en pestaña Pendientes (crédito)
  const handleTogglePendingCreditDoc = (doc) => {
    const existing = pendingSelectedCreditDocs.find(d => d.voucher_no === doc.voucher_no)
    if (existing) {
      setPendingSelectedCreditDocs(pendingSelectedCreditDocs.filter(d => d.voucher_no !== doc.voucher_no))
    } else {
      setPendingSelectedCreditDocs([
        ...pendingSelectedCreditDocs,
        {
          voucher_no: doc.voucher_no,
          posting_date: doc.posting_date,
          voucher_type: doc.voucher_type,
          outstanding: doc.outstanding_amount,
          doctype: doc.doctype
        }
      ])
    }
  }

  // Agregar documentos seleccionados a la conciliación seleccionada
  const handleAddSelectedToPending = async () => {
    if (!selectedPendingReconciliation) {
      showNotification('Seleccione una conciliación de destino', 'error')
      return
    }

    if (pendingSelectedDebitDocs.length === 0 && pendingSelectedCreditDocs.length === 0) {
      showNotification('Seleccione al menos un comprobante para agregar', 'error')
      return
    }

    setSaving(true)
    try {
      const documentsPayload = {
        debit_documents: pendingSelectedDebitDocs.map(d => ({ voucher_no: d.voucher_no, doctype: d.doctype })),
        credit_documents: pendingSelectedCreditDocs.map(d => ({ voucher_no: d.voucher_no, doctype: d.doctype }))
      }

      const payload = isSupplier
        ? {
            supplier: effectiveParty,
            company: company,
            conciliation_id: selectedPendingReconciliation.reconciliation_id,
            ...documentsPayload
          }
        : {
            customer: effectiveParty,
            company: company,
            conciliation_id: selectedPendingReconciliation.reconciliation_id,
            ...documentsPayload
          }

      const reconcileEndpoint = isSupplier
        ? API_ROUTES.supplierReconcileMultiDocument
        : API_ROUTES.reconcileMultiDocument

      const response = await fetchWithAuth(reconcileEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data = await response.json()
        showNotification(data.message || 'Documentos agregados a la conciliación', 'success')
        // Recargar datos
        setPendingSelectedDebitDocs([])
        setPendingSelectedCreditDocs([])
        setSelectedPendingReconciliation(null)
        loadDocuments()
        loadReconciliations()
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al agregar documentos', 'error')
      }
    } catch (error) {
      console.error('Error adding docs to conciliacion:', error)
      showNotification('Error al agregar documentos', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Validar antes de guardar
  const validateReconciliation = () => {
    if (selectedDebitDocs.length === 0 || selectedCreditDocs.length === 0) {
      showNotification('Debe seleccionar documentos de ambos lados', 'error')
      return false
    }

    return true
  }

  // Guardar conciliación
  const handleSaveReconciliation = async () => {
    if (!validateReconciliation()) return

    setSaving(true)
    try {
      // Payload diferente según el tipo de party
      const documentsPayload = [
        ...selectedDebitDocs,
        ...selectedCreditDocs
      ].map((doc) => ({
        voucher_no: doc.voucher_no,
        doctype: doc.doctype
      }))

      const payload = isSupplier
        ? {
            supplier: effectiveParty,
            company: company,
            documents: documentsPayload
          }
        : {
            customer: effectiveParty,
            company: company,
            documents: documentsPayload
          }

      // Usar endpoint diferente según el tipo de party
      const reconcileEndpoint = isSupplier
        ? API_ROUTES.supplierReconcileMultiDocument
        : API_ROUTES.reconcileMultiDocument

      const response = await fetchWithAuth(reconcileEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        showNotification('Conciliación aplicada exitosamente', 'success')
        resetForm()
        // Recargar datos
        loadDocuments()
        loadReconciliations()
        // Cambiar a tab de pendientes
        setActiveTab('pendientes')
      } else {
        const errorData = await response.json()
        showNotification(
          `Error al aplicar conciliación: ${errorData.message || 'Error desconocido'}`,
          'error'
        )
      }
    } catch (error) {
      console.error('Error saving reconciliation:', error)
      showNotification('Error al aplicar conciliación', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Formatear fecha
  const formatDate = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  // Formatear moneda
  const formatCurrency = (amount) => {
    return `$${parseFloat(amount || 0).toFixed(2)}`
  }

  // Función para formatear el número de comprobante según el nuevo formato
  const formatVoucherNumber = (voucherNo) => {
    if (!voucherNo) return voucherNo
    // Ejemplo: "FE-FAC-A-00003-00000001" -> "A 00003 00000001"
    const parts = voucherNo.split('-')
    if (parts.length >= 5) {
      const letra = parts[2] // A
      const numero1 = parts[3] // 00003
      const numero2 = parts[4].substring(0, 8) // 00000001 (solo primeros 8 dígitos)
      return `${letra} ${numero1} ${numero2}`
    }
    return voucherNo // Si no tiene el formato esperado, devolver original
  }

  // Función para mapear tipos de comprobante a siglas
  // Renderizar tabla de documentos
  const renderDocumentTable = (documents, selectedDocs, onToggle, title, type) => {
    return (
      <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden">
        <div className={`p-3 ${type === 'debit' ? 'bg-red-50' : 'bg-green-50'} border-b border-gray-200`}>
          <h3 className="text-sm font-semibold flex items-center">
            <DollarSign className="w-4 h-4 mr-2" />
            {title}
          </h3>
          <p className="text-xs text-gray-600 mt-1">
            {documents.length} documento{documents.length !== 1 ? 's' : ''} disponible{documents.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="overflow-y-auto max-h-96">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Cargando...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No hay documentos disponibles</p>
          ) : (
            <div className="bg-gray-50 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">Nro. Comprobante</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Saldo</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {documents.map((doc) => {
                    const selected = selectedDocs.find(d => d.voucher_no === doc.voucher_no)
                    const isSelected = !!selected

                    return (
                      <tr
                        key={doc.voucher_no}
                        className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggle(doc)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 w-40">{formatVoucherNumber(doc.voucher_no)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {mapVoucherTypeToSigla(doc.voucher_type, { scope: isSupplier ? 'compra' : 'venta' })}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{formatDate(doc.posting_date)}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 font-mono">
                          {formatCurrency(doc.grand_total)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 font-mono">
                          {formatCurrency(doc.outstanding_amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Renderizar tab de Nueva Conciliación
  const renderNuevaConciliacion = () => {
    return (
      <div className="space-y-4">
        {/* Dos tablas lado a lado */}
        <div className="grid grid-cols-2 gap-4">
          {/* Tabla de documentos de débito (facturas) */}
          {renderDocumentTable(
            debitDocuments,
            selectedDebitDocs,
            handleToggleDebitDoc,
            'Documentos con Saldo Positivo (Facturas)',
            'debit'
          )}

          {/* Tabla de documentos de crédito (NC, pagos) */}
          {renderDocumentTable(
            creditDocuments,
            selectedCreditDocs,
            handleToggleCreditDoc,
            'Documentos con Saldo Negativo (NC, Pagos)',
            'credit'
          )}
        </div>

        {/* Resumen de selección */}
        {(selectedDebitDocs.length > 0 || selectedCreditDocs.length > 0) && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gradient-to-r from-blue-50 to-indigo-50">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
              <Link2 className="w-4 h-4 mr-2" />
              Documentos seleccionados
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-white rounded-lg border border-red-200">
                <p className="text-xs text-gray-600 mb-1">Saldo Positivo</p>
                <p className="text-lg font-bold text-red-600">{selectedDebitDocs.length} doc{selectedDebitDocs.length !== 1 ? 's' : ''}</p>
                <div className="mt-2 space-y-1 max-h-32 overflow-auto pr-1">
                  {selectedDebitDocs.map(doc => (
                    <div key={doc.voucher_no} className="text-xs flex items-center justify-between text-gray-700">
                      <span>{formatVoucherNumber(doc.voucher_no)}</span>
                      <span className="font-mono">{formatCurrency(doc.outstanding)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-white rounded-lg border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Saldo Negativo</p>
                <p className="text-lg font-bold text-green-600">{selectedCreditDocs.length} doc{selectedCreditDocs.length !== 1 ? 's' : ''}</p>
                <div className="mt-2 space-y-1 max-h-32 overflow-auto pr-1">
                  {selectedCreditDocs.map(doc => (
                    <div key={doc.voucher_no} className="text-xs flex items-center justify-between text-gray-700">
                      <span>{formatVoucherNumber(doc.voucher_no)}</span>
                      <span className="font-mono">{formatCurrency(doc.outstanding)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveReconciliation}
            disabled={
              selectedDebitDocs.length === 0 ||
              selectedCreditDocs.length === 0 ||
              saving
            }
            className="btn-primary flex items-center"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Guardando...' : 'Aplicar Conciliación'}
          </button>
        </div>
      </div>
    )
  }

  // Renderizar tab de Conciliaciones Pendientes
  const renderConciliacionesPendientes = () => {
    // Two-column layout: left = available docs (no conciliation), right = pending reconciliations
    return (
      <div className="grid grid-cols-2 gap-4">
        {/* Left: documents available to add (same as Nueva Conciliación lists) */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Comprobantes sin conciliación</h3>
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Cargando...</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {renderDocumentTable(debitDocuments, pendingSelectedDebitDocs, handleTogglePendingDebitDoc, 'Documentos con Saldo Positivo (Facturas)', 'debit')}
              {renderDocumentTable(creditDocuments, pendingSelectedCreditDocs, handleTogglePendingCreditDoc, 'Documentos con Saldo Negativo (NC, Pagos)', 'credit')}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => { setPendingSelectedDebitDocs([]); setPendingSelectedCreditDocs([]) }}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Limpiar selección
            </button>
            <button
              onClick={handleAddSelectedToPending}
              disabled={(!pendingSelectedDebitDocs.length && !pendingSelectedCreditDocs.length) || !selectedPendingReconciliation}
              className="btn-primary flex items-center"
            >
              Agregar a conciliación seleccionada
            </button>
          </div>
        </div>

        {/* Right: list of pending reconciliations */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Conciliaciones Pendientes</h3>
          {loadingReconciliations ? (
            <p className="text-sm text-gray-500 text-center py-8">Cargando conciliaciones...</p>
          ) : reconciliations.filter(rec => Math.abs(rec.total_amount || 0) >= 0.02).length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No hay conciliaciones con saldo pendiente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reconciliations.filter(rec => Math.abs(rec.total_amount || 0) >= 0.02).map((rec) => {
                const isSelected = selectedPendingReconciliation && selectedPendingReconciliation.reconciliation_id === rec.reconciliation_id
                return (
                  <div
                    key={rec.reconciliation_id}
                    className={`border rounded-lg p-3 bg-white hover:shadow ${isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
                    onClick={() => setSelectedPendingReconciliation(isSelected ? null : rec)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-medium text-sm flex items-center">
                          <Link2 className="w-4 h-4 mr-2 text-blue-500" />
                          {rec.reconciliation_id}
                        </h4>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(rec.posting_date)} - Total: {formatCurrency(rec.total_amount)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full flex items-center">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Saldo Pendiente
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnreconcile(rec.reconciliation_id) }}
                          disabled={unreconciling === rec.reconciliation_id}
                          className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 transition-colors flex items-center"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          {unreconciling === rec.reconciliation_id ? 'Desconciliando...' : 'Desconciliar'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-2">
                      {/* Mostrar sólo documentos con docstatus === 1 (confirmados) */}
                      {(() => {
                        const confirmedDocs = (rec.documents || []).filter(d => Number(d.docstatus || 0) === 1)
                        return (
                          <>
                            <p className="text-xs font-semibold text-gray-600 mb-2">Documentos conciliados ({confirmedDocs.length}):</p>
                            <div className="grid grid-cols-2 gap-2">
                              {confirmedDocs.map((doc) => (
                                <div key={doc.voucher_no} className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200">
                                  <div>
                                    <p className="text-xs font-medium text-gray-900">{doc.voucher_no}</p>
                                    <p className="text-xs text-gray-500">{doc.voucher_type}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-medium text-gray-900 font-mono">{formatCurrency(doc.amount)}</p>
                                    <p className="text-xs text-gray-500">Saldo: {formatCurrency(doc.outstanding)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}

              {/* Small helper */}
              <div className="text-sm text-gray-600">Haz click en una conciliación para seleccionarla como destino y luego usa el botón "Agregar a conciliación seleccionada" en la izquierda.</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Renderizar tab de Historial de Conciliaciones
  const renderHistorialConciliaciones = () => {
    const completedReconciliations = reconciliations.filter(rec => Math.abs(rec.total_amount || 0) < 0.02)

    return (
      <div className="space-y-4">
        {loadingReconciliations ? (
          <p className="text-sm text-gray-500 text-center py-8">
            Cargando conciliaciones...
          </p>
        ) : completedReconciliations.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No hay conciliaciones completadas</p>
          </div>
        ) : (
          <div className="space-y-4">
            {completedReconciliations.map((rec) => {
              return (
                <div
                  key={rec.reconciliation_id}
                  className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-sm flex items-center">
                        <Link2 className="w-4 h-4 mr-2 text-green-500" />
                        {rec.reconciliation_id}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(rec.posting_date)} - Total: {formatCurrency(rec.total_amount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full flex items-center">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Completada
                      </span>
                      <button
                        onClick={() => handleUnreconcile(rec.reconciliation_id)}
                        disabled={unreconciling === rec.reconciliation_id}
                        className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                      >
                        {unreconciling === rec.reconciliation_id ? 'Desconciliando...' : 'Desconciliar'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2">
                      Documentos conciliados ({rec.documents.length}):
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {rec.documents.map((doc) => (
                        <div
                          key={doc.voucher_no}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
                        >
                          <div>
                            <p className="text-xs font-medium text-gray-900">{doc.voucher_no}</p>
                            <p className="text-xs text-gray-500">{doc.voucher_type}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-gray-900 font-mono">
                              {formatCurrency(doc.amount)}
                            </p>
                            <p className="text-xs text-gray-500">
                              Saldo: {formatCurrency(doc.outstanding)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Función para desconciliar
  const handleUnreconcile = async (conciliationId) => {
    setUnreconciling(conciliationId)
    try {
      const endpoint = isSupplier
        ? `/api/supplier-reconciliations/${encodeURIComponent(conciliationId)}`
        : `/api/reconciliations/${encodeURIComponent(conciliationId)}`

      const response = await fetchWithAuth(endpoint, {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        showNotification(data.message || 'Desconciliación completada', 'success')
        // Recargar conciliaciones
        loadReconciliations()
        // Recargar documentos para actualizar pendientes
        loadDocuments()
      } else {
        const errorData = await response.json().catch(() => ({}))
        // Si el backend indica pagos conflictivos, mostrar modal simple (no demasiada info)
        if (response.status === 409 && errorData.payments && errorData.payments.length > 0) {
          setConflictPayments(errorData.payments)
          setPendingUnreconcileId(conciliationId)
          setPendingUnreconcileIsSupplier(isSupplier)
          setShowConflictModal(true)
        } else {
          showNotification(errorData.message || 'Error al desconciliar', 'error')
        }
      }
    } catch (error) {
      console.error('Error unreconciling:', error)
      showNotification('Error al desconciliar', 'error')
    } finally {
      setUnreconciling(null)
    }
  }

  if (!isOpen) return null

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Conciliación de Documentos"
      subtitle={`${partyLabel}: ${effectiveParty} | Empresa: ${company}`}
      size="xlarge"
    >
      {/* Conflict modal: simple confirmation when payments reference external invoices */}
      {showConflictModal && (
        <Modal
          isOpen={showConflictModal}
          onClose={() => setShowConflictModal(false)}
          title="Pagos vinculados externamente"
          subtitle="Algunos pagos están vinculados a facturas fuera de esta conciliación"
          size="small"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">Se encontraron pagos que están asignados a comprobantes fuera del grupo. ¿Desea desconciliar sólo los documentos seguros?</p>
            <div className="text-sm text-gray-600">
              {conflictPayments.slice(0,5).map(p => (
                <div key={p.name} className="py-1">• {p.name}</div>
              ))}
              {conflictPayments.length > 5 && <div className="py-1">... y {conflictPayments.length - 5} más</div>}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setShowConflictModal(false); setConflictPayments([]); setPendingUnreconcileId(null); }} className="px-3 py-2 rounded border">Cancelar</button>
              <button
                onClick={async () => {
                  setShowConflictModal(false)
                  setUnreconciling(pendingUnreconcileId)
                  try {
                    const forceEndpoint = (pendingUnreconcileIsSupplier ? `/api/supplier-reconciliations/${encodeURIComponent(pendingUnreconcileId)}` : `/api/reconciliations/${encodeURIComponent(pendingUnreconcileId)}`) + '?force=1'
                    const resp2 = await fetchWithAuth(forceEndpoint, { method: 'DELETE' })
                    if (resp2.ok) {
                      const d2 = await resp2.json()
                      showNotification(d2.message || 'Desconciliación parcial completada', 'success')
                      loadReconciliations()
                      loadDocuments()
                    } else {
                      const err2 = await resp2.json().catch(() => ({}))
                      showNotification(err2.message || 'Error al desconciliar', 'error')
                    }
                  } catch (e) {
                    showNotification('Error al desconciliar', 'error')
                  } finally {
                    setUnreconciling(null)
                    setConflictPayments([])
                    setPendingUnreconcileId(null)
                    setPendingUnreconcileIsSupplier(false)
                  }
                }}
                className="px-3 py-2 rounded bg-red-600 text-white"
              >
                Desconciliar sólo seguros
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="tab-nav">
          <button
            onClick={() => setActiveTab('nueva')}
            className={`tab-button ${activeTab === 'nueva' ? 'active' : ''}`}
          >
            <Link2 className="w-4 h-4" />
            Nueva Conciliación
          </button>
          <button
            onClick={() => setActiveTab('pendientes')}
            className={`tab-button ${activeTab === 'pendientes' ? 'active' : ''}`}
          >
            Conciliaciones Pendientes
            {activeTab === 'pendientes' && (
              <RefreshCw 
                className="w-4 h-4 ml-2 cursor-pointer" 
                onClick={(e) => { e.stopPropagation(); loadReconciliations(); }} 
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`tab-button ${activeTab === 'historial' ? 'active' : ''}`}
          >
            Historial de Conciliaciones
            {activeTab === 'historial' && (
              <RefreshCw 
                className="w-4 h-4 ml-2 cursor-pointer" 
                onClick={(e) => { e.stopPropagation(); loadReconciliations(); }} 
              />
            )}
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="p-6 overflow-y-auto">
        {activeTab === 'nueva' ? renderNuevaConciliacion() : activeTab === 'pendientes' ? renderConciliacionesPendientes() : renderHistorialConciliaciones()}
      </div>
    </Modal>
  )
}

export default ReconciliationModal
