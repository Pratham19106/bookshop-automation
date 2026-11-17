// In-app activity bus. Pages announce changes (a sale, a refund, a void...) and other open pages refresh.
// Works within a tab (window events) and across tabs of the same browser (BroadcastChannel).
// The browser never talks to the database directly: all data goes through the API.

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bookshop-activity') : null;

export function broadcastEvent(event, payload = {}) {
  const detail = { event, payload };
  try { window.dispatchEvent(new CustomEvent('bookshop:activity', { detail })); } catch { /* not in a browser */ }
  try { channel?.postMessage(detail); } catch { /* payload not cloneable */ }
}

// This tab only (used for events that arrive from the server: every tab has its own server connection).
export function emitLocal(event, payload = {}) {
  try { window.dispatchEvent(new CustomEvent('bookshop:activity', { detail: { event, payload } })); } catch { /* not in a browser */ }
}

export function subscribeToActivity(callback) {
  const onLocal = (e) => callback(e.detail);
  const onRemote = (e) => callback(e.data);
  window.addEventListener('bookshop:activity', onLocal);
  channel?.addEventListener('message', onRemote);
  return () => {
    window.removeEventListener('bookshop:activity', onLocal);
    channel?.removeEventListener('message', onRemote);
  };
}
