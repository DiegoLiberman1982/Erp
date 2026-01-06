import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { ROLE_DEFINITIONS, FEATURE_ACCESS_LIST, FEATURE_ACCESS_MAP, normalizeRoleName } from './security/permissionsConfig';

// Creamos el contexto
export const AuthContext = createContext();

// Base API URL read from Vite env: VITE_API_URL.
// If not provided the app will use relative paths (helpful when using Vite proxy or same-origin backend).
// Example: VITE_API_URL=http://localhost:5000
const API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : '';

export default function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCompany, setActiveCompany] = useState(null);
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [userRoles, setUserRoles] = useState([]);
  const [featureAccess, setFeatureAccess] = useState({});
  const [permissionsReady, setPermissionsReady] = useState(false);

  const companiesLoadedRef = useRef(false);
  const userProfileLoadedRef = useRef(false);

  const extractRoleNames = useCallback((rolesInput) => {
    if (!rolesInput) return [];
    if (!Array.isArray(rolesInput)) {
      const singleRole = normalizeRoleName(rolesInput);
      return singleRole ? [singleRole] : [];
    }
    return rolesInput
      .map((role) => normalizeRoleName(role))
      .filter(Boolean);
  }, []);

  const computeFeatureAccessFromRoles = useCallback((roleNames) => {
    const entries = Array.isArray(roleNames) ? roleNames : [];
    const roleSet = new Set(entries);
    const access = {};

    FEATURE_ACCESS_LIST.forEach((feature) => {
      const requiresAny = feature.requires_any_role || [];
      const requiresAll = feature.requires_all_roles || [];
      const hasAny = requiresAny.length === 0 || requiresAny.some((role) => roleSet.has(role));
      const hasAll = requiresAll.length === 0 || requiresAll.every((role) => roleSet.has(role));
      access[feature.id] = hasAny && hasAll;
    });

    return { access, normalizedRoles: Array.from(roleSet) };
  }, []);

  const buildUserState = useCallback((username, profileData) => {
    if (!username && !profileData) {
      return null;
    }

    if (!profileData) {
      return { username };
    }

    const fullNameFromParts = [profileData.first_name, profileData.last_name].filter(Boolean).join(' ').trim();
    return {
      username: profileData.name || profileData.username || username,
      email: profileData.email,
      full_name: profileData.full_name || fullNameFromParts || profileData.email || username,
      first_name: profileData.first_name,
      last_name: profileData.last_name,
      user_type: profileData.user_type,
      enabled: profileData.enabled,
      time_zone: profileData.time_zone,
      roles: profileData.roles || [],
      user_image: profileData.user_image,
      mobile_no: profileData.mobile_no,
      phone: profileData.phone,
      language: profileData.language,
      companies: profileData.allowed_companies || profileData.companies || [],
      preferences: {
        send_welcome_email: profileData.send_welcome_email,
        mute_sounds: profileData.mute_sounds,
        notifications: profileData.notifications,
        search_bar: profileData.search_bar
      }
    };
  }, []);

  const applyUserProfile = useCallback((nextUser, persist = true, markLoaded = false) => {
    if (!nextUser) return;
    setUser(nextUser);

    const roleNames = extractRoleNames(nextUser.roles);
    const { access, normalizedRoles } = computeFeatureAccessFromRoles(roleNames);
    setFeatureAccess(access);
    setUserRoles(normalizedRoles);
    setPermissionsReady(true);

    if (markLoaded) {
      userProfileLoadedRef.current = true;
    }

    if (persist) {
      try {
        localStorage.setItem('erp_user', JSON.stringify(nextUser));
      } catch (storageError) {
        console.warn('No se pudo guardar erp_user en localStorage', storageError);
      }
    }
  }, [computeFeatureAccessFromRoles, extractRoleNames]);

  const fetchUserProfileData = useCallback(async (username, sessionTokenOverride) => {
    const targetUsername = username || user?.username;
    const authToken = sessionTokenOverride || token;
    if (!targetUsername || !authToken) {
      return null;
    }

    try {
      const encoded = encodeURIComponent(targetUsername);
      const profileUrl = API_URL ? `${API_URL}/api/users/${encoded}` : `/api/users/${encoded}`;
      const response = await fetch(profileUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': authToken
        },
        credentials: 'include'
      });

      if (!response.ok) {
        console.warn('No se pudo obtener el perfil de usuario', response.status);
        return null;
      }

      const data = await response.json();
      if (data?.success) {
        return data.data;
      }

      return null;
    } catch (error) {
      console.error('Error leyendo el perfil del usuario', error);
      return null;
    }
  }, [token, user?.username]);

  const refreshUserProfile = useCallback(async (sessionTokenOverride) => {
    const targetUsername = user?.username;
    const authToken = sessionTokenOverride || token;

    if (!targetUsername || !authToken) {
      return null;
    }

    try {
      setPermissionsReady(false);
      const profileData = await fetchUserProfileData(targetUsername, authToken);
      if (!profileData) {
        setPermissionsReady(true);
        return null;
      }

      const hydratedUser = buildUserState(targetUsername, profileData);
      applyUserProfile(hydratedUser, true, true);
      return hydratedUser;
    } catch (error) {
      console.error('Error actualizando el perfil del usuario', error);
      setPermissionsReady(true);
      return null;
    }
  }, [applyUserProfile, buildUserState, fetchUserProfileData, token, user?.username]);

  // Al cargar el componente, revisamos si ya hay un token en el localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('erp_token');
    const storedUser = localStorage.getItem('erp_user');
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        applyUserProfile(parsedUser, false, false);
      } catch (e) {
        console.error('Error parsing stored user:', e);
      }
    }
    setLoading(false);
  }, [applyUserProfile]);

  useEffect(() => {
    if (isAuthenticated && token && user?.username && !userProfileLoadedRef.current) {
      refreshUserProfile();
    }
  }, [isAuthenticated, refreshUserProfile, token, user?.username]);

  // Cargar empresas y empresa activa cuando el usuario está autenticado
  useEffect(() => {
    if (isAuthenticated && !loading && !companiesLoadedRef.current) {
      loadAvailableCompanies();
      getActiveCompany();
      companiesLoadedRef.current = true;
    }
  }, [isAuthenticated, loading]);

  // La función de login que usará tu componente
  const login = async (username, password) => {
    try {
      const loginPath = API_URL ? `${API_URL}/api/login` : `/api/login`;
      const response = await fetch(loginPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        const newToken = data.token;

        setToken(newToken);
        localStorage.setItem('erp_token', newToken);

        const profileData = await fetchUserProfileData(username, newToken);
        const normalizedUser = profileData
          ? buildUserState(username, profileData)
          : { username, roles: [] };

        applyUserProfile(normalizedUser, true, Boolean(profileData));
        setIsAuthenticated(true);
      }
      
      // Devolvemos la respuesta completa para que el componente Login pueda verificar si fue 'ok'
      return response;

    } catch (error) {
      console.error("Error en el login:", error);
      // Creamos un objeto de respuesta falso para manejar el error de red
      return { ok: false, status: 500 }; 
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setActiveCompany(null);
    setAvailableCompanies([]);
     setUserRoles([]);
     setFeatureAccess({});
     setPermissionsReady(false);
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_user');
    localStorage.removeItem('active_company');
    companiesLoadedRef.current = false;
    userProfileLoadedRef.current = false;
  };

  // Helper to perform authenticated fetch requests.
  // Accepts a path (e.g. '/api/customers/') or a full URL.
  const fetchWithAuth = useCallback(async (pathOrUrl, options = {}) => {
    const isFullUrl = /^https?:\/\//i.test(pathOrUrl);
    // If API_URL is empty we want to use the pathOrUrl as-is (relative path).
    const url = isFullUrl
      ? pathOrUrl
      : (API_URL ? `${API_URL}${pathOrUrl}` : pathOrUrl);

    const isFormDataBody = typeof FormData !== 'undefined' && options?.body instanceof FormData
    const incomingHeaders = { ...(options.headers || {}) }

    if (isFormDataBody) {
      Object.keys(incomingHeaders).forEach((key) => {
        if (key.toLowerCase() === 'content-type' && !incomingHeaders[key]) {
          delete incomingHeaders[key]
        }
      })
    }

    const headers = {
      ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
      ...incomingHeaders,
    };

    // Añadir header de empresa activa si está disponible
    if (activeCompany) {
      headers['X-Active-Company'] = activeCompany;
    }

    // Configurar las opciones para incluir cookies
    const fetchOptions = {
      ...options,
      headers,
      credentials: 'include', // Importante: incluir cookies
    };

    // Si tenemos un token, lo enviamos como header en lugar de cookie
    if (token) {
      // Enviar el token como header personalizado
      fetchOptions.headers['X-Session-Token'] = token;
    }

    try {
      const resp = await fetch(url, fetchOptions);

      // If token invalid or expired, auto-logout on 401/403
      // Pero no para endpoints de empresas que pueden tener errores temporales
      const isCompanyEndpoint = pathOrUrl.includes('/api/companies');
      if ((resp.status === 401 || resp.status === 403) && !isCompanyEndpoint) {
        logout();
      }

      return resp;
    } catch (err) {
      // Network error (e.g. backend down). Return a Response-like object so callers
      // that expect `resp.json()` / `resp.text()` don't crash.
      const message = err?.message || 'Error de conexión'
      return {
        ok: false,
        status: 0,
        statusText: 'NETWORK_ERROR',
        error: err,
        json: async () => ({ success: false, message }),
        text: async () => message
      }
    }
  }, [token, activeCompany]);

  // Función para obtener la empresa activa
  const getActiveCompany = useCallback(async () => {
    console.log('getActiveCompany called');
    try {
      console.log('Making request to /api/active-company (GET)');
      const response = await fetchWithAuth('/api/active-company');
      console.log('GET Response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('GET Response data:', data);
        if (data.success) {
          const company = data.data.active_company;
          setActiveCompany(company);
          localStorage.setItem('active_company', company || '');
          return company;
        }
      } else {
        let errorText = 'Error desconocido';
        try {
          if (response.text) {
            errorText = await response.text();
          } else if (response.error) {
            errorText = response.error.message || 'Error de conexión';
          }
        } catch (textError) {
          errorText = 'Error al leer respuesta del servidor';
        }
        console.error('GET Error response:', errorText);
      }
      return null;
    } catch (error) {
      console.error('Error obteniendo empresa activa:', error);
      return null;
    }
  }, [fetchWithAuth]);

  // Función para cargar empresas disponibles
  const loadAvailableCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const response = await fetchWithAuth('/api/companies');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAvailableCompanies(data.data || []);
          return data.data || [];
        }
      }
      return [];
    } catch (error) {
      console.error('Error loading companies:', error);
      return [];
    } finally {
      setCompaniesLoading(false);
    }
  }, [fetchWithAuth]);

  // Función para refrescar empresas disponibles
  const refreshCompanies = useCallback(async () => {
    console.log('Refreshing companies...');
    return await loadAvailableCompanies();
  }, [loadAvailableCompanies]);

  // Función para establecer la empresa activa
  const setActiveCompanyForUser = useCallback(async (companyName) => {
    console.log('setActiveCompanyForUser called with:', companyName);
    try {
      console.log('Making request to /api/active-company with body:', { company_name: companyName });
      const response = await fetchWithAuth('/api/active-company', {
        method: 'POST',
        body: JSON.stringify({ company_name: companyName })
      });
      
      console.log('Response status:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Response data:', data);
        if (data.success) {
          setActiveCompany(companyName);
          localStorage.setItem('active_company', companyName);
          return true;
        }
      } else {
        let errorText = 'Error desconocido';
        try {
          if (response.text) {
            errorText = await response.text();
          } else if (response.error) {
            errorText = response.error.message || 'Error de conexión';
          }
        } catch (textError) {
          errorText = 'Error al leer respuesta del servidor';
        }
        console.error('Error response:', errorText);
      }
      return false;
    } catch (error) {
      console.error('Error estableciendo empresa activa:', error);
      return false;
    }
  }, [fetchWithAuth]);

  // Función para limpiar la empresa activa
  const clearActiveCompany = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/active-company', {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setActiveCompany(null);
        localStorage.removeItem('active_company');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error limpiando empresa activa:', error);
      return false;
    }
  }, [fetchWithAuth]);

  // Cargar empresa activa al iniciar sesión
  useEffect(() => {
    console.log('AuthProvider useEffect triggered:', { isAuthenticated, token });
    if (isAuthenticated && token) {
      console.log('Calling getActiveCompany...');
      getActiveCompany();
    }
  }, [isAuthenticated, token]);

  const hasFeatureAccess = useCallback((featureId) => {
    if (!featureId) return true;
    if (!permissionsReady) return true;
    if (!FEATURE_ACCESS_MAP[featureId]) return true;
    return !!featureAccess[featureId];
  }, [featureAccess, permissionsReady]);

  const authContextValue = {
    token,
    user,
    isAuthenticated,
    loading,
    login,
    logout,
    fetchWithAuth,
    activeCompany,
    getActiveCompany,
    setActiveCompanyForUser,
    clearActiveCompany,
    availableCompanies,
    companiesLoading,
    loadAvailableCompanies,
    refreshCompanies,
    userRoles,
    featureAccess,
    permissionsReady,
    hasFeatureAccess,
    refreshUserProfile,
    roleDefinitions: ROLE_DEFINITIONS,
    featureMatrix: FEATURE_ACCESS_MAP
  };

  // PostMessage bridge for Handsontable iframe demo: allow iframe to ask parent to perform
  // authenticated fetches using fetchWithAuth. Replies with { type: 'ht-fetch-result'|'ht-search-result', id, success, data }
  useEffect(() => {
    // Message handler: provide a single items list to the iframe demo on demand.
    // Also support a simple mode switch from children (type: 'ht-set-mode').
    const currentItemType = { value: 'items' }

    function onMessage(ev) {
      try {
        const msg = ev.data || {};
        if (!msg || typeof msg !== 'object') return;

        // Allow children to set the desired mode (items|kits)
        if (msg.type === 'ht-set-mode' && msg.itemType) {
          try {
            currentItemType.value = msg.itemType
            console.log(`AuthProvider: ht-set-mode received, switching mode -> ${msg.itemType}`)
          } catch (e) {
            console.warn('AuthProvider: error handling ht-set-mode', e)
          }
          return
        }

        // Request: get full items list (with sale price). Parent will call /api/inventory/items or kits endpoint
        if (msg.type === 'ht-get-items-list' && msg.id) {
          (async () => {
            try {
              // Include active company if available
              const companyParam = activeCompany ? `?company=${encodeURIComponent(activeCompany)}` : '';

              // If current mode is 'kits', fetch kits list instead of inventory items
              if (currentItemType.value === 'kits') {
                console.log('AuthProvider: ht-get-items-list requested in KITS mode - fetching kits list for iframe')
                const resp = await fetchWithAuth(`/api/sales-price-lists/kits${companyParam}`)
                if (!resp || !resp.ok) {
                  console.warn('AuthProvider: failed to fetch kits list, status:', resp ? resp.status : 'no-response')
                  ev.source.postMessage({ type: 'ht-items-list-result', id: msg.id, success: false, status: resp ? resp.status : 0 }, ev.origin || '*')
                  return
                }
                const body = await resp.json()
                const rawItems = body && body.success && Array.isArray(body.data) ? body.data : []
                // Normalize kit objects so iframe can map by item_code/item_name
                const items = rawItems.map(k => ({
                  item_code: k.new_item_code || k.item_code || k.name || '',
                  item_name: k.item_name || k.name || '',
                  item_group: k.item_group || ''
                }))
                console.log(`AuthProvider: kits list fetched, raw_count=${rawItems.length}, normalized_count=${items.length}. Sending to iframe (id=${msg.id})`)
                ev.source.postMessage({ type: 'ht-items-list-result', id: msg.id, success: true, data: items }, ev.origin || '*')
                return
              }

              // Default: inventory items
              const resp = await fetchWithAuth(`/api/inventory/items${companyParam}`);
              if (!resp || !resp.ok) {
                ev.source.postMessage({ type: 'ht-items-list-result', id: msg.id, success: false, status: resp ? resp.status : 0 }, ev.origin || '*');
                return;
              }
              const body = await resp.json();
              // Return array of items (or empty array)
              const items = body && body.success && Array.isArray(body.data) ? body.data : [];
              console.log(`AuthProvider: inventory items fetched, count=${items.length}. Sending to iframe (id=${msg.id})`)
              ev.source.postMessage({ type: 'ht-items-list-result', id: msg.id, success: true, data: items }, ev.origin || '*');
            } catch (e) {
              ev.source.postMessage({ type: 'ht-items-list-result', id: msg.id, success: false, error: String(e) }, ev.origin || '*');
            }
          })();
        }
      } catch (e) {
        // ignore
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fetchWithAuth, activeCompany]);

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
}
