import { createContext, useContext, useEffect, useState } from 'react';
import api, { setCsrfToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      const [csrfResult, sessionResult] = await Promise.allSettled([
        api.get('/auth/csrf'),
        api.get('/auth/me'),
      ]);

      if (!active) return;

      if (csrfResult.status === 'fulfilled') {
        setCsrfToken(csrfResult.value.data.csrfToken);
      }

      if (sessionResult.status === 'fulfilled') {
        setUser(sessionResult.value.data);
      } else {
        setUser(null);
      }

      setLoading(false);
    };
    loadSession();

    const handleExpired = () => setUser(null);
    window.addEventListener('auth:expired', handleExpired);
    return () => {
      active = false;
      window.removeEventListener('auth:expired', handleExpired);
    };
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setCsrfToken(res.data.csrfToken);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken('');
      setUser(null);
    }
  };

  const updateUser = (updated) => setUser(updated);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
