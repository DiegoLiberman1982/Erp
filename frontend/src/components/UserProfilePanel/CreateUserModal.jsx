import React, { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { AuthContext } from '../../AuthProvider';
import { useNotification } from '../../contexts/NotificationContext';
import { useConfirm } from '../../hooks/useConfirm';
import Modal from '../Modal';
import {
  UserPlus,
  Loader,
  Check,
  X,
  Key,
  Shield,
  Home,
  Users,
  Package,
  Warehouse,
  Upload,
  DollarSign,
  Calculator,
  FileText,
  Settings as SettingsIcon,
  Bell,
  Building2
} from 'lucide-react';
import { FEATURE_ACCESS_LIST } from '../../security/permissionsConfig';

const FEATURE_ROLE_DEPENDENCIES = {
  dashboard: ['System Manager', 'Administrator', 'Desk User', 'Sales Manager', 'Sales User', 'Purchase Manager', 'Accounts Manager', 'Accounts User', 'Stock Manager', 'Analytics', 'Report Manager', 'Dashboard Manager'],
  customers: ['System Manager', 'Administrator', 'Sales Manager', 'Sales User', 'Sales Master Manager', 'Support Team'],
  orders: ['System Manager', 'Administrator', 'Purchase Manager', 'Purchase Master Manager', 'Purchase User'],
  inventory: ['System Manager', 'Administrator', 'Stock Manager', 'Stock User', 'Item Manager', 'Manufacturing Manager', 'Manufacturing User', 'Delivery Manager', 'Fulfillment User'],
  'import': ['System Manager', 'Administrator', 'Purchase Manager', 'Purchase User', 'Sales Manager', 'Sales Master Manager', 'Item Manager'],
  finance: ['System Manager', 'Administrator', 'Accounts Manager', 'Accounts User', 'Auditor', 'Analytics'],
  accounting: ['System Manager', 'Administrator', 'Accounts Manager', 'Accounts User', 'Auditor'],
  reports: ['System Manager', 'Administrator', 'Sales Manager', 'Sales User', 'Purchase Manager', 'Accounts Manager', 'Report Manager', 'Dashboard Manager', 'Analytics'],
  settings: ['System Manager', 'Administrator', 'Workspace Manager', 'Script Manager'],
  notifications: ['System Manager', 'Administrator', 'Desk User', 'Sales Manager', 'Purchase Manager', 'Accounts Manager', 'Support Team', 'Inbox User'],
  'company-switcher': ['System Manager', 'Administrator', 'Accounts Manager', 'Accounts User'],
  'header-settings': ['System Manager', 'Administrator'],
  'user-profile': ['System Manager', 'Administrator', 'Desk User', 'Sales Manager', 'Purchase Manager', 'Accounts Manager'],
  'manage-users': ['System Manager', 'Administrator']
};

const CreateUserModal = ({ isOpen, onClose, editingUser = null }) => {

  const { fetchWithAuth, user, featureMatrix = {} } = useContext(AuthContext);
  const { showInfo, showError, showSuccess } = useNotification();
  const { confirm, ConfirmDialog } = useConfirm();

  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [roles, setRoles] = useState([]);
  const [formData, setFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    user_type: 'System User',
    enabled: true,
    send_welcome_email: true,
    roles: [],
    companies: []
  });

  const [isEditing, setIsEditing] = useState(false);
  const [featureSelections, setFeatureSelections] = useState({});
  const manualRolesRef = useRef(new Set());
  const featureAutoAssignmentsRef = useRef({});

  const rawFeatureList = useMemo(() => {
    if (featureMatrix && Object.keys(featureMatrix).length) {
      return Object.values(featureMatrix);
    }
    return FEATURE_ACCESS_LIST;
  }, [featureMatrix]);

  const sidebarFeatures = useMemo(
    () => rawFeatureList.filter((feature) => feature.area === 'sidebar'),
    [rawFeatureList]
  );
  const headerFeatures = useMemo(
    () => rawFeatureList.filter((feature) => feature.area === 'header'),
    [rawFeatureList]
  );
  const userFeatures = useMemo(
    () =>
      rawFeatureList.filter(
        (feature) => feature.area === 'modal' || feature.area === 'user-profile-tab'
      ),
    [rawFeatureList]
  );
  const allFeatureTargets = useMemo(
    () => [...sidebarFeatures, ...headerFeatures, ...userFeatures],
    [sidebarFeatures, headerFeatures, userFeatures]
  );
  const featureMap = useMemo(() => {
    const map = {};
    allFeatureTargets.forEach((feature) => {
      map[feature.id] = feature;
    });
    return map;
  }, [allFeatureTargets]);

  const roleDisplayMap = useMemo(() => {
    const map = {};
    roles.forEach((role) => {
      map[role.name] = role.display_name || role.name;
    });
    return map;
  }, [roles]);

  const featureIcons = useMemo(
    () => ({
      dashboard: Home,
      customers: Users,
      orders: Package,
      inventory: Warehouse,
      import: Upload,
      finance: DollarSign,
      accounting: Calculator,
      reports: FileText,
      settings: SettingsIcon,
      notifications: Bell,
      'company-switcher': Building2,
      'header-settings': SettingsIcon,
      'user-profile': Users,
      'manage-users': Shield
    }),
    []
  );

  const doesFeatureHaveAccess = useCallback((feature, roleSet) => {
    const requiresAll = feature?.requires_all_roles || [];
    const requiresAny = feature?.requires_any_role || [];
    const hasAll = requiresAll.every((role) => roleSet.has(role));
    const hasAny = requiresAny.length === 0 || requiresAny.some((role) => roleSet.has(role));
    return hasAll && hasAny;
  }, []);

  const getFeatureDependencies = useCallback(
    (feature) => {
      if (!feature) return [];
      if (FEATURE_ROLE_DEPENDENCIES[feature.id]) {
        return FEATURE_ROLE_DEPENDENCIES[feature.id];
      }
      return [
        ...(feature.requires_all_roles || []),
        ...(feature.requires_any_role || [])
      ];
    },
    []
  );

  const syncFeatureSelections = useCallback(
    (roleList) => {
      const roleSet = new Set(roleList || formData.roles || []);
      setFeatureSelections((prevSelections) => {
        const nextSelections = { ...prevSelections };
        allFeatureTargets.forEach((feature) => {
          const currentValue = nextSelections[feature.id];
          if (typeof currentValue === 'undefined') {
            nextSelections[feature.id] = doesFeatureHaveAccess(feature, roleSet);
          } else if (currentValue) {
            const hasAccess = doesFeatureHaveAccess(feature, roleSet);
            if (!hasAccess) {
              nextSelections[feature.id] = false;
            }
          }
        });
        return nextSelections;
      });
    },
    [allFeatureTargets, doesFeatureHaveAccess, formData.roles]
  );

  const computeFeatureAutoAssignments = useCallback(
    (roleList) => {
      const assignments = {};
      allFeatureTargets.forEach((feature) => {
        assignments[feature.id] = new Set();
      });
      const roleSet = new Set(roleList || []);
      allFeatureTargets.forEach((feature) => {
        if (!doesFeatureHaveAccess(feature, roleSet)) {
          return;
        }
        const dependencies = getFeatureDependencies(feature);
        dependencies.forEach((role) => {
          if (roleSet.has(role)) {
            assignments[feature.id].add(role);
          }
        });
      });
      return assignments;
    },
    [allFeatureTargets, doesFeatureHaveAccess, getFeatureDependencies]
  );

  const enforceFeatureDependencies = useCallback(
    (roleList) => {
      const rolesArray = Array.isArray(roleList) ? roleList : [];
      setFeatureSelections((prevSelections) => {
        let changed = false;
        const nextSelections = { ...prevSelections };
        Object.entries(prevSelections).forEach(([featureId, isSelected]) => {
          if (!isSelected) {
            return;
          }
          const feature = featureMap[featureId];
          const dependencies = getFeatureDependencies(feature);
          if (!dependencies || dependencies.length === 0) {
            return;
          }
          const hasRequiredRole = dependencies.some((role) => rolesArray.includes(role));
          if (!hasRequiredRole) {
            nextSelections[featureId] = false;
            featureAutoAssignmentsRef.current[featureId] = new Set();
            changed = true;
          }
        });
        return changed ? nextSelections : prevSelections;
      });
    },
    [featureMap, getFeatureDependencies]
  );

  const initializeRoleState = useCallback(
    (roleList) => {
      const assignments = computeFeatureAutoAssignments(roleList);
      featureAutoAssignmentsRef.current = assignments;
      const autoRoles = new Set();
      Object.values(assignments).forEach((roleSet) => {
        roleSet.forEach((role) => autoRoles.add(role));
      });
      const manualRoles = new Set(roleList || []);
      autoRoles.forEach((role) => manualRoles.delete(role));
      manualRolesRef.current = manualRoles;
      syncFeatureSelections(roleList);
      enforceFeatureDependencies(roleList || []);
    },
    [computeFeatureAutoAssignments, enforceFeatureDependencies, syncFeatureSelections]
  );

  // Actualizar isEditing cuando cambia editingUser
  useEffect(() => {
    const newIsEditing = !!editingUser;
    setIsEditing(newIsEditing);
  }, [editingUser]);

  // Cargar datos iniciales cuando se abre el modal
  useEffect(() => {
    if (isOpen && user?.username) {
      const currentIsEditing = !!editingUser;
      loadCompanies();
      loadRoles();
      if (currentIsEditing) {
        loadUserDataForEditing();
      } else {
        resetForm();
      }
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) {
      manualRolesRef.current = new Set();
      featureAutoAssignmentsRef.current = computeFeatureAutoAssignments([]);
      setFeatureSelections({});
    }
  }, [computeFeatureAutoAssignments, isOpen]);

  useEffect(() => {
    if (isOpen) {
      syncFeatureSelections(formData.roles || []);
      enforceFeatureDependencies(formData.roles || []);
    }
  }, [allFeatureTargets, enforceFeatureDependencies, formData.roles, isOpen, syncFeatureSelections]);

  const loadRoles = async () => {
    try {
      const response = await fetchWithAuth('/api/roles');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setRoles(data.data);
        }
      }
    } catch (error) {
      console.error('Error loading roles:', error);
    }
  };

  const loadCompanies = async () => {
    try {
      const response = await fetchWithAuth(`/api/users/${user.username}/companies`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCompanies(data.data);
        }
      }
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const loadUserDataForEditing = async () => {
    if (!editingUser) return;

    try {
      // Cargar datos completos del usuario incluyendo roles y compañías
      const response = await fetchWithAuth(`/api/users/${editingUser.name}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const userData = data.data;
          
          // Los roles ya vienen incluidos en userData.roles
          const userRoles = userData.roles?.map(r => r.role) || [];
          
          // Obtener compañías del usuario
          let userCompanies = Array.isArray(userData.allowed_companies) ? userData.allowed_companies : [];
          if (!userCompanies.length) {
            try {
              const companiesResponse = await fetchWithAuth(`/api/users/${editingUser.name}/companies`);
              if (companiesResponse.ok) {
                const companiesData = await companiesResponse.json();
                if (companiesData.success) {
                  userCompanies = (companiesData.data || []).map(c => c.name);
                }
              }
            } catch (error) {
              console.error('Error loading user companies:', error);
            }
          }

          const nextFormData = {
            email: userData.email || '',
            first_name: userData.first_name || '',
            last_name: userData.last_name || '',
            user_type: userData.user_type || 'System User',
            enabled: userData.enabled === 1 || userData.enabled === true,
            send_welcome_email: true, // Default for editing
            roles: userRoles,
            companies: userCompanies
          };
          setFormData(nextFormData);
          initializeRoleState(userRoles);
        }
      }
    } catch (error) {
      console.error('Error loading user data for editing:', error);
      // Fallback to basic data if full data loading fails
      const fallbackFormData = {
        email: editingUser.email || '',
        first_name: editingUser.first_name || '',
        last_name: editingUser.last_name || '',
        user_type: editingUser.user_type || 'System User',
        enabled: editingUser.enabled === 1 || editingUser.enabled === true,
        send_welcome_email: true,
        roles: [],
        companies: []
      };
      setFormData(fallbackFormData);
      initializeRoleState([]);
    }
  };

  const resetForm = () => {
    const defaultForm = {
      email: '',
      first_name: '',
      last_name: '',
      user_type: 'System User',
      enabled: true,
      send_welcome_email: true,
      roles: [],
      companies: []
    };
    setFormData(defaultForm);
    initializeRoleState([]);
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleRoleToggle = (roleName) => {
    setFormData(prev => {
      const rolesSet = new Set(prev.roles || []);
      let removedRole = false;
      if (rolesSet.has(roleName)) {
        rolesSet.delete(roleName);
        removedRole = true;
        manualRolesRef.current.delete(roleName);
        Object.values(featureAutoAssignmentsRef.current).forEach((autoSet) => {
          autoSet.delete(roleName);
        });
      } else {
        rolesSet.add(roleName);
        manualRolesRef.current.add(roleName);
      }
      const nextRoles = Array.from(rolesSet);
      if (removedRole) {
        enforceFeatureDependencies(nextRoles);
      }
      syncFeatureSelections(nextRoles);
      return {
        ...prev,
        roles: nextRoles
      };
    });
  };

  const handleSelectAllRoles = () => {
    const allRoleNames = roles.map((role) => role.name);
    manualRolesRef.current = new Set(allRoleNames);
    featureAutoAssignmentsRef.current = computeFeatureAutoAssignments([]);
    setFormData(prev => {
      syncFeatureSelections(allRoleNames);
      enforceFeatureDependencies(allRoleNames);
      return {
        ...prev,
        roles: allRoleNames
      };
    });
  };

  const handleCompanyToggle = (companyName) => {
    setFormData(prev => {
      const isCurrentlySelected = prev.companies.includes(companyName);
      return {
        ...prev,
        companies: isCurrentlySelected
          ? prev.companies.filter(c => c !== companyName)
          : [...prev.companies, companyName]
      };
    });
  };

  const handleFeatureToggle = (featureId, enabled) => {
    const feature = featureMap[featureId];
    if (!feature) return;

    if (enabled) {
      setFeatureSelections(prev => ({
        ...prev,
        [featureId]: enabled
      }));
      setFormData(prev => {
        const rolesSet = new Set(prev.roles || []);
        const dependencyRoles = getFeatureDependencies(feature);
        const assigned = new Set();

        dependencyRoles.forEach((role) => {
          if (!role) return;
          if (!rolesSet.has(role)) {
            rolesSet.add(role);
            assigned.add(role);
          }
        });

        featureAutoAssignmentsRef.current[featureId] = assigned;
        const nextRoles = Array.from(rolesSet);
        enforceFeatureDependencies(nextRoles);
        syncFeatureSelections(nextRoles);
        return {
          ...prev,
          roles: nextRoles
        };
      });
    } else {
      setFeatureSelections(prev => ({
        ...prev,
        [featureId]: false
      }));
      const autoRoles = new Set(featureAutoAssignmentsRef.current[featureId] || []);
      setFormData(prev => {
        const rolesSet = new Set(prev.roles || []);
        autoRoles.forEach((role) => {
          const neededElsewhere = Object.entries(featureAutoAssignmentsRef.current).some(
            ([otherId, roleSet]) => otherId !== featureId && roleSet.has(role)
          );
          if (neededElsewhere) return;
          if (manualRolesRef.current.has(role)) return;
          rolesSet.delete(role);
        });

        featureAutoAssignmentsRef.current[featureId] = new Set();
        const nextRoles = Array.from(rolesSet);
        enforceFeatureDependencies(nextRoles);
        syncFeatureSelections(nextRoles);
        return {
          ...prev,
          roles: nextRoles
        };
      });
    }
  };

  const getFeatureRequiredRoles = (feature) => {
    const rolesNeeded = [
      ...(feature.requires_all_roles || []),
      ...(feature.requires_any_role || [])
    ];
    return rolesNeeded
      .map((role) => roleDisplayMap[role] || role)
      .filter(Boolean)
      .join(', ');
  };
  const getRoleTooltip = (role, highlights) => {
    const parts = [];
    if (role.description) {
      parts.push(role.description);
    }
    if (highlights) {
      parts.push(`Secciones habilitadas: ${highlights}`);
    }
    return parts.join('\n');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Preparar datos para el backend
      const userData = {
        data: {
          email: formData.email,
          first_name: formData.first_name,
          last_name: formData.last_name,
          user_type: formData.user_type,
          enabled: formData.enabled ? 1 : 0,
          send_welcome_email: formData.send_welcome_email ? 1 : 0,
          roles: formData.roles.map(roleName => ({ role: roleName })),
          companies: formData.companies
        }
      };

      const method = isEditing ? 'PUT' : 'POST';
      const url = isEditing ? `/api/users/${editingUser.name}` : '/api/users';

      const response = await fetchWithAuth(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          showSuccess(isEditing ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente');
          onClose();
        } else {
          showError(data.message || `Error al ${isEditing ? 'actualizar' : 'crear'} usuario`);
        }
      } else {
        const errorData = await response.json();
        showError(errorData.message || `Error al ${isEditing ? 'actualizar' : 'crear'} usuario`);
      }
    } catch (error) {
      console.error(`Error ${isEditing ? 'updating' : 'creating'} user:`, error);
      showError(`Error al ${isEditing ? 'actualizar' : 'crear'} usuario`);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editingUser?.email) return;

    const confirmed = await confirm({
      title: 'Resetear Contraseña',
      message: `¿Estás seguro de que deseas enviar un enlace de restablecimiento de contraseña a ${editingUser.email}? El usuario recibirá un email con instrucciones para cambiar su contraseña.`,
      confirmText: 'Enviar Enlace',
      type: 'warning'
    });

    if (!confirmed) return;

    try {
      setLoading(true);
      showInfo('Enviando enlace de restablecimiento...');

      // Usar el endpoint del backend
      const response = await fetchWithAuth(`/api/users/${editingUser.email}/reset-password`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          showSuccess(data.message || `Enlace de restablecimiento enviado exitosamente a ${editingUser.email}`);
        } else {
          showError(data.message || 'Error al enviar enlace de restablecimiento');
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        showError(errorData.message || 'Error al enviar enlace de restablecimiento');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      showError('Error al enviar enlace de restablecimiento');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    if (!isEditing) {
      resetForm();
    }
    setFeatureSelections({});
    manualRolesRef.current = new Set();
    featureAutoAssignmentsRef.current = computeFeatureAutoAssignments([]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? "Editar Usuario" : "Crear Nuevo Usuario"}
      subtitle={isEditing ? "Modifique los datos del usuario" : "Complete los datos del nuevo usuario"}
      size="xl"
    >
            <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <UserPlus className="w-5 h-5 mr-2 text-blue-600" />
                Información Básica
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    readOnly={isEditing}
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    placeholder="usuario@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Tipo de Usuario</label>
                  <select
                    value={formData.user_type}
                    onChange={(e) => handleInputChange('user_type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="System User">System User</option>
                    <option value="Website User">Website User</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Nombre *</label>
                  <input
                    type="text"
                    required
                    value={formData.first_name}
                    onChange={(e) => handleInputChange('first_name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Diego"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Apellido *</label>
                  <input
                    type="text"
                    required
                    value={formData.last_name}
                    onChange={(e) => handleInputChange('last_name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Pasik"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 pt-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => handleInputChange('enabled', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="ml-2 text-sm text-gray-700">Usuario habilitado</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.send_welcome_email}
                    onChange={(e) => handleInputChange('send_welcome_email', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="ml-2 text-sm text-gray-700">Enviar email de bienvenida</span>
                </label>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <span className="w-5 h-5 mr-2 bg-green-100 rounded-full flex items-center justify-center">
                  <span className="text-green-600 text-xs">C</span>
                </span>
                Compañías Permitidas
              </h3>
              <p className="text-xs text-gray-500">
                Marcá las empresas a las que este usuario puede acceder. Si no seleccionás ninguna, verá todas las disponibles.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                {companies.map((company) => (
                  <label key={company.name} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.companies.includes(company.name)}
                      onChange={() => handleCompanyToggle(company.name)}
                      className="w-4 h-4 text-green-600 bg-gray-100 border-gray-300 rounded focus:ring-green-500 focus:ring-2"
                    />
                    <span className="ml-2 text-sm text-gray-700">{company.company_name || company.name}</span>
                  </label>
                ))}
              </div>
              {companies.length === 0 && (
                <p className="text-sm text-gray-500 italic">No hay compañías disponibles para asignar</p>
              )}
            </div>
            <div className="pt-4 border-t border-gray-200 space-y-3">
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                  disabled={loading}
                >
                  Cancelar
                </button>

                {isEditing && (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={loading}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Resetear Contraseña
                  </button>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      {isEditing ? 'Actualizando...' : 'Creando...'}
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      {isEditing ? 'Actualizar Usuario' : 'Crear Usuario'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Secciones del sistema</h3>
                  <p className="text-xs text-gray-500">Activar una sección habilita automáticamente los roles necesarios.</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-black text-gray-700 mb-2">Sidebar</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-2">
                  {sidebarFeatures.map((feature) => {
                    const Icon = featureIcons[feature.id] || Shield;
                    const requiredRoles = getFeatureRequiredRoles(feature);
                    const featureTooltip = [
                      feature.description,
                      requiredRoles ? `Roles necesarios: ${requiredRoles}` : ''
                    ]
                      .filter(Boolean)
                      .join('\n');
                    return (
                      <label
                        key={feature.id}
                        className="flex items-start justify-between space-x-3 p-3 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 cursor-pointer"
                        title={featureTooltip}
                      >
                        <div className="flex items-start space-x-3 pr-2">
                          <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                            <Icon className="w-5 h-5 text-gray-700" />
                          </div>
                          <p className="text-sm font-semibold text-gray-900">{feature.label}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!featureSelections[feature.id]}
                          onChange={(e) => handleFeatureToggle(feature.id, e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 mt-1"
                        />
                      </label>
                    );
                  })}
                  {sidebarFeatures.length === 0 && (
                    <p className="text-sm text-gray-500 col-span-full">No hay secciones configuradas.</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm font-black text-gray-700 mb-2">Barra superior</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-40 overflow-y-auto pr-2">
                  {headerFeatures.map((feature) => {
                    const Icon = featureIcons[feature.id] || Shield;
                    const requiredRoles = getFeatureRequiredRoles(feature);
                    const featureTooltip = [
                      feature.description,
                      requiredRoles ? `Roles necesarios: ${requiredRoles}` : ''
                    ]
                      .filter(Boolean)
                      .join('\n');
                    return (
                      <label
                        key={feature.id}
                        className="flex items-start justify-between space-x-3 p-3 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 cursor-pointer"
                        title={featureTooltip}
                      >
                        <div className="flex items-start space-x-3 pr-2">
                          <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                            <Icon className="w-5 h-5 text-gray-700" />
                          </div>
                          <p className="text-sm font-semibold text-gray-900">{feature.label}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!featureSelections[feature.id]}
                          onChange={(e) => handleFeatureToggle(feature.id, e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 mt-1"
                        />
                      </label>
                    );
                  })}
                  {headerFeatures.length === 0 && (
                    <p className="text-sm text-gray-500 col-span-full">No hay accesos configurados.</p>
                  )}
                </div>
              </div>
              {userFeatures.length > 0 && (
                <div>
                  <p className="text-sm font-black text-gray-700 mb-2">Usuarios</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-40 overflow-y-auto pr-2">
                    {userFeatures.map((feature) => {
                      const Icon = featureIcons[feature.id] || Shield;
                      const requiredRoles = getFeatureRequiredRoles(feature);
                      const featureTooltip = [
                        feature.description,
                        requiredRoles ? `Roles necesarios: ${requiredRoles}` : ''
                      ]
                        .filter(Boolean)
                        .join('\n');
                      return (
                        <label
                          key={feature.id}
                          className="flex items-start justify-between space-x-3 p-3 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 cursor-pointer"
                          title={featureTooltip}
                        >
                          <div className="flex items-start space-x-3 pr-2">
                            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                              <Icon className="w-5 h-5 text-gray-700" />
                            </div>
                            <p className="text-sm font-semibold text-gray-900">{feature.label}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!featureSelections[feature.id]}
                            onChange={(e) => handleFeatureToggle(feature.id, e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 mt-1"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <span className="w-5 h-5 mr-2 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-purple-600 text-xs">R</span>
                  </span>
                  Roles del usuario
                </h3>
                <button
                  type="button"
                  onClick={handleSelectAllRoles}
                  className="text-xs font-semibold text-purple-600 hover:text-purple-800"
                >
                  Seleccionar todos
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 pr-2 overflow-y-auto">
                {roles.map((role) => {
                  const highlights = (role.flowint_features || [])
                    .map(featureId => featureMatrix?.[featureId]?.label || featureId)
                    .join(', ');
                  const displayName = role.display_name || role.name;
                  const tooltip = getRoleTooltip(role, highlights);
                  return (
                    <label
                      key={role.name}
                      className="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                      title={tooltip}
                    >
                      <input
                        type="checkbox"
                        checked={formData.roles.includes(role.name)}
                        onChange={() => handleRoleToggle(role.name)}
                        className="mt-1 w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 focus:ring-2"
                      />
                      <div>
                        <span className="block text-sm font-semibold text-gray-900">{displayName}</span>
                        {role.category && (
                          <p className="text-xs text-gray-400">{role.category}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </form>
      <ConfirmDialog />
    </Modal>
  );
};

export default CreateUserModal;
