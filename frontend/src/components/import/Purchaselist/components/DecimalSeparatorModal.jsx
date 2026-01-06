import React, { useEffect, useState } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import Modal from '../../../Modal'

const DECIMAL_OPTIONS = [
  {
    value: 'auto',
    title: 'Detectar automaticamente',
    description: 'Intenta deducir el formato segun cada celda (recomendado si mezclas estilos).',
    sample: '14.25 o 1,250.55',
    helper: 'Usa las heuristicas actuales (puede fallar con "14.000").'
  },
  {
    value: 'comma',
    title: 'Coma decimal',
    description: 'Formato latino: coma como decimal y punto para los miles.',
    sample: '14.000,00 -> 14000.00',
    helper: 'Tambien convierte 14.000 en 14000.'
  },
  {
    value: 'dot',
    title: 'Punto decimal',
    description: 'Formato USA: punto como decimal y coma para los miles.',
    sample: '14,000.00 -> 14000.00',
    helper: '14.5 queda como 14.50.'
  }
]

export default function DecimalSeparatorModal({
  isOpen,
  onClose,
  onConfirm,
  currentSelection = 'auto',
  samples = [],
  detectedSeparator = null
}) {
  const [selection, setSelection] = useState(currentSelection || 'auto')

  useEffect(() => {
    if (isOpen) {
      setSelection(currentSelection || 'auto')
    }
  }, [isOpen, currentSelection])

  const handleConfirm = () => {
    if (!selection) {
      return
    }
    onConfirm(selection)
    onClose()
  }

  if (typeof document === 'undefined') return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Formato de precios pegados"
      subtitle="Elegi como se interpretan los separadores decimales"
      size="small"
    >
      <div className="space-y-4 text-sm text-gray-700">
        {samples.length > 0 && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div className="flex items-center gap-2 text-blue-800 text-xs font-semibold uppercase tracking-wide">
              <Info className="w-4 h-4" />
              Valores detectados
            </div>
            <p className="text-xs text-blue-700 mt-1">Ejemplos recientes:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {samples.slice(0, 4).map((sample, idx) => (
                <span key={`${sample}-${idx}`} className="px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs font-mono">
                  {sample}
                </span>
              ))}
              {samples.length > 4 && (
                <span className="px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs">+{samples.length - 4}</span>
              )}
            </div>
            {detectedSeparator && (
              <p className="text-xs text-blue-700 mt-2">
                Sospechamos que estas usando {detectedSeparator === 'dot' ? 'punto como decimal' : 'coma como decimal'}, confirmalo debajo.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {DECIMAL_OPTIONS.map(option => (
            <label
              key={option.value}
              className={`block border rounded-xl p-3 cursor-pointer transition-all ${
                selection === option.value ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  checked={selection === option.value}
                  onChange={() => setSelection(option.value)}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{option.title}</span>
                    {option.value !== 'auto' && detectedSeparator === option.value && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Sugerido</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{option.description}</p>
                  <p className="text-xs font-mono text-gray-800 mt-1">{option.sample}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{option.helper}</p>
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>Podes cambiar esta preferencia cuando quieras desde la barra superior del importador.</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-mode-selector" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-secondary" onClick={handleConfirm}>
            Aplicar
          </button>
        </div>
      </div>
    </Modal>
  )
}
