import React, { useState, useContext, useEffect } from 'react'
import { Check, X, RefreshCw, Settings, FileText, FolderTree, DollarSign, Play, Users, FileCheck, Trash2 } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import useTaxTemplates from '../../hooks/useTaxTemplates'

const InitialConfiguration = () => {
  const [setupStatus, setSetupStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const { fetchWithAuth, activeCompany: activeCompanyFromContext, user } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { templates: taxTemplatesFromHook, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)

  useEffect(() => {
    if (taxTemplatesFromHook && Array.isArray(taxTemplatesFromHook)) {
      setItemTaxTemplates(taxTemplatesFromHook)
    }
  }, [taxTemplatesFromHook])

  // Estados para mostrar configuración existente
  const [availableTaxAccounts, setAvailableTaxAccounts] = useState([])
  const [taxTemplates, setTaxTemplates] = useState([])
  const [itemTaxTemplates, setItemTaxTemplates] = useState([])
  const [companyAccounts, setCompanyAccounts] = useState(null)
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState([])

  // Estados para configuración AFIP
  const [afipDoctypes, setAfipDoctypes] = useState([])
  const [afipRecords, setAfipRecords] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [namingSeries, setNamingSeries] = useState([])
  const [letrasDisponibles, setLetrasDisponibles] = useState([])
  const [tiposComprobanteAfip, setTiposComprobanteAfip] = useState([])

  // Estados para bancos
  const [availableBanks, setAvailableBanks] = useState([])
  const [creatingBanks, setCreatingBanks] = useState(false)

  // Cargar estado de configuración al montar el componente
  useEffect(() => {
    loadSetupStatus()
    loadTaxAccounts()
    loadTaxTemplates()
    loadItemTaxTemplates()
    loadPaymentTermsTemplates()
    loadAfipConfiguration()
    loadBanks()
    if (activeCompanyFromContext) {
      loadCompanyAccounts()
    }
  }, [activeCompanyFromContext])

  const loadSetupStatus = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(API_ROUTES.setupStatus)

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setSetupStatus(data.data)
        } else {
          showNotification('Error al cargar estado de configuración', 'error')
        }
      } else {
        showNotification('Error al conectar con el servidor', 'error')
      }
    } catch (error) {
      console.error('Error loading setup status:', error)
      showNotification('Error de conexión', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadTaxAccounts = async () => {
    try {
      // Buscar cuentas de impuestos a través del backend
      const response = await fetchWithAuth(API_ROUTES.setupTaxAccounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailableTaxAccounts(data.data || [])
          // Aquí podríamos identificar automáticamente las cuentas de débito y crédito fiscal
          // Por ahora, las dejaremos vacías para que el usuario las asigne manualmente
        }
      }
    } catch (error) {
      console.error('Error loading tax accounts:', error)
    }
  }

  const loadPurchaseSalesAccounts = async () => {
    // TODO: Implementar carga de cuentas de compras y ventas desde el backend
    // Por ahora, quedan vacías hasta que se asignen
  }

  const loadTaxTemplates = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.setupTaxTemplates)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setTaxTemplates(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading tax templates:', error)
    }
  }

  const loadItemTaxTemplates = async () => {
    try {
      let templates = taxTemplatesFromHook || []
      if (!templates || templates.length === 0) {
        const loaded = await refreshTaxTemplates()
        templates = (loaded && loaded.templates) || []
      }
      if (templates && templates.length > 0) {
        console.log('Item Tax Templates data:', templates)
        setItemTaxTemplates(templates || [])
      }
    } catch (error) {
      console.error('Error loading item tax templates:', error)
    }
  }

  const loadPaymentTermsTemplates = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.paymentTermsTemplates)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('Payment Terms Templates data:', data.data)
          setPaymentTermsTemplates(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading payment terms templates:', error)
    }
  }

  const loadAfipConfiguration = async () => {
    try {
      // Cargar DocTypes AFIP
      const doctypesResponse = await fetchWithAuth('/api/resource/DocType?filters=[["name","in",["Tipo Comprobante AFIP","Talonario"]]]&fields=["name","module","custom"]')
      if (doctypesResponse.ok) {
        const doctypesData = await doctypesResponse.json()
        setAfipDoctypes(doctypesData.data || [])
      }

      // Cargar registros de Tipo Comprobante AFIP
      const recordsResponse = await fetchWithAuth('/api/resource/Tipo Comprobante AFIP?fields=["name","codigo_afip","descripcion"]')
      if (recordsResponse.ok) {
        const recordsData = await recordsResponse.json()
        setAfipRecords(recordsData.data || [])
      }

      // Cargar tipos de comprobante AFIP disponibles
      const tiposResponse = await fetchWithAuth('/api/resource/Tipo Comprobante AFIP?fields=["name","codigo_afip","descripcion"]&limit=1000')
      if (tiposResponse.ok) {
        const tiposData = await tiposResponse.json()
        setTiposComprobanteAfip(tiposData.data || [])
      }

      // Cargar letras disponibles del DocType Talonario
      const letrasResponse = await fetchWithAuth('/api/resource/DocType/Talonario')
      if (letrasResponse.ok) {
        const letrasData = await letrasResponse.json()
        // Extraer las opciones del campo 'letra'
        const letraField = letrasData.data?.fields?.find(field => field.fieldname === 'letra')
        if (letraField && letraField.options) {
          const letras = letraField.options.split('\n').filter(letra => letra.trim())
          setLetrasDisponibles(letras)
        }
      }

      // Cargar campos personalizados
      const fieldsResponse = await fetchWithAuth('/api/resource/Custom Field?filters=[["fieldname","in",["custom_condicion_iva","custom_personeria","custom_condicion_ingresos_brutos","custom_jurisdicciones_iibb","custom_condicion_ganancias","custom_company","custom_default_iva_ventas","custom_default_iva_compras","custom_conciliation_id","custom_description_type","custom_product_links","custom_default_price_list"]]]&fields=["name","dt","fieldname","label"]')
      if (fieldsResponse.ok) {
        const fieldsData = await fieldsResponse.json()
        setCustomFields(fieldsData.data || [])
      }

      // Cargar series de numeración
      const seriesResponse = await fetchWithAuth('/api/resource/Naming Series?fields=["name"]')
      if (seriesResponse.ok) {
        const seriesData = await seriesResponse.json()
        setNamingSeries(seriesData.data || [])
      } else {
        console.log('Naming Series endpoint failed, setting empty array')
        setNamingSeries([])
      }
    } catch (error) {
      console.error('Error loading AFIP configuration:', error)
    }
  }

  const loadBanks = async () => {
    try {
      const response = await fetchWithAuth('/api/setup2/list-banks')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailableBanks(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading banks:', error)
    }
  }

  const createBanks = async () => {
    try {
      setCreatingBanks(true)
      showNotification('Creando bancos argentinos y billeteras digitales...', 'info')

      const response = await fetchWithAuth('/api/setup2/create-banks', {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(`Bancos procesados: ${data.created?.length || 0} creados, ${data.existing?.length || 0} ya existían, ${data.failed?.length || 0} fallaron`, data.failed?.length > 0 ? 'warning' : 'success')
          // Recargar lista de bancos
          loadBanks()
        } else {
          showNotification('Error creando bancos', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error: ${errorData.message}`, 'error')
      }
    } catch (error) {
      console.error('Error creating banks:', error)
      showNotification('Error de conexión al crear bancos', 'error')
    } finally {
      setCreatingBanks(false)
    }
  }

  const clearLetrasDisponibles = async () => {
    try {
      const response = await fetchWithAuth('/api/setup2/clear-letras-disponibles', {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        setLetrasDisponibles([])
        showNotification(`Letras procesadas: ${data.deleted} eliminadas, ${data.failed} fallaron. ${data.message}`, data.failed > 0 ? 'warning' : 'success')
        // Recargar configuración AFIP para actualizar las letras
        loadAfipConfiguration()
      } else {
        const errorData = await response.json()
        showNotification(`Error: ${errorData.message}`, 'error')
      }
    } catch (error) {
      console.error('Error procesando letras disponibles:', error)
      showNotification('Error al procesar letras disponibles.', 'error')
    }
  }

  const clearTiposComprobanteAfip = async () => {
    try {
      const response = await fetchWithAuth('/api/setup2/clear-afip-comprobante-types', {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setTiposComprobanteAfip([])
          showNotification(`Se eliminaron ${data.deleted} tipos de comprobante AFIP de ERPNext. ${data.failed > 0 ? `Fallaron ${data.failed}.` : ''}`, data.failed > 0 ? 'warning' : 'success')
        } else {
          showNotification('Error al eliminar tipos de comprobante AFIP.', 'error')
        }
      } else {
        showNotification('Error al conectar con el servidor.', 'error')
      }
    } catch (error) {
      console.error('Error eliminando tipos de comprobante:', error)
      showNotification('Error al eliminar tipos de comprobante AFIP.', 'error')
    }
  }

  const reloadAfipConfiguration = () => {
    loadAfipConfiguration()
    showNotification('Recargando configuración AFIP desde ERPNext...', 'info')
  }

  const loadCompanyAccounts = async () => {
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCompanyAccounts(data.data)
        }
      }
    } catch (error) {
      console.error('Error loading company accounts:', error)
    }
  }

  const initializeCompanySetup = async () => {
    try {
      setInitializing(true)
      showNotification('Iniciando configuración inicial de empresa...', 'info')

      const response = await fetchWithAuth(API_ROUTES.setupCompanyInitialization, {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Configuración inicial completada, creando condiciones de pago...', 'info')
          
          // Crear plantillas estándar de condiciones de pago
          try {
            const paymentTermsResponse = await fetchWithAuth(API_ROUTES.createStandardPaymentTerms, {
              method: 'POST'
            })
            
            if (paymentTermsResponse.ok) {
              const paymentTermsData = await paymentTermsResponse.json()
              if (paymentTermsData.success) {
                showNotification(`Condiciones de pago creadas: ${paymentTermsData.created?.length || 0} plantillas`, 'success')
              } else {
                showNotification('Error creando condiciones de pago', 'warning')
              }
            } else {
              showNotification('Error creando condiciones de pago', 'warning')
            }
          } catch (paymentTermsError) {
            console.error('Error creating payment terms:', paymentTermsError)
            showNotification('Error creando condiciones de pago', 'warning')
          }

          // Configurar componentes AFIP (incluye campos personalizados)
          showNotification('Configurando componentes AFIP...', 'info')
          try {
            const afipResponse = await fetchWithAuth(API_ROUTES.setup2InitializeAfipSetup, {
              method: 'POST'
            })

            if (afipResponse.ok) {
              const afipData = await afipResponse.json()
              if (afipData.success) {
                showNotification('Configuración AFIP completada exitosamente', 'success')
              } else {
                showNotification('Error en configuración AFIP', 'warning')
              }
            } else {
              showNotification('Error configurando componentes AFIP', 'warning')
            }
          } catch (afipError) {
            console.error('Error setting up AFIP components:', afipError)
            showNotification('Error configurando componentes AFIP', 'warning')
          }

          // Recargar SOLO el estado general después de la inicialización (sin duplicar las llamadas específicas)
          await loadSetupStatus()
          
          showNotification('Configuración inicial completada exitosamente', 'success')
        } else {
          showNotification(`Error en configuración inicial: ${data.message}`, 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error initializing company setup:', error)
      showNotification('Error de conexión durante la configuración inicial', 'error')
    } finally {
      setInitializing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Cargando estado de configuración...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con botón de inicialización */}
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 border border-gray-200/30 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Configuración Inicial</h2>
            <p className="text-gray-600">Estado actual de la configuración de la empresa</p>
          </div>
          {/* Only allow Administrator (admin@example.com) to trigger initial setup */}
          <button
            onClick={initializeCompanySetup}
            disabled={initializing || !activeCompanyFromContext || !(user && String(user.email || '').toLowerCase() === 'admin@example.com')}
            className="btn-manage-addresses flex items-center"
          >
            {initializing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            {initializing ? 'Ejecutando...' : 'Ejecutar Configuración Inicial'}
          </button>
        </div>
        {!activeCompanyFromContext && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-700">Debe seleccionar una empresa activa para poder ejecutar la configuración inicial.</p>
          </div>
        )}
        {activeCompanyFromContext && !(user && String(user.email || '').toLowerCase() === 'admin@example.com') && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-700">Solo el usuario con email <strong>admin@example.com</strong> puede ejecutar la configuración inicial.</p>
          </div>
        )}
      </div>

      {/* Estado General de Configuración */}
      {setupStatus && (
        <div className="space-y-6">
          {/* Resumen Ejecutivo */}
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 border border-gray-200/30 shadow-lg">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Resumen Ejecutivo</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-14 gap-2">
              <div className="text-center p-2 bg-green-50 rounded-lg border border-green-200">
                <div className="text-lg font-bold text-green-600">{taxTemplates.length}</div>
                <div className="text-xs text-green-700">Plantillas Impuestos</div>
              </div>
              <div className="text-center p-2 bg-teal-50 rounded-lg border border-teal-200">
                <div className="text-lg font-bold text-teal-600">{itemTaxTemplates.length}</div>
                <div className="text-xs text-teal-700">Item Tax Templates</div>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-lg font-bold text-blue-600">{availableTaxAccounts.length}</div>
                <div className="text-xs text-blue-700">Cuentas Impuestos</div>
              </div>
              <div className="text-center p-2 bg-orange-50 rounded-lg border border-orange-200">
                <div className="text-lg font-bold text-orange-600">
                  {(companyAccounts?.default_receivable_account ? 1 : 0) + (companyAccounts?.default_payable_account ? 1 : 0)}/2
                </div>
                <div className="text-xs text-orange-700">Ctas Cliente/Prov</div>
              </div>
              <div className="text-center p-2 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-lg font-bold text-purple-600">{Object.keys(setupStatus.item_groups || {}).length}</div>
                <div className="text-xs text-purple-700">Grupos Ítems</div>
              </div>
              <div className="text-center p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                <div className="text-lg font-bold text-indigo-600">{paymentTermsTemplates.length}</div>
                <div className="text-xs text-indigo-700">Condiciones Pago</div>
              </div>
              <div className="text-center p-2 bg-cyan-50 rounded-lg border border-cyan-200">
                <div className="text-lg font-bold text-cyan-600">{afipDoctypes.length}</div>
                <div className="text-xs text-cyan-700">DocTypes AFIP</div>
              </div>
              <div className="text-center p-2 bg-rose-50 rounded-lg border border-rose-200">
                <div className="text-lg font-bold text-rose-600">{afipRecords.length}</div>
                <div className="text-xs text-rose-700">Registros AFIP</div>
              </div>
              <div className="text-center p-2 bg-violet-50 rounded-lg border border-violet-200">
                <div className="text-lg font-bold text-violet-600">{customFields.length}</div>
                <div className="text-xs text-violet-700">Campos Personalizados</div>
              </div>
              <div className="text-center p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                <div className="text-lg font-bold text-yellow-600">{namingSeries.length}</div>
                <div className="text-xs text-yellow-700">Series Numeración</div>
              </div>
              <div className="text-center p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                <div className="text-lg font-bold text-indigo-600">{letrasDisponibles.length}</div>
                <div className="text-xs text-indigo-700">Letras Disponibles</div>
              </div>
              <div className="text-center p-2 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-lg font-bold text-purple-600">{tiposComprobanteAfip.length}</div>
                <div className="text-xs text-purple-700">Tipos Comprobante AFIP</div>
              </div>
              <div className="text-center p-2 bg-lime-50 rounded-lg border border-lime-200">
                <div className="text-lg font-bold text-lime-600">{availableBanks.length}</div>
                <div className="text-xs text-lime-700">Bancos Disponibles</div>
              </div>
            </div>
          </div>

          {/* Detalles Compactos */}
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 border border-gray-200/30 shadow-lg">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Detalles de Configuración</h3>
            <div className="space-y-4">
              {/* Plantillas Impuestos */}
              {taxTemplates.length > 0 && (
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <h4 className="font-semibold text-green-800 mb-2">Plantillas Impuestos ({taxTemplates.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {taxTemplates.map((template, index) => (
                      <span key={index} className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">{template.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Item Tax Templates */}
              {itemTaxTemplates.length > 0 && (
                <div className="bg-teal-50 rounded-lg p-4 border border-teal-200">
                  <h4 className="font-semibold text-teal-800 mb-2">Item Tax Templates ({itemTaxTemplates.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {itemTaxTemplates.map((template, index) => (
                      <span key={index} className="px-2 py-1 bg-teal-100 text-teal-700 rounded text-sm">{template.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Cuentas Impuestos */}
              {availableTaxAccounts.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2">Cuentas Impuestos ({availableTaxAccounts.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {availableTaxAccounts.map((account, index) => (
                      <span key={index} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">{account.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Ctas Cliente/Prov */}
              {companyAccounts && (
                <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                  <h4 className="font-semibold text-orange-800 mb-2">Cuentas Cliente/Proveedor</h4>
                  <div className="space-y-1">
                    {companyAccounts.default_receivable_account && (
                      <div className="text-sm text-orange-700">Cliente: {companyAccounts.default_receivable_account}</div>
                    )}
                    {companyAccounts.default_payable_account && (
                      <div className="text-sm text-orange-700">Proveedor: {companyAccounts.default_payable_account}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Grupos Ítems */}
              {setupStatus && Object.keys(setupStatus.item_groups || {}).length > 0 && (
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <h4 className="font-semibold text-purple-800 mb-2">Grupos Ítems ({Object.keys(setupStatus.item_groups).length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(setupStatus.item_groups).map((group, index) => (
                      <span key={index} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm">{group}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Condiciones Pago */}
              {paymentTermsTemplates.length > 0 && (
                <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
                  <h4 className="font-semibold text-indigo-800 mb-2">Condiciones Pago ({paymentTermsTemplates.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {paymentTermsTemplates.map((term, index) => (
                      <span key={index} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-sm">{term.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* DocTypes AFIP */}
              {afipDoctypes.length > 0 && (
                <div className="bg-cyan-50 rounded-lg p-4 border border-cyan-200">
                  <h4 className="font-semibold text-cyan-800 mb-2">DocTypes AFIP ({afipDoctypes.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {afipDoctypes.map((doctype, index) => (
                      <span key={index} className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-sm">{doctype.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Registros AFIP */}
              {afipRecords.length > 0 && (
                <div className="bg-rose-50 rounded-lg p-4 border border-rose-200">
                  <h4 className="font-semibold text-rose-800 mb-2">Registros AFIP ({afipRecords.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {afipRecords.map((record, index) => (
                      <span key={index} className="px-2 py-1 bg-rose-100 text-rose-700 rounded text-sm">{record.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Campos Personalizados */}
              {customFields.length > 0 && (
                <div className="bg-violet-50 rounded-lg p-4 border border-violet-200">
                  <h4 className="font-semibold text-violet-800 mb-2">Campos Personalizados ({customFields.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {customFields.map((field, index) => (
                      <span key={index} className="px-2 py-1 bg-violet-100 text-violet-700 rounded text-sm">{field.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Series Numeración */}
              {namingSeries.length > 0 && (
                <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                  <h4 className="font-semibold text-yellow-800 mb-2">Series Numeración ({namingSeries.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {namingSeries.map((series, index) => (
                      <span key={index} className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-sm">{series.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tipos de Letras Disponibles */}
              {letrasDisponibles.length > 0 && (
                <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-indigo-800">Tipos de Letras Disponibles ({letrasDisponibles.length})</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={reloadAfipConfiguration}
                        className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded transition-colors"
                        title="Recargar datos desde ERPNext"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={clearLetrasDisponibles}
                        className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded transition-colors"
                        title="Intentar eliminar letras disponibles (ERPNext validará si es posible)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {letrasDisponibles.map((letra, index) => (
                      <span key={index} className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">{letra}</span>
                    ))}
                  </div>
                  <p className="text-xs text-indigo-600 mt-2">Letras disponibles para talonarios según normativa AFIP</p>
                </div>
              )}

              {/* Tipos de Comprobante AFIP */}
              {tiposComprobanteAfip.length > 0 && (
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-purple-800">Tipos de Comprobante AFIP ({tiposComprobanteAfip.length})</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={reloadAfipConfiguration}
                        className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded transition-colors"
                        title="Recargar datos desde ERPNext"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={clearTiposComprobanteAfip}
                        className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-100 rounded transition-colors"
                        title="Eliminar todos los tipos de comprobante de ERPNext"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {tiposComprobanteAfip.map((tipo, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-purple-100 rounded text-sm">
                        <span className="font-medium text-purple-700">{tipo.codigo_afip}</span>
                        <span className="text-purple-600 truncate ml-2">{tipo.descripcion}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-purple-600 mt-2">Tipos de comprobante electrónico disponibles según AFIP</p>
                </div>
              )}

              {/* Bancos Disponibles */}
              <div className="bg-lime-50 rounded-lg p-4 border border-lime-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-lime-800">Bancos y Billeteras Digitales ({availableBanks.length})</h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={loadBanks}
                      className="p-1 text-lime-600 hover:text-lime-800 hover:bg-lime-100 rounded transition-colors"
                      title="Recargar lista de bancos desde ERPNext"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={createBanks}
                      disabled={creatingBanks}
                      className="px-3 py-1 bg-white text-black border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      title="Crear bancos argentinos y billeteras digitales en ERPNext"
                    >
                      {creatingBanks ? 'Creando...' : 'Crear Bancos'}
                    </button>
                  </div>
                </div>
                {availableBanks.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {availableBanks.slice(0, 12).map((bank, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-lime-100 rounded text-sm">
                        <span className="font-medium text-lime-700">{bank.swift_number || bank.name}</span>
                        <span className="text-lime-600 truncate ml-2">{bank.bank_name}</span>
                      </div>
                    ))}
                    {availableBanks.length > 12 && (
                      <div className="col-span-full text-center text-xs text-lime-600 mt-2">
                        ... y {availableBanks.length - 12} bancos más
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-lime-600">No hay bancos configurados. Haz clic en "Crear Bancos" para inicializar la lista de bancos argentinos y billeteras digitales.</p>
                )}
                <p className="text-xs text-lime-600 mt-2">Bancos y billeteras digitales disponibles para cuentas bancarias</p>
              </div>

            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 border border-gray-200/30 shadow-lg">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Estado de Configuración General</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="font-semibold text-gray-900">Configuración Inicial Completa</h4>
                  <p className="text-sm text-gray-600">Todos los componentes básicos han sido configurados</p>
                </div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${setupStatus.initialized ? 'bg-green-500' : 'bg-red-500'}`}>
                  {setupStatus.initialized ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <X className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
              {setupStatus.initialized && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-700">
                    ✅ La configuración inicial de la empresa ha sido completada exitosamente.
                    Todos los componentes necesarios están disponibles para operar el sistema.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default InitialConfiguration
