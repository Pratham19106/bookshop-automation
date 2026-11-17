import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from './auth';
import { get } from './api';
import { DEFAULT_FRANCHISES, getFranchises, subscribeToActivity } from './supabase';

const FranchiseContext = createContext(null);

export function FranchiseProvider({ children }) {
  const auth = useAuth();
  const user = auth?.user;
  const [franchises, setFranchises] = useState(DEFAULT_FRANCHISES);
  const [activeId, setActiveId] = useState(() => {
    return localStorage.getItem('bk_active_franchise') || DEFAULT_FRANCHISES[0].id;
  });

  const refreshFranchises = useCallback(async () => {
    try {
      const data = await get('/franchises');
      if (Array.isArray(data) && data.length > 0) {
        setFranchises(data);
        return data;
      }
    } catch {}

    try {
      const list = await getFranchises();
      if (list && list.length > 0) {
        setFranchises(list);
        return list;
      }
    } catch {}

    return franchises;
  }, [franchises]);

  // Initial load and sync with user authentication state
  useEffect(() => {
    if (user?.franchises && Array.isArray(user.franchises) && user.franchises.length > 0) {
      setFranchises(user.franchises);
      if (!user.franchises.some((f) => f.id === activeId)) {
        setActiveId(user.franchises[0].id);
      }
      return;
    }

    if (user) {
      refreshFranchises();
    } else {
      getFranchises().then((list) => {
        if (list && list.length > 0) {
          setFranchises(list);
        }
      });
    }
  }, [user, refreshFranchises]);

  // Re-verify activeId exists in current franchises
  useEffect(() => {
    if (franchises.length > 0 && !franchises.some((f) => f.id === activeId)) {
      setActiveId(franchises[0].id);
    }
  }, [franchises, activeId]);

  // Realtime subscription for multi-store additions/updates
  useEffect(() => {
    const unsub = subscribeToActivity((act) => {
      if (act?.event === 'franchise') {
        refreshFranchises();
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [refreshFranchises]);

  const selectFranchise = (id) => {
    setActiveId(id);
    localStorage.setItem('bk_active_franchise', id);
  };

  const currentFranchise = useMemo(() => {
    return franchises.find((f) => f.id === activeId) || franchises[0] || DEFAULT_FRANCHISES[0];
  }, [franchises, activeId]);

  const value = useMemo(
    () => ({
      franchises,
      currentFranchise,
      activeId: currentFranchise ? currentFranchise.id : '',
      selectFranchise,
      refreshFranchises,
      hasOutlets: franchises.length > 0,
    }),
    [franchises, currentFranchise, refreshFranchises]
  );

  return <FranchiseContext.Provider value={value}>{children}</FranchiseContext.Provider>;
}

export function useFranchise() {
  const ctx = useContext(FranchiseContext);
  if (!ctx) {
    return {
      franchises: DEFAULT_FRANCHISES,
      currentFranchise: DEFAULT_FRANCHISES[0],
      activeId: DEFAULT_FRANCHISES[0].id,
      selectFranchise: () => {},
      refreshFranchises: async () => DEFAULT_FRANCHISES,
      hasOutlets: true,
    };
  }
  return ctx;
}
