import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '../../shared/constants';
import { api } from './api';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
    const onUnauth = () => setUser(null);
    window.addEventListener('waymore:unauthorized', onUnauth);
    return () => window.removeEventListener('waymore:unauthorized', onUnauth);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User }>('/auth/login', { email, password });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const can = useCallback((...roles: Role[]) => !!user && (user.role === 'admin' || roles.includes(user.role)), [user]);

  return <Ctx.Provider value={{ user, ready, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
