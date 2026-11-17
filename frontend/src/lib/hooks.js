import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getActiveShopId } from './api';

// Load data with loading/error state; reload() refetches. A newer request supersedes an older one.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => { if (id === seq.current) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (id === seq.current) setState({ data: null, error, loading: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

// Cached load (TanStack Query) with the same shape as useLoad: { data, error, loading, reload }.
// key = [group, ...parts]; the active shop is added automatically so shops never share cached data.
// Data stays cached across page visits until an activity event marks its group stale (see queryClient.js).
// reload() marks the whole group stale, so related lists refresh too.
export function useCached(key, fn, { enabled = true } = {}) {
  const client = useQueryClient();
  const queryKey = [key[0], getActiveShopId(), ...key.slice(1)];
  const isReport = key[0] === 'dashboard';
  const q = useQuery({ queryKey, queryFn: fn, enabled,
    // SSE normally refreshes immediately. Polling catches changes missed during an outage or across API instances.
    refetchInterval: isReport ? 30000 : false,
    refetchIntervalInBackground: isReport,
    refetchOnWindowFocus: isReport ? 'always' : false,
  });
  const group = key[0];
  const reload = useCallback(() => client.invalidateQueries({ queryKey: [group] }), [client, group]);
  return { data: enabled ? q.data ?? null : null, error: q.error, loading: enabled && q.isFetching, reload };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
