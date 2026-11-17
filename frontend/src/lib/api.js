export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
  }
}

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const SHOP_KEY = 'bk_active_shop';

// The active shop is remembered per browser and sent with every request (the server validates it).
export function getActiveShopId() {
  try { const v = Number(localStorage.getItem(SHOP_KEY)); return Number.isInteger(v) && v > 0 ? v : null; } catch { return null; }
}
export function setActiveShopId(id) {
  try { if (id) localStorage.setItem(SHOP_KEY, String(id)); else localStorage.removeItem(SHOP_KEY); } catch { /* storage blocked */ }
}

export async function api(method, path, body) {
  const shopId = getActiveShopId();
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bookshop', ...(shopId ? { 'X-Shop-Id': String(shopId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { message: 'Cannot reach the server. Check that it is running.' } });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('session-expired'));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

// Build a query string, skipping blank values.
export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined && v !== false) p.set(k, v === true ? '1' : v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}
