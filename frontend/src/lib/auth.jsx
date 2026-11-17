import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setActiveShopId } from './api';
import { setCurrency } from './format';
import { queryClient } from './queryClient';
import { startRealtime } from './realtime';
import { subscribeToActivity } from './events';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const RANK = { staff: 0, manager: 1, owner: 2 };
export const atLeast = (role, min) => (RANK[role] ?? -1) >= RANK[min];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettingsState] = useState({ currencySymbol: '₹', taxPercent: 0, staffMaxDiscountPercent: 10, managerMaxDiscountPercent: 25, shopName: 'Bookshop' });
  const [ready, setReady] = useState(false);

  const setSettings = useCallback((s) => { setCurrency(s.currencySymbol); setSettingsState(s); }, []);
  const reloadSettings = useCallback(async () => { try { setSettings(await get('/settings')); } catch { /* signed out */ } }, [setSettings]);

  const load = useCallback(async () => {
    try {
      const me = await get('/auth/me');
      setUser(me.user);
      await reloadSettings();
    } catch { setUser(null); }
    setReady(true);
  }, [reloadSettings]);

  useEffect(() => { load(); }, [load]);
  // Live updates while signed in; business settings / shops changed elsewhere are picked up at once.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    const stop = startRealtime();
    const unsub = subscribeToActivity(({ event }) => { if (event === 'admin') load(); }); // shops, role, settings
    return () => { unsub(); stop(); };
  }, [userId, load]);
  useEffect(() => {
    const expired = () => { queryClient.clear(); setUser(null); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user, settings, setSettings, reloadSettings, ready, role,
      isOwner: role === 'owner',
      // Managers and owners: stock control, suppliers, purchasing, costs, reports.
      isManager: atLeast(role, 'manager'),
      // Highest discount the signed-in user may give at the counter.
      maxDiscountPercent: role === 'owner' ? 100 : role === 'manager' ? settings.managerMaxDiscountPercent : settings.staffMaxDiscountPercent,
      refreshUser: load,
      login: async (username, password) => { await post('/auth/login', { username, password }); await load(); },
      registerBusiness: async (data) => { const res = await post('/auth/register-business', data); await load(); return res; },
      logout: async () => { try { await post('/auth/logout'); } finally { queryClient.clear(); setActiveShopId(null); setUser(null); } },
    };
  }, [user, settings, ready, load, setSettings, reloadSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
