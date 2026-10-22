import { useEffect, useRef, useState } from 'react';
import { get, qs } from './api';
import { fmt, label, STATUS_KIND } from './format';
import { fail } from './overlays';
import { useDebounced } from './hooks';
import { BookCover } from './cover';

// Run an async action; ignores re-entry while it runs (double-click safe) and reports errors as a toast.
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
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
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
      className={`border border-line bg-sheet text-ink p-0 shadow-dialog backdrop:bg-ink/55 ${wide ? 'w-[min(980px,96vw)]' : 'w-[min(560px,94vw)]'}`}>
      <div className="flex justify-between items-center px-5 py-3 border-b border-line bg-sheet sticky top-0 z-10">
        <h2 className="!mb-0 !text-[1.5rem]">{title}</h2>
        <button className="px-2 text-lg leading-none hover:bg-ink hover:text-paper" aria-label="Close" onClick={() => ref.current.close()}>✕</button>
      </div>
      <div className="px-5 py-4 max-h-[80vh] overflow-y-auto">{children}</div>
    </dialog>
  );
}

export const Actions = ({ children }) => <div className="flex flex-wrap gap-1.5 justify-end mt-3">{children}</div>;

export function Badge({ status, kind, children }) {
  const k = kind ?? STATUS_KIND[status] ?? '';
  return <span className={`badge ${k ? `badge-${k}` : ''}`}>{children ?? label(status)}</span>;
}

export const Tile = ({ k, v, s, tone = '' }) => (
  <div className="tile">
    <div className="tile-k">{k}</div>
    <div className={`tile-v ${tone === 'pos' ? 'text-olive' : tone === 'neg' ? 'text-brick' : ''}`}>{v}</div>
    {s ? <div className="tile-s">{s}</div> : null}
  </div>
);
export const tone = (c) => (c < 0 ? 'neg' : c > 0 ? 'pos' : '');

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// Renders loading / error / content for the result of useLoad().
export function Async({ state, children }) {
  if (state.loading && !state.data) return <div className="p-6 text-center text-muted">Loading…</div>;
  if (state.error) return <div className="error-box">{state.error.message}</div>;
  return state.data ? children(state.data) : null;
}

export const PageTitle = ({ children, actions }) => (
  <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-4 border-b border-ink/30">
    <h1>{children}</h1>
    <div className="flex gap-2 pb-1">{actions}</div>
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex flex-wrap mb-2.5">
    {tabs.map(([v, l]) => <button key={v} className={`btn tab ${value === v ? 'tab-active' : ''}`} onClick={() => onChange(v)}>{l}</button>)}
  </div>
);

export const Loc = ({ b }) => <span>{b.location || <span className="text-muted">not set</span>}</span>;

// Book search box with clickable results. Enter picks the book when exactly one matches (scanner/ISBN friendly).
export function BookPicker({ onPick, placeholder = 'Search title, author or ISBN…', showStock = true, autoFocus = false }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const dq = useDebounced(q.trim());
  useEffect(() => {
    let live = true;
    if (!dq) { setItems([]); return undefined; }
    get(`/books${qs({ q: dq, limit: 12 })}`).then((r) => { if (live) setItems(r.items); }).catch(fail);
    return () => { live = false; };
  }, [dq]);

  const pick = (b) => { onPick(b); setQ(''); setItems([]); };
  const onKey = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!q.trim()) return;
    try {
      const r = await get(`/books${qs({ q: q.trim(), limit: 12 })}`);
      if (r.items.length === 1) pick(r.items[0]);
    } catch (err) { fail(err); }
  };

  return (
    <div>
      <input type="search" className="input picker-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
        placeholder={placeholder} autoComplete="off" autoFocus={autoFocus} aria-label="Search books" />
      {dq ? (
        <div className="mt-1.5 max-h-[56vh] overflow-y-auto border border-line border-b-0">
          {items.length === 0 && <div className="p-3 text-center text-muted border-b border-line">No books match “{dq}”.</div>}
          {items.map((b) => (
            <button type="button" key={b.id} onClick={() => pick(b)}
              className={`result group w-full grid grid-cols-[auto_1fr_auto] gap-x-3 items-center text-left px-3 py-2 border-0 border-b border-line bg-sheet transition-colors duration-200 hover:bg-tint ${showStock && b.availableQty <= 0 ? 'opacity-60' : ''}`}>
              <BookCover book={b} w={34} className="row-span-1" />
              <span className="min-w-0">
                <span className="block font-serif font-bold leading-snug">{b.title}{b.edition && <em className="font-normal"> ({b.edition})</em>}</span>
                <span className="block text-muted text-[.82rem]">{b.author}{b.publisher ? ` · ${b.publisher}` : ''}{b.isbn ? <> · ISBN <span className="font-mono">{b.isbn}</span></> : ''}</span>
              </span>
              <span className="text-right font-mono text-[.82rem] flex flex-col">
                <strong>{fmt(b.priceCents)}</strong>
                {showStock && <span className={b.availableQty <= 0 ? 'text-terracotta' : b.isLowStock ? 'text-ochre' : 'text-muted'}>{b.availableQty} in stock{b.reservedQty ? ` (${b.reservedQty} reserved)` : ''}</span>}
                <span className="text-muted font-sans">{b.location || 'No location set'}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
