import React, { useEffect, useMemo, useState } from 'react'
import { User, Building, Layers } from 'lucide-react'
import Modal from '../Modal.jsx'

const normalizePartyType = (type = '') => {
  if (type === 'Customer' || type === 'C') return 'C'
  if (type === 'Supplier' || type === 'P') return 'P'
  return ''
}

const stripSuffix = (value = '') => {
  if (!value.includes(' - ')) return value
  return value.slice(0, value.lastIndexOf(' - ')).trim()
}

const buildOptions = (items, labelKey) => {
  return (Array.isArray(items) ? items : []).map((item) => ({
    value: item?.name || item?.[labelKey] || '',
    label: item?.[labelKey] || item?.name || ''
  })).filter(option => option.value && option.label)
}

const JournalEntryLineSettingsModal = ({
  isOpen,
  onClose,
  line,
  lineIndex,
  onSave,
  customers = [],
  suppliers = [],
  costCenters = []
}) => {
  const [values, setValues] = useState({
    party_type: '',
    party: '',
    cost_center: ''
  })

  useEffect(() => {
    if (isOpen && typeof lineIndex === 'number' && line) {
      setValues({
        party_type: normalizePartyType(line.party_type),
        party: line.party || '',
        cost_center: line.cost_center || ''
      })
    } else if (!isOpen) {
      setValues({
        party_type: '',
        party: '',
        cost_center: ''
      })
    }
  }, [isOpen, line, lineIndex])

  const partyOptions = useMemo(() => {
    if (values.party_type === 'C') {
      return buildOptions(customers, 'customer_name')
    }
    if (values.party_type === 'P') {
      return buildOptions(suppliers, 'supplier_name')
    }
    return []
  }, [customers, suppliers, values.party_type])

  const costCenterOptions = useMemo(() => {
    return (Array.isArray(costCenters) ? costCenters : [])
      .filter((item) => Number(item?.is_group) === 0 || item?.is_group === false)
      .map((cc) => ({
        value: cc.name,
        label: cc.cost_center_name || cc.name
      }))
  }, [costCenters])

  const handleSave = () => {
    if (typeof lineIndex !== 'number') return
    onSave?.(lineIndex, {
      party_type: values.party_type,
      party: values.party,
      cost_center: values.cost_center
    })
  }

  const handlePartyTypeChange = (nextType) => {
    setValues((prev) => ({
      ...prev,
      party_type: nextType,
      party: ''
    }))
  }

  const currentAccountLabel = line?.account ? stripSuffix(line.account) : ''

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuraci¢n de la l¡nea"
      subtitle={currentAccountLabel ? `Cuenta: ${currentAccountLabel}` : 'Asignar tercero y centro de costo'}
      size="md"
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="p-4 border border-gray-200 rounded-2xl bg-white/90 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-500" />
              Tipo de tercero
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handlePartyTypeChange('C')}
                className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all ${values.party_type === 'C' ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}
              >
                Cliente
              </button>
              <button
                type="button"
                onClick={() => handlePartyTypeChange('P')}
                className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all ${values.party_type === 'P' ? 'bg-green-600 text-white border-green-600 shadow-lg shadow-green-200' : 'border-gray-300 text-gray-600 hover:border-green-400'}`}
              >
                Proveedor
              </button>
              <button
                type="button"
                onClick={() => handlePartyTypeChange('')}
                className="px-3 py-1.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 transition-all"
              >
                Sin tercero
              </button>
            </div>
            {values.party_type ? (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  {values.party_type === 'C' ? 'Cliente' : 'Proveedor'}
                </label>
                <select
                  value={values.party}
                  onChange={(e) => setValues((prev) => ({ ...prev, party: e.target.value }))}
                  className="w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">Seleccionar...</option>
                  {partyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!values.party && (
                  <p className="text-xs text-gray-500 mt-1">
                    Eleg¡ un tercero para las cuentas por cobrar/pagar.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 mt-4">
                Seleccion  el tipo de tercero para habilitar la lista.
              </p>
            )}
          </div>

          <div className="p-4 border border-gray-200 rounded-2xl bg-white/90 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-500" />
              Centro de costo
            </p>
            <select
              value={values.cost_center}
              onChange={(e) => setValues((prev) => ({ ...prev, cost_center: e.target.value }))}
              className="w-full rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
            >
              <option value="">Sin centro de costo</option>
              {costCenterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              Solo se muestran centros que no son grupos para evitar errores de imputaci¢n.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition-colors"
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default JournalEntryLineSettingsModal
