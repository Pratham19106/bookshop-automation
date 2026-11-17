import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { getActiveShopId, setActiveShopId } from './api';

// The shop the user is working in. Its id is sent as X-Shop-Id on every API call; the server checks that the
// user may use it. Owners can switch between every shop, managers and staff between their assigned shops.
const ShopContext = createContext(null);

export function ShopProvider({ children }) {
  const { user, reloadSettings } = useAuth();
  const shops = useMemo(() => (user?.shops || []).filter((s) => s.active !== false), [user]);
  const [activeId, setActiveId] = useState(() => getActiveShopId());

  // Keep the stored shop valid for the signed-in user; fall back to their first shop.
  useEffect(() => {
    if (!shops.length) return;
    if (!shops.some((s) => s.id === activeId)) {
      setActiveId(shops[0].id);
      setActiveShopId(shops[0].id);
    }
  }, [shops, activeId]);

  const selectShop = useCallback((id) => {
    const n = Number(id);
    setActiveShopId(n);
    setActiveId(n);
    reloadSettings?.();
  }, [reloadSettings]);

  const value = useMemo(() => {
    const currentShop = shops.find((s) => s.id === activeId) || shops[0] || null;
    return { shops, currentShop, activeId: currentShop?.id ?? null, selectShop };
  }, [shops, activeId, selectShop]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  return useContext(ShopContext) || { shops: [], currentShop: null, activeId: null, selectShop: () => {} };
}
