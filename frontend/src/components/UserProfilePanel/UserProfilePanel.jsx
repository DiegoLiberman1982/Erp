import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../AuthProvider';
import { useNotification } from '../Notification';
import { useConfirm } from '../../hooks/useConfirm';
import apiRoutes from '../../apiRoutes';
import { UserPlus, Users, Edit, Mail, Shield, Trash2 } from 'lucide-react';

const UserProfilePanel = ({ onCreateUser, onEditUser, refreshKey }) => {
  console.log('🔍 FRONTEND: UserProfilePanel component mounted');

  const { fetchWithAuth, user } = useContext(AuthContext);
  const { showNotification } = useNotification();
  const { confirm, ConfirmDialog } = useConfirm();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cargar lista de usuarios
  useEffect(() => {
    if (user?.username) {
      loadUsers();
    }
  }, [user, refreshKey]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      console.log('🔍 FRONTEND: Loading users...');
      const response = await fetchWithAuth(apiRoutes.users);
      console.log('🔍 FRONTEND: Users response:', response);
      if (response.ok) {
        const data = await response.json();
        console.log('🔍 FRONTEND: Users data:', data);
        if (data.success) {
          // Filtrar el usuario actual de la lista
          const filteredUsers = data.data.filter(u => u.name !== user.username);
          console.log('🔍 FRONTEND: Filtered users:', filteredUsers);
          setUsers(filteredUsers);
        } else {
          console.log('❌ FRONTEND: Error in response:', data);
          showNotification('Error al cargar usuarios', 'error');
        }
      } else {
        console.log('❌ FRONTEND: HTTP error:', response.status);
        showNotification('Error al cargar usuarios', 'error');
      }
    } catch (error) {
      console.error('Error loading users:', error);
      showNotification('Error al cargar usuarios', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = (userData) => {
    if (onEditUser) {
      onEditUser(userData);
    }
  };

  const handleDeleteUser = async (userData) => {
    if (!userData?.name) return;

    const confirmed = await confirm({
      title: 'Eliminar Usuario',
      message: `¿Estás seguro de que deseas eliminar al usuario ${userData.first_name} ${userData.last_name}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      type: 'error'
    });

    if (!confirmed) return;

    try {
      const response = await fetchWithAuth(`${apiRoutes.users}/${userData.name}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Remover usuario de la lista local
          setUsers(prevUsers => prevUsers.filter(u => u.name !== userData.name));
          showNotification('Usuario eliminado exitosamente', 'success');
        } else {
          showNotification(data.message || 'Error al eliminar usuario', 'error');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        showNotification(errorData.message || 'Error al eliminar usuario', 'error');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      showNotification('Error al eliminar usuario', 'error');
    }
  };

  // Función para recargar usuarios (llamada desde el padre después de crear/editar)
  const refreshUsers = () => {
    loadUsers();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Gestión de Usuarios</h2>
            <p className="text-sm text-gray-600">Crear y gestionar usuarios del sistema</p>
          </div>
        </div>
        <button
          onClick={() => onCreateUser()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Crear Usuario
        </button>
      </div>

      {/* Users List */}
      <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Usuarios del Sistema</h3>
          <span className="text-sm text-gray-500">{users.length} usuarios</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No hay usuarios para mostrar</p>
            <button
              onClick={() => onCreateUser()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Crear Primer Usuario
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {users.map((userData) => (
              <div
                key={userData.name}
                className="bg-white rounded-xl p-4 border border-gray-200 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {userData.first_name?.[0]}{userData.last_name?.[0]}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">
                        {userData.first_name} {userData.last_name}
                      </h4>
                      <div className="flex items-center text-sm text-gray-500">
                        <Mail className="w-3 h-3 mr-1" />
                        {userData.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => handleEditUser(userData)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                      title="Editar usuario"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(userData)}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Eliminar usuario"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center text-sm">
                    <Shield className="w-3 h-3 mr-2 text-purple-500" />
                    <span className="text-gray-600">
                      {userData.user_type || 'System User'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      userData.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {userData.enabled ? 'Activo' : 'Inactivo'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(userData.creation).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog />
    </div>
  );
};

export default UserProfilePanel;