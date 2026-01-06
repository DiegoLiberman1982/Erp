import React, { useState, useEffect, useContext, useMemo } from 'react'
import { Search, UserCheck, Building2, CheckCircle2 } from 'lucide-react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import Modal from '../../Modal'

const PartySelector = ({
  isOpen,
  onClose,
  onSelectParty,
  partyType = 'Customer'
}) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showError } = useContext(NotificationContext)

  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedParty, setSelectedParty] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    loadParties()
  }, [isOpen, partyType])

  const sanitizeDisplayName = (rawValue) => {
    if (!rawValue || typeof rawValue !== 'string') return ''
    const normalized = rawValue.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    const [primary] = normalized.split(' - ')
    return primary.trim() || normalized
  }

  const loadParties = async () => {
    setLoading(true)
    try {
      const endpoint = partyType === 'Customer' ? '/api/customers' : '/api/suppliers/'
      const response = await fetchWithAuth(endpoint, {
        method: 'GET',
        headers: { 'X-Active-Company': activeCompany }
      })
      if (!response.ok) {
        showError(`Error al cargar ${partyType === 'Customer' ? 'clientes' : 'proveedores'}`)
        return
      }
      const data = await response.json()
      if (data.success) {
        const normalizedList = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.suppliers)
            ? data.suppliers
            : []
        setParties(normalizedList)
      }
    } catch (error) {
      console.error('Error loading parties:', error)
      showError('Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  const filteredParties = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    if (!search) return parties
    return parties.filter((party) => {
      const displayName = sanitizeDisplayName(party.customer_name || party.supplier_name || party.name).toLowerCase()
      return displayName.includes(search)
    })
  }, [parties, searchTerm])

  const handleConfirm = () => {
    if (selectedParty) {
      onSelectParty(selectedParty)
      onClose()
    }
  }

  if (!isOpen) return null

  const Icon = partyType === 'Customer' ? UserCheck : Building2
  const title = partyType === 'Customer' ? 'Seleccionar Cliente' : 'Seleccionar Proveedor'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Icon className="w-4 h-4 text-violet-600" />
          <span>Busca y selecciona {partyType === 'Customer' ? 'un cliente' : 'un proveedor'} para continuar.</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={`Buscar ${partyType === 'Customer' ? 'cliente' : 'proveedor'}...`}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
          />
        </div>

        <div className="max-h-80 overflow-y-auto space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Cargando...</div>
          ) : filteredParties.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No encontramos {partyType === 'Customer' ? 'clientes' : 'proveedores'} con ese criterio.
            </div>
          ) : (
            filteredParties.map((party) => {
              const displayName = sanitizeDisplayName(party.customer_name || party.supplier_name || party.name)
              const isSelected = selectedParty?.name === party.name
              return (
                <button
                  key={party.name}
                  type="button"
                  onClick={() => setSelectedParty(party)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition ${
                    isSelected
                      ? 'border-violet-500 bg-violet-50'
                      : 'border-gray-200 hover:border-violet-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-gray-900 truncate">{displayName}</div>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 bg-violet-100 px-2 py-1 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Seleccionado
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:text-gray-800 hover:border-gray-400"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleConfirm}
            disabled={!selectedParty}
          >
            Confirmar
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default PartySelector
