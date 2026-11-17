import { useSyncExternalStore } from 'react';
import { API_BASE } from './api';
import { emitLocal } from './events';
import { queryClient } from './queryClient';

// Live updates from the server (Server-Sent Events on /api/events).
// Each event names what changed (sale, return, books, orders...); queryClient.js turns it into "reload these screens".
// The browser reconnects by itself; after every reconnect everything is marked stale so nothing missed is lost.

let status = 'off'; // 'off' | 'connecting' | 'live' | 'reconnecting'
const watchers = new Set();
function setStatus(s) {
  if (s === status) return;
  status = s;
  watchers.forEach((fn) => fn());
}

export function useLiveStatus() {
  return useSyncExternalStore((fn) => { watchers.add(fn); return () => watchers.delete(fn); }, () => status, () => status);
}

export function startRealtime() {
  if (typeof EventSource === 'undefined') return () => {};
  setStatus('connecting');
  const es = new EventSource(`${API_BASE}/api/events`, { withCredentials: true });
  es.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    if (data.event === 'ready') {
      // A request may have completed before this stream became ready; refresh on initial connection too.
      queryClient.invalidateQueries();
      setStatus('live');
      return;
    }
    emitLocal(data.event, data);
  };
  es.onerror = () => {
    // CLOSED means the server refused (e.g. signed out); otherwise the browser is retrying.
    setStatus(es.readyState === EventSource.CLOSED ? 'off' : 'reconnecting');
  };
  return () => { es.close(); setStatus('off'); };
}
