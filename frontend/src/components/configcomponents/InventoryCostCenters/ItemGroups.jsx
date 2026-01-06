import React, { useState, useEffect, useContext } from 'react'
import { Plus, Edit, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'

const ItemGroups = ({
  activeCompanyDetails,
  onOpenItemGroupModal,
  itemGroups,
  reloadItemGroups,
  selectedGroups,
  selectedSubGroups,
  handleGroupSelection,
  handleSubGroupSelection,
  handleDeleteItemGroup: propHandleDeleteItemGroup
}) => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  console.log('🚀 ItemGroups COMPONENT MOUNTED/UPDATED')
  console.log('activeCompanyDetails:', activeCompanyDetails)
  console.log('itemGroups prop:', itemGroups)
  console.log('itemGroups length:', itemGroups?.length || 0)

  // Estado para controlar qué grupos están expandidos (inicialmente todos colapsados)
  const [expandedGroups, setExpandedGroups] = useState(new Set())

  // Estado para item groups si no se pasan como props
  const [localItemGroups, setLocalItemGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [itemCounts, setItemCounts] = useState({})

  // Usar itemGroups de props, con fallback a estado local
  const currentItemGroups = itemGroups || localItemGroups

  // Función para alternar expansión de un grupo
  const toggleGroupExpansion = (groupName) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName)
      } else {
        newSet.add(groupName)
      }
      return newSet
    })
  }

  // Función para cargar item groups
  const loadItemGroups = async () => {
    if (!activeCompanyDetails?.name) return

    setLoading(true)
    try {
  // Cargar grupos (pedimos sólo grupos padre para esta vista)
  const response = await fetchWithAuth(`/api/item-groups?custom_company=${activeCompanyDetails.name}&kind=parents`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('📦 RAW ITEM GROUPS DATA:', data.data)
          const groups = data.data || []
          setLocalItemGroups(groups)
          
          // Cargar cantidad de items por grupo
          await loadItemCounts(groups)
        } else {
          showNotification('Error al cargar grupos de items', 'error')
        }
      } else {
        showNotification('Error al cargar grupos de items', 'error')
      }
    } catch (error) {
      console.error('Error loading item groups:', error)
      showNotification('Error al cargar grupos de items', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Función para cargar cantidad de items por grupo
  const loadItemCounts = async (groups) => {
    try {
      // Obtener todos los items para contar por grupo
      const itemsResponse = await fetchWithAuth(`/api/items?custom_company=${activeCompanyDetails.name}&fields=["name","item_group"]&limit=10000`)
      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json()
        if (itemsData.success) {
          const items = itemsData.data || []
          
          // Prepare normalization helper to remove company suffixes
          const abbr = (activeCompanyDetails && activeCompanyDetails.abbr) ? String(activeCompanyDetails.abbr).trim() : ''
          const normalize = (n) => {
            if (!n) return ''
            let s = String(n)
            if (abbr) {
              const suf = ` - ${abbr}`
              if (s.endsWith(suf)) s = s.slice(0, -suf.length)
            }
            // also strip any trailing ' - XX' just in case
            s = s.replace(/\s*-\s*[A-Z]{1,4}\s*$/, '')
            return s.trim()
          }

          // Contar items por grupo directo (normalizando nombres)
          const directCounts = {}
          items.forEach(item => {
            const group = item.item_group
            if (group) {
              const base = normalize(group)
              if (base) directCounts[base] = (directCounts[base] || 0) + 1
            }
          })
          
          // Ensure we have the full groups tree for hierarchical counting.
          let allGroups = groups || []
          // If caller passed only parent groups (no leafs), fetch all groups
          const hasLeafs = allGroups.some(g => Number(g.is_group) === 0)
          if (!hasLeafs) {
            try {
              const allResp = await fetchWithAuth(`/api/item-groups?custom_company=${encodeURIComponent(activeCompanyDetails.name)}`)
              if (allResp.ok) {
                const allData = await allResp.json()
                if (allData.success) allGroups = allData.data || allGroups
              }
            } catch (e) {
              // non-fatal, keep using provided groups
            }
          }

          // Map group name -> normalized base name
          const nameToBase = {}
          allGroups.forEach(g => {
            nameToBase[g.name] = normalize(g.name || g.item_group_name || g.name)
          })

          // Calcular conteos totales recursivos para grupos padre (keys by group.name)
          const totalCounts = {}

          const countItemsInGroup = (groupName) => {
            const base = nameToBase[groupName] || ''
            let count = directCounts[base] || 0
            const subGroups = allGroups.filter(g => g.parent_item_group === groupName)
            subGroups.forEach(subGroup => {
              count += countItemsInGroup(subGroup.name)
            })
            totalCounts[groupName] = count
            return count
          }

          // Calcular para todos los grupos (usar allGroups to include leafs)
          allGroups.forEach(group => {
            if (!(group.name in totalCounts)) countItemsInGroup(group.name)
          })
          
          console.log('📊 DIRECT ITEM COUNTS:', directCounts)
          console.log('📊 TOTAL ITEM COUNTS (recursive):', totalCounts)
          setItemCounts(totalCounts)
        }
      }
    } catch (error) {
      console.error('Error loading item counts:', error)
    }
  }

  // Cargar item groups al montar o cuando cambia la compañía
  useEffect(() => {
    console.log('🔄 useEffect triggered for ItemGroups')
    console.log('itemGroups prop exists:', !!itemGroups)
    console.log('activeCompanyDetails?.name:', activeCompanyDetails?.name)

    if (!itemGroups) {
      console.log('📡 Calling loadItemGroups...')
      loadItemGroups()
    } else {
      console.log('✅ Using itemGroups from props')
      // Si se pasan itemGroups como props, cargar los item counts
      loadItemCounts(itemGroups)
    }
  }, [activeCompanyDetails?.name, itemGroups])

  // Función para recargar item groups
  const handleReloadItemGroups = async () => {
    if (reloadItemGroups) {
      await reloadItemGroups()
      // Recargar también los item counts
      await loadItemCounts(currentItemGroups)
    } else {
      await loadItemGroups()
    }
  }

  // Función para manejar eliminación (placeholder - implementar lógica)
  const handleDeleteItemGroup = async (group) => {
    if (propHandleDeleteItemGroup) {
      await propHandleDeleteItemGroup(group.name || group)
    } else {
      // TODO: Implementar eliminación de grupo de items
      showNotification('Función de eliminación no implementada aún', 'warning')
    }
  }

  return (
    <div className="space-y-6">
      {console.log('🎨 RENDERING ItemGroups component')}
      {console.log('loading:', loading)}
      {console.log('currentItemGroups.length:', currentItemGroups?.length || 0)}

      {/* Lista de grupos */}
      <div className="bg-white rounded-lg border border-gray-200">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2">Cargando grupos de items...</p>
          </div>
        ) : currentItemGroups.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No hay grupos de items configurados para esta compañía.</p>
            <p className="text-sm mt-1">Crea tu primer grupo para organizar tus items.</p>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
            {currentItemGroups && currentItemGroups.length > 0 ? (
              <div className="space-y-2">
                {/* Grupos padre (grupos) */}
                {currentItemGroups.filter(ig => ig.is_group === 1).map((parent) => {
                  const hasChildren = currentItemGroups.filter(ig => ig.parent_item_group === parent.name).length > 0
                  const isExpanded = expandedGroups.has(parent.name)
                  
                  return (
                    <div key={parent.name} className="space-y-1">
                      <div className="flex items-center space-x-2 font-semibold text-gray-800 bg-orange-100 px-3 py-2 rounded">
                        {hasChildren && (
                          <button
                            onClick={() => toggleGroupExpansion(parent.name)}
                            className="p-1 hover:bg-orange-200 rounded transition-colors"
                            title={isExpanded ? "Colapsar" : "Expandir"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-orange-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-orange-600" />
                            )}
                          </button>
                        )}
                        {!hasChildren && <div className="w-6"></div>}
                        <input
                          type="checkbox"
                          checked={selectedGroups?.has(parent.name) || false}
                          onChange={(e) => handleGroupSelection && handleGroupSelection(parent.name, e.target.checked)}
                          className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 focus:ring-2"
                        />
                        <span>📁</span>
                        <span>{parent.item_group_name}</span>
                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded ml-2">
                          {itemCounts[parent.name] || 0} items
                        </span>
                        <div className="flex space-x-1 ml-auto">
                          <button
                            onClick={() => onOpenItemGroupModal(parent)}
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors duration-200"
                            title="Editar grupo de items"
                          >
                            <Edit className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteItemGroup(parent)}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors duration-200"
                            title="Eliminar grupo de items"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {/* Grupos hijos - solo mostrar si está expandido */}
                      {isExpanded && hasChildren && (
                        <div className="ml-6 space-y-1">
                          {currentItemGroups.filter(ig => ig.parent_item_group === parent.name && ig.is_group === 0).map((child) => (
                            <div key={child.name} className="flex items-center space-x-2 text-gray-700 bg-white px-3 py-1 rounded border-l-2 border-orange-200">
                              <input
                                type="checkbox"
                                checked={selectedSubGroups?.has(child.name) || false}
                                onChange={(e) => handleSubGroupSelection && handleSubGroupSelection(child.name, e.target.checked)}
                                className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 focus:ring-2"
                              />
                              <span>📄</span>
                              <span>{child.item_group_name}</span>
                              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded ml-2">
                                {itemCounts[child.name] || 0} items
                              </span>
                              <div className="flex space-x-1 ml-auto">
                                <button
                                  onClick={() => onOpenItemGroupModal(child)}
                                  className="p-1 text-gray-400 hover:text-blue-600 transition-colors duration-200"
                                  title="Editar grupo de items"
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteItemGroup(child)}
                                  className="p-1 text-gray-400 hover:text-red-600 transition-colors duration-200"
                                  title="Eliminar grupo de items"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Grupos sin padre */}
                {currentItemGroups.filter(ig => !ig.parent_item_group && ig.is_group === 0).map((orphan) => (
                  <div key={orphan.name} className="flex items-center space-x-2 text-gray-700 bg-white px-3 py-1 rounded">
                    <input
                      type="checkbox"
                      checked={selectedSubGroups?.has(orphan.name) || false}
                      onChange={(e) => handleSubGroupSelection && handleSubGroupSelection(orphan.name, e.target.checked)}
                      className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 focus:ring-2"
                    />
                    <span>📄</span>
                    <span>{orphan.item_group_name}</span>
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded ml-2">
                      {itemCounts[orphan.name] || 0} items
                    </span>
                    <div className="flex space-x-1 ml-auto">
                      <button
                        onClick={() => onOpenItemGroupModal(orphan)}
                        className="p-1 text-gray-400 hover:text-blue-600 transition-colors duration-200"
                        title="Editar grupo de items"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteItemGroup(orphan)}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors duration-200"
                        title="Eliminar grupo de items"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No hay grupos de items configurados</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ItemGroups