import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { AuthContext, type User } from './auth-context';
import { api, AUTH_TOKEN_KEY, UNAUTHORIZED_EVENT } from '@/lib/api-client';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch (e) {
      console.error('Failed to remove auth token', e);
    }
  }, []);

  const login = useCallback((newToken: string, userData: User) => {
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
    } catch (e) {
      console.error('Failed to save auth token', e);
    }
    setToken(newToken);
    setUser(userData);
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await api.get<{ user: User }>('/auth/me');
        setUser(response.data.user);
      } catch (error) {
        // 401s are handled by the interceptor, which emits UNAUTHORIZED_EVENT.
        console.error('Failed to restore session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, [token]);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [logout]);

  const value = useMemo(
    () => ({ user, token, isLoading, login, logout }),
    [user, token, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
