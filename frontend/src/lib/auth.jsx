import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post } from './api';
import { setCurrency } from './format';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettingsState] = useState({ currencySymbol: '₹', taxPercent: 0, staffMaxDiscountPercent: 10, shopName: 'Bookshop' });
  const [ready, setReady] = useState(false);

  const setSettings = useCallback((s) => { setCurrency(s.currencySymbol); setSettingsState(s); }, []);

  const load = useCallback(async () => {
    try {
      const me = await get('/auth/me');
      setSettings(await get('/settings'));
      setUser(me.user);
    } catch { setUser(null); }
    setReady(true);
  }, [setSettings]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);

  const value = useMemo(() => ({
    user, settings, setSettings, ready, isOwner: user?.role === 'owner',
    login: async (username, password) => { await post('/auth/login', { username, password }); await load(); },
    registerBusiness: async (data) => { const res = await post('/auth/register-business', data); await load(); return res; },
    logout: async () => { try { await post('/auth/logout'); } finally { setUser(null); } },
  }), [user, settings, ready, load, setSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
