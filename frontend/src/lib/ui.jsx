import { useEffect, useRef, useState } from 'react';
import { get, getActiveShopId, qs } from './api';
import { useQueryClient } from '@tanstack/react-query';
import { fmt, label, STATUS_KIND } from './format';
import { fail } from './overlays';
import { useCached, useDebounced } from './hooks';
import { BookCover } from './cover';

// Run an async action; ignores re-entry while it runs (double-click safe) and reports errors as a toast.
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const run = async (e) => {
    e?.preventDefault?.();
    if (running.current) return undefined;
    running.current = true; setBusy(true);
    try { return await fn(e); } catch (err) { fail(err); return undefined; } finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return [run, busy];
}

export function Button({ onClick, variant = '', small = false, className = '', disabled, children, type = 'button', ...rest }) {
  const [run, busy] = useAction(onClick || (() => {}));
  const cls = `btn ${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'link' ? 'btn-link' : ''} ${small ? 'btn-sm' : ''} ${className}`;
  return <button type={type} className={cls} disabled={disabled || busy} onClick={type === 'submit' ? undefined : run} {...rest}>{children}</button>;
}

export function Field({ label: text, htmlFor, children, className = '' }) {
  return <div className={`field ${className}`}><label htmlFor={htmlFor}>{text}</label>{children}</div>;
}

export function Modal({ title, wide = false, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
      className={`border-2 border-black bg-white text-black p-0 shadow-hard-lg backdrop:bg-black/60 ${wide ? 'w-[min(980px,96vw)]' : 'w-[min(580px,94vw)]'} animate-stamp`}
    >
      <div className="flex justify-between items-center px-4 py-2.5 border-b-2 border-black bg-[#1A1A1A] text-white sticky top-0 z-10">
        <h2 className="!mb-0 font-serif font-black text-lg text-[#FAF9F5] tracking-tight">{title}</h2>
        <button
          className="w-7 h-7 flex items-center justify-center font-mono font-bold text-xs bg-[#CCFF00] text-black border border-black hover:bg-white hover:text-black transition-colors"
          aria-label="Close"
          onClick={() => ref.current.close()}
        >
          ✕
        </button>
      </div>
      <div className="p-3 sm:p-4 max-h-[82vh] max-h-[82dvh] overflow-y-auto bg-white">{children}</div>
    </dialog>
  );
}

export const Actions = ({ children }) => <div className="flex flex-wrap gap-2 justify-end mt-4 pt-2 border-t border-[#E5E7EB]">{children}</div>;

export function Badge({ status, kind, children }) {
  const k = kind ?? STATUS_KIND[status] ?? '';
  return <span className={`badge ${k ? `badge-${k}` : ''}`}>{children ?? label(status)}</span>;
}

export const Tile = ({ k, v, s, tone = '' }) => (
  <div className="tile">
    <div className="tile-k">{k}</div>
    <div className={`tile-v ${tone === 'pos' ? 'text-[#15803D]' : tone === 'neg' ? 'text-[#BE123C]' : ''}`}>{v}</div>
    {s ? <div className="tile-s">{s}</div> : null}
  </div>
);
export const tone = (c) => (c < 0 ? 'neg' : c > 0 ? 'pos' : '');

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// Renders loading / error / content for the result of useLoad().
export function Async({ state, children }) {
  if (state.loading && !state.data) {
    return (
      <div className="p-8 text-center text-muted font-mono flex items-center justify-center gap-2">
        <span className="w-2.5 h-2.5 bg-[#4F46E5] animate-ping inline-block"></span>
        Loading data…
      </div>
    );
  }
  if (state.error && !state.data) return <div className="error-box">{state.error.message}</div>;
  if (state.error) return <><div className="error-box" role="status">Could not refresh: {state.error.message}. Showing last loaded data.</div>{children(state.data)}</>;
  return state.data ? children(state.data) : null;
}

export const PageTitle = ({ children, actions }) => (
  <div className="flex flex-wrap justify-between items-end gap-2.5 mb-3.5 pb-2.5 border-b-2 border-black">
    <div className="flex items-center gap-2">
      <h1 className="!border-0 !mb-0 pb-0">{children}</h1>
    </div>
    <div className="flex flex-wrap items-center gap-2">{actions}</div>
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex flex-wrap mb-3 gap-1">
    {tabs.map(([v, l]) => (
      <button
        key={v}
        className={`tab ${value === v ? 'tab-active' : ''}`}
        onClick={() => onChange(v)}
      >
        {l}
      </button>
    ))}
  </div>
);

export const Loc = ({ b }) => <span>{b.location || <span className="text-muted">not set</span>}</span>;

// Book search box with clickable results. Enter picks the book when exactly one matches (scanner/ISBN friendly).
export function BookPicker({ onPick, placeholder = 'Search title, author or ISBN…', showStock = true, autoFocus = false }) {
  const [q, setQ] = useState('');
  const client = useQueryClient();
  const dq = useDebounced(q.trim());
  const search = useCached(['books', 'picker', dq], () => get(`/books${qs({ q: dq, limit: 12 })}`), { enabled: !!dq });
  const items = q.trim() === dq ? search.data?.items || [] : [];

  const pick = (b) => { onPick(b); setQ(''); };
  const onKey = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!q.trim()) return;
    try {
      const term = q.trim();
      const r = await client.fetchQuery({ queryKey: ['books', getActiveShopId(), 'picker', term], queryFn: () => get(`/books${qs({ q: term, limit: 12 })}`), staleTime: 0 });
      if (r.items.length === 1) pick(r.items[0]);
    } catch (err) { fail(err); }
  };

  return (
    <div>
      <input
        type="search"
        className="input picker-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label="Search books"
      />
      {q.trim() && q.trim() === dq ? (
        <div className="mt-2 max-h-[56vh] overflow-y-auto border-2 border-black bg-white shadow-hard">
          {search.error && !search.data ? <div className="p-4 error-box">{search.error.message}</div> : search.loading && !search.data ? <div className="p-4 text-center text-muted">Searching…</div> : items.length === 0 && <div className="p-4 text-center text-muted font-serif">No books match “{dq}”.</div>}
          {items.map((b) => (
            <button
              type="button"
              key={b.id}
              onClick={() => pick(b)}
              className={`result group w-full grid grid-cols-[1fr_auto] gap-x-3 text-left px-3 py-2 border-0 border-b border-[#E2E8F0] last:border-b-0 bg-white hover:bg-[#1A1A1A] hover:text-[#CCFF00] transition-colors ${
                showStock && b.availableQty <= 0 ? 'opacity-60' : ''
              }`}
            >
              <span className="font-serif font-bold text-sm text-black group-hover:text-[#CCFF00]">
                {b.title}{b.edition && <em className="font-normal opacity-80"> ({b.edition})</em>}
              </span>
              <span className="row-span-2 text-right font-mono text-[.82rem] flex flex-col">
                <strong className="text-black group-hover:text-[#CCFF00]">{fmt(b.priceCents)}</strong>
                {showStock && (
                  <span className={b.availableQty <= 0 ? 'text-[#BE123C] group-hover:text-[#CCFF00] font-bold' : b.isLowStock ? 'text-[#B45309] group-hover:text-[#CCFF00] font-bold' : 'text-[#15803D] group-hover:text-[#CCFF00]'}>
                    {b.availableQty} in stock{b.reservedQty ? ` (${b.reservedQty} reserved)` : ''}
                  </span>
                )}
                <span className="text-muted group-hover:text-[#FAF9F5] font-sans text-xs">{b.location || 'No location set'}</span>
              </span>
              <span className="text-muted group-hover:text-[#FAF9F5] text-xs">
                {b.author}{b.publisher ? ` · ${b.publisher}` : ''}{b.isbn ? <> · ISBN <span className="font-mono">{b.isbn}</span></> : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
