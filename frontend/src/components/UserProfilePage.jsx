import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AuthContext } from '../AuthProvider';
import { useNotification } from '../contexts/NotificationContext';
import { User, Settings, Save, X, ArrowLeft, Edit, UserCheck, Shield, Bell, Users, Building2 } from 'lucide-react';
import AdminPanel from './AdminPanel';
import UserProfilePanel from './UserProfilePanel/UserProfilePanel';
import CreateUserModal from './UserProfilePanel/CreateUserModal';

const UserProfilePage = ({ onClose }) => {
  console.log('🔍 FRONTEND: UserProfilePage component mounted/updated');
  
  const {
    fetchWithAuth,
    user,
    roleDefinitions = [],
    featureMatrix = {},
    hasFeatureAccess = () => true
  } = useContext(AuthContext);
  const { showInfo, showError } = useNotification();

  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [companyData, setCompanyData] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [userRefreshKey, setUserRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState('informacion');
  const [isEditing, setIsEditing] = useState(false);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const featureEntries = useMemo(() => Object.values(featureMatrix || {}), [featureMatrix]);
  const roleDisplayMap = useMemo(() => {
    const map = {}
    roleDefinitions.forEach((role) => {
      map[role.name] = role.display_name || role.name
    })
    return map
  }, [roleDefinitions])

  // Cargar datos del usuario
  useEffect(() => {
    console.log('🔍 FRONTEND: useEffect triggered - user:', user);
    console.log('🔍 FRONTEND: user exists:', !!user);
    console.log('🔍 FRONTEND: user.username:', user?.username);
    
    if (user?.username) {
      console.log('🔍 FRONTEND: Calling loadUserData');
      loadUserData();
    } else {
      console.log('🔍 FRONTEND: User not available, skipping data loading');
    }
  }, [user]);

  // Resetear estado de edición cuando cambie de tab
  useEffect(() => {
    setIsEditing(false);
    // Resetear editedData con los datos actuales
    const userDataCopy = userData ? { ...userData } : {};
    setEditedData({ ...userDataCopy });
  }, [activeTab, userData]);

  useEffect(() => {
    if (activeTab === 'usuarios' && !hasFeatureAccess('manage-users')) {
      setActiveTab('informacion');
    }
  }, [activeTab, hasFeatureAccess]);

  const loadUserData = async () => {
    console.log('🔍 FRONTEND: Iniciando carga de datos del usuario');
    console.log('🔍 FRONTEND: Usuario actual:', user);
    console.log('🔍 FRONTEND: Username:', user?.username);
    
    setLoading(true);
    try {
      const apiUrl = `/api/users/${user.username}`;
      console.log('🔍 FRONTEND: Realizando petición a:', apiUrl);
      
      const response = await fetchWithAuth(apiUrl);
      console.log('🔍 FRONTEND: Respuesta recibida - Status:', response.status);
      console.log('🔍 FRONTEND: Respuesta OK:', response.ok);
      
      if (response.ok) {
        const data = await response.json();
        console.log('🔍 FRONTEND: Datos JSON recibidos:', data);
        
        if (data.success) {
          console.log('✅ FRONTEND: Datos del usuario cargados exitosamente');
          setUserData(data.data);
          setEditedData({ ...data.data });
        } else {
          console.log('❌ FRONTEND: Respuesta sin success:', data);
          showError('Error al cargar datos del usuario');
        }
      } else {
        const errorText = await response.text();
        console.log('❌ FRONTEND: Error HTTP - Status:', response.status);
        console.log('❌ FRONTEND: Error response text:', errorText);
        showError('Error al cargar datos del usuario');
      }
    } catch (error) {
      console.error('❌ FRONTEND: Error en loadUserData:', error);
      showError('Error al cargar datos del usuario');
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyData = async () => {
    console.log('🔍 FRONTEND: Iniciando carga de datos de la compañía');
    
    setCompanyLoading(true);
    try {
      // No hay funcionalidad de compañía que cargar sin Google Sheets
      console.log('⚠️ FRONTEND: No hay datos de compañía que cargar (Google Sheets removido)');
      setCompanyData(null);
    } catch (error) {
      console.error('❌ FRONTEND: Error en loadCompanyData:', error);
      showError('Error al cargar datos de la compañía');
    } finally {
      setCompanyLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Guardar datos del usuario (información básica y preferencias)
      // Aquí iría la lógica para guardar cambios en el usuario
      // Por ahora, solo mostramos un mensaje
      showInfo('Funcionalidad de guardar datos de usuario en desarrollo');
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving data:', error);
      showError('Error al guardar cambios');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Resetear datos del usuario
    setEditedData(prev => ({
      ...prev,
      ...userData
    }));
    setIsEditing(false);
  };

  const handleInputChange = (field, value) => {
    setEditedData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateUser = (userToEdit = null) => {
    setEditingUser(userToEdit);
    setIsCreateUserModalOpen(true);
  };

  const handleCloseCreateUserModal = () => {
    setIsCreateUserModalOpen(false);
    setEditingUser(null);
    // Forzar recarga de la lista de usuarios
    setUserRefreshKey(prev => prev + 1);
  };

  const tabs = [
    { id: 'informacion', label: 'Información Básica', icon: User, color: 'text-blue-600' },
    { id: 'roles', label: 'Roles y Permisos', icon: Shield, color: 'text-purple-600' },
    { id: 'preferencias', label: 'Preferencias', icon: Bell, color: 'text-green-600' },
    { id: 'usuarios', label: 'Gestión de Usuarios', icon: Users, color: 'text-indigo-600' }
  ];
  const filteredTabs = tabs.filter(tab => tab.id !== 'usuarios' || hasFeatureAccess('manage-users'));

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Main Content */}
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        <div className="tabs-container">
          <nav className="tab-nav">
            {filteredTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                >
                  <Icon className={`w-4 h-4 ${tab.color}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="p-8">
          {!user?.username ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <User className="w-8 h-8 text-yellow-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Sesión no iniciada</h3>
                <p className="text-gray-500 mb-4">Debes iniciar sesión para acceder a tu perfil de usuario</p>
                <button
                  onClick={onClose}
                  className="btn-action-success"
                >
                  Volver al inicio
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : userData ? (
            <>
              {activeTab === 'informacion' && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                        <User className="w-5 h-5 text-blue-600" />
                      </div>
                      <h2 className="text-xl font-bold text-gray-900">Información Básica</h2>
                    </div>
                    <div className="flex flex-col space-y-2">
                      {!isEditing ? (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                          title="Editar información básica"
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                      ) : (
                        <div className="flex space-x-2">
                          <button
                            onClick={handleCancel}
                            className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                            disabled={saving}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                          >
                            {saving ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Guardando...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4 mr-2" />
                                Guardar Cambios
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <label className="block text-sm font-black text-gray-700 mb-1">Nombre de usuario</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedData.username || ''}
                          onChange={(e) => handleInputChange('username', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="text-gray-900 font-bold">{userData.username || 'No disponible'}</p>
                      )}
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <label className="block text-sm font-black text-gray-700 mb-1">Email</label>
                      {isEditing ? (
                        <input
                          type="email"
                          value={editedData.email || ''}
                          onChange={(e) => handleInputChange('email', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="text-gray-900 font-bold">{userData.email || 'No disponible'}</p>
                      )}
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <label className="block text-sm font-black text-gray-700 mb-1">Nombre completo</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedData.full_name || ''}
                          onChange={(e) => handleInputChange('full_name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="text-gray-900 font-bold">{userData.full_name || 'No disponible'}</p>
                      )}
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <label className="block text-sm font-black text-gray-700 mb-1">Zona horaria</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedData.time_zone || ''}
                          onChange={(e) => handleInputChange('time_zone', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="text-gray-900 font-bold">{userData.time_zone || 'No disponible'}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'roles' && (
                <div className="space-y-8">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                      <Shield className="w-5 h-5 text-purple-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">Roles y Permisos</h2>
                  </div>

                  <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {userData.roles?.map((role, index) => (
                        <div key={index} className="bg-gradient-to-r from-purple-50 to-indigo-50 px-4 py-3 rounded-xl border border-purple-200">
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span className="text-sm font-medium text-gray-900">{roleDisplayMap[role.role] || role.role}</span>
                          </div>
                        </div>
                      )) || <p className="text-gray-500 col-span-full">No hay roles asignados</p>}
                    </div>
                  </div>

                  <div className="bg-white/80 rounded-2xl p-6 border border-gray-200/60 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Mapa de accesos Flowint</h3>
                        <p className="text-sm text-gray-500">Cada opci�n de la interfaz y los roles que la habilitan</p>
                      </div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Sidebar/Header</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-left text-gray-700">
                        <thead>
                          <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                            <th className="py-3 pr-4 font-semibold">Funci�n</th>
                            <th className="py-3 pr-4 font-semibold">Ubicaci�n</th>
                            <th className="py-3 pr-4 font-semibold">Descripci�n</th>
                            <th className="py-3 pr-4 font-semibold">Roles requeridos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {featureEntries.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-gray-500">No hay datos de permisos disponibles.</td>
                            </tr>
                          ) : (
                            featureEntries.map((feature) => (
                              <tr key={feature.id} className="border-b border-gray-100">
                                <td className="py-3 pr-4 font-semibold text-gray-900">{feature.label}</td>
                                <td className="py-3 pr-4 text-gray-600">{feature.area === 'header' ? 'Barra superior' : feature.area === 'sidebar' ? 'Sidebar' : 'Pantalla'}</td>
                                <td className="py-3 pr-4 text-gray-600">{feature.description}</td>
                                <td className="py-3 pr-4 text-gray-600">
                                  {feature.requires_any_role?.length ? feature.requires_any_role.join(', ') : 'Disponible para todos (Desk User)'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white/80 rounded-2xl p-6 border border-gray-200/60 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Roles disponibles en ERPNext</h3>
                        <p className="text-sm text-gray-500">Referencias r�pidas documentadas</p>
                      </div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Cat�logo</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-left text-gray-700">
                        <thead>
                          <tr className="text-xs uppercase text-gray-500 border-b border-gray-200">
                            <th className="py-3 pr-4 font-semibold">Rol</th>
                            <th className="py-3 pr-4 font-semibold">Categor�a</th>
                            <th className="py-3 pr-4 font-semibold">Descripci�n</th>
                            <th className="py-3 pr-4 font-semibold">Impacto en Flowint</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(roleDefinitions || []).map((role) => {
                            const flowintLabels = (role.flowint_features || []).map((featureId) => featureMatrix?.[featureId]?.label || featureId);
                            return (
                              <tr key={role.name} className="border-b border-gray-100">
                                <td className="py-3 pr-4 font-semibold text-gray-900">{role.name}</td>
                                <td className="py-3 pr-4 text-gray-600">{role.category || 'General'}</td>
                                <td className="py-3 pr-4 text-gray-600">{role.description || 'Sin descripci�n disponible'}</td>
                                <td className="py-3 pr-4 text-gray-600">
                                  {flowintLabels.length
                                    ? flowintLabels.join(', ')
                                    : 'Sin impacto directo en el frontend de Flowint'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-blue-50/80 to-blue-100/70 rounded-2xl p-6 border border-blue-200/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-blue-200 rounded-xl flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-blue-700" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-800">Compañías habilitadas</p>
                          <p className="text-xs text-gray-500">Control de acceso por empresa</p>
                        </div>
                      </div>
                    </div>
                    {userData.allowed_companies && userData.allowed_companies.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {userData.allowed_companies.map((company) => (
                          <span
                            key={company}
                            className="px-3 py-1 text-xs font-semibold text-blue-700 bg-white rounded-full border border-blue-200 shadow-sm"
                          >
                            {company}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No se asignaron compañías específicas. Verá todas las disponibles.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'preferencias' && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                        <Bell className="w-5 h-5 text-green-600" />
                      </div>
                      <h2 className="text-xl font-bold text-gray-900">Preferencias</h2>
                    </div>
                    <div className="flex flex-col space-y-2">
                      {!isEditing ? (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                          title="Editar preferencias"
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                      ) : (
                        <div className="flex space-x-2">
                          <button
                            onClick={handleCancel}
                            className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                            disabled={saving}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                          >
                            {saving ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Guardando...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4 mr-2" />
                                Guardar Cambios
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-black text-gray-700 mb-1">Enviar email de bienvenida</label>
                          <p className="text-xs text-gray-500">Recibir emails de bienvenida para nuevos usuarios</p>
                        </div>
                        {isEditing ? (
                          <input
                            type="checkbox"
                            checked={editedData.send_welcome_email || false}
                            onChange={(e) => handleInputChange('send_welcome_email', e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                          />
                        ) : (
                          <span className={`text-sm font-medium ${userData.send_welcome_email ? 'text-green-600' : 'text-gray-400'}`}>
                            {userData.send_welcome_email ? 'Activado' : 'Desactivado'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-black text-gray-700 mb-1">Silenciar sonidos</label>
                          <p className="text-xs text-gray-500">Desactivar sonidos de notificación</p>
                        </div>
                        {isEditing ? (
                          <input
                            type="checkbox"
                            checked={editedData.mute_sounds || false}
                            onChange={(e) => handleInputChange('mute_sounds', e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                          />
                        ) : (
                          <span className={`text-sm font-medium ${userData.mute_sounds ? 'text-green-600' : 'text-gray-400'}`}>
                            {userData.mute_sounds ? 'Activado' : 'Desactivado'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-black text-gray-700 mb-1">Notificaciones</label>
                          <p className="text-xs text-gray-500">Recibir notificaciones del sistema</p>
                        </div>
                        {isEditing ? (
                          <input
                            type="checkbox"
                            checked={editedData.notifications || false}
                            onChange={(e) => handleInputChange('notifications', e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                          />
                        ) : (
                          <span className={`text-sm font-medium ${userData.notifications ? 'text-green-600' : 'text-gray-400'}`}>
                            {userData.notifications ? 'Activado' : 'Desactivado'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-black text-gray-700 mb-1">Barra de búsqueda</label>
                          <p className="text-xs text-gray-500">Mostrar barra de búsqueda global</p>
                        </div>
                        {isEditing ? (
                          <input
                            type="checkbox"
                            checked={editedData.search_bar || false}
                            onChange={(e) => handleInputChange('search_bar', e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                          />
                        ) : (
                          <span className={`text-sm font-medium ${userData.search_bar ? 'text-green-600' : 'text-gray-400'}`}>
                            {userData.search_bar ? 'Activado' : 'Desactivado'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'usuarios' && (
                <UserProfilePanel 
                  onCreateUser={handleCreateUser} 
                  onEditUser={(user) => handleCreateUser(user)}
                  refreshKey={userRefreshKey}
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <X className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Error al cargar datos</h3>
                <p className="text-gray-500">No se pudieron cargar los datos del usuario</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Admin Panel - Solo para administradores */}
      {userData?.roles?.some(role => role.role === 'Administrator' || role.role === 'System Manager') && (
        <AdminPanel />
      )}

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={isCreateUserModalOpen}
        onClose={handleCloseCreateUserModal}
        editingUser={editingUser}
      />
    </div>
  );
};

export default UserProfilePage;
