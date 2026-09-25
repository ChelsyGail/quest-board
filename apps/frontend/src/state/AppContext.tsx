import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import {apiClient, UserResourceData} from '../api';

interface AppContextValue {
  currentUser: UserResourceData | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setCurrentUser: (user: UserResourceData | null) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({children}: {children: React.ReactNode}) {
  const [currentUser, setCurrentUser] = useState<UserResourceData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    await apiClient.login({email, password});
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    apiClient.setAccessToken(null);
    setIsAuthenticated(false);
    setCurrentUser(null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({currentUser, isAuthenticated, login, logout, setCurrentUser}),
    [currentUser, isAuthenticated, login, logout],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
