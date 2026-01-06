import React, { useState, useRef, useCallback } from 'react'
import { Minimize2, Maximize2, X } from 'lucide-react'

const PurchaseInvoiceModalContainer = ({
  isOpen,
  onClose,
  title,
  subtitle = '',
  children
}) => {
  const [isMinimized, setIsMinimized] = useState(false)
  const [position, setPosition] = useState({ x: 200, y: 50 })
  const [isDragging, setIsDragging] = useState(false)
  const modalRef = useRef(null)
  const dragRef = useRef({ offsetX: 0, offsetY: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.modal-header') && !e.target.closest('button')) {
      const startX = e.clientX
      const startY = e.clientY
      dragRef.current = {
        offsetX: startX - position.x,
        offsetY: startY - position.y
      }
      setIsDragging(true)
      e.preventDefault()
      e.stopPropagation()
    }
  }, [position])

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !modalRef.current) return
    const newX = e.clientX - dragRef.current.offsetX
    const newY = e.clientY - dragRef.current.offsetY
    const maxX = window.innerWidth - modalRef.current.offsetWidth
    const maxY = window.innerHeight - modalRef.current.offsetHeight
    const clampedX = Math.max(0, Math.min(newX, maxX))
    const clampedY = Math.max(0, Math.min(newY, maxY))
    setPosition({ x: clampedX, y: clampedY })
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  if (!isOpen) return null

  const modalClasses = 'w-11/12 max-w-[1400px] h-auto max-h-[90vh]'

  return (
    <>
      <div className="fixed inset-0 bg-black/10 z-40" style={{ pointerEvents: 'none' }} />
      <div
        ref={modalRef}
        className={`fixed bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl z-50 flex flex-col transition-all duration-300 pointer-events-auto ${isMinimized ? 'w-80 h-16' : modalClasses}`}
        style={{ top: 0, left: 0, transform: `translate(${position.x}px, ${position.y}px)`, willChange: isDragging ? 'transform' : 'auto', transition: isDragging ? 'none' : 'transform 0.1s ease-out' }}
      >
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-300/60 modal-header bg-gray-100/90 rounded-t-2xl flex-shrink-0" onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
          <div className="flex items-center space-x-3">
            <div>
              <h3 className="text-lg font-bold text-gray-800">{title}</h3>
              {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={() => setIsMinimized(!isMinimized)} className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 rounded-lg transition-all duration-300" title={isMinimized ? 'Maximizar' : 'Minimizar'}>
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-100/70 rounded-lg transition-all duration-300" title="Cerrar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {!isMinimized && <div className="p-4 overflow-hidden flex-grow">{children}</div>}
      </div>
    </>
  )
}

export default PurchaseInvoiceModalContainer