// src/hooks/useAdminInfo.js
import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../AuthProvider';
import API_ROUTES from '../apiRoutes';

export const useAdminInfo = () => {
  const [adminInfo, setAdminInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { fetchWithAuth } = useContext(AuthContext);

  const fetchAdminInfo = async () => {
    try {
      setLoading(true);
      if (!API_ROUTES.adminInfo) {
        // Endpoint removed on backend; skip calling and return null
        setAdminInfo(null);
        setError(null);
        return;
      }

      const response = await fetchWithAuth('/api/admin-info/');
      
      if (response.ok) {
        const data = await response.json();
        setAdminInfo(data);
        setError(null);
      } else if (response.status === 403) {
        // No es admin, esto está bien
        setAdminInfo(null);
        setError(null);
      } else {
        throw new Error(`Failed to fetch admin info: ${response.status}`);
      }
    } catch (err) {
      setError(err.message);
      setAdminInfo(null);
      console.error('Error fetching admin info:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminInfo();
  }, []);

  const startImpersonation = async (userId) => {
    try {
      const response = await fetchWithAuth('/api/start-impersonation/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId }),
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error('Failed to start impersonation');
      }
    } catch (err) {
      console.error('Error starting impersonation:', err);
      throw err;
    }
  };

  const stopImpersonation = async () => {
    try {
      const response = await fetchWithAuth('/api/stop-impersonation/', {
        method: 'POST',
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error('Failed to stop impersonation');
      }
    } catch (err) {
      console.error('Error stopping impersonation:', err);
      throw err;
    }
  };

  const getUsersForImpersonation = async () => {
    try {
      const response = await fetchWithAuth('/api/users-for-impersonation/');
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error('Failed to fetch users');
      }
    } catch (err) {
      console.error('Error fetching users for impersonation:', err);
      throw err;
    }
  };

  const getTenantInfo = async () => {
    try {
      const response = await fetchWithAuth('/api/tenant-info/');
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error('Failed to fetch tenant info');
      }
    } catch (err) {
      console.error('Error fetching tenant info:', err);
      throw err;
    }
  };

  return {
    adminInfo,
    loading,
    error,
    refetch: fetchAdminInfo,
    startImpersonation,
    stopImpersonation,
    getUsersForImpersonation,
    getTenantInfo,
  };
};