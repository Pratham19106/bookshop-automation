import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { DEFAULT_FRANCHISES, getFranchises } from './supabase';

const FranchiseContext = createContext(null);

export function FranchiseProvider({ children }) {
  const [franchises, setFranchises] = useState(DEFAULT_FRANCHISES);
  const [activeId, setActiveId] = useState(() => {
    return localStorage.getItem('bk_active_franchise') || DEFAULT_FRANCHISES[0].id;
  });

  useEffect(() => {
    let mounted = true;
    getFranchises().then((list) => {
      if (mounted && list && list.length >= 2) {
        setFranchises(list);
        if (!list.some((f) => f.id === activeId)) {
          setActiveId(list[0].id);
        }
      }
    });
    return () => {
      mounted = false;
    };
  }, [activeId]);

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
      activeId: currentFranchise.id,
      selectFranchise,
      hasMultiFranchiseConstraint: franchises.length >= 2,
    }),
    [franchises, currentFranchise]
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
      hasMultiFranchiseConstraint: true,
    };
  }
  return ctx;
}

