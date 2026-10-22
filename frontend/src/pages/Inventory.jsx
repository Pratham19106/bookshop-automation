import { useState } from 'react';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BookCover } from '../lib/cover';
import { MotionTr } from '../lib/motion';
import { useDebounced, useLoad } from '../lib/hooks';
import { Async, Badge, Empty, PageTitle } from '../lib/ui';
import { AdjustDialog, BookDetail } from './Catalogue';

// Dense stock ledger: one row per title with on-hand, reserved, available and status.
export default function Inventory() {
  const { isOwner } = useAuth();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [open, setOpen] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const dq = useDebounced(q);
  const st = useLoad(() => get(`/inventory${qs({ q: dq, low })}`), [dq, low]);

  return (
    <div>
      <PageTitle>Inventory</PageTitle>
      <div className="toolbar">
        <div className="flex-1 min-w-[200px]"><label htmlFor="q">Search</label><input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="!normal-case !font-normal !tracking-normal !text-[.9rem] !text-ink flex items-center gap-1"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
      </div>
      <Async state={st}>
        {(rows) => (
          <>
            {!low && rows.some((r) => r.isLowStock) && <div className="notice notice-warn">{rows.filter((r) => r.isLowStock).length} title(s) are at or below their low-stock threshold.</div>}
            {rows.length === 0 ? <Empty>Nothing to show.</Empty> : (
              <div className="table-wrap">
                <table className="ledger">
                  <thead><tr><th>Title</th><th>Location</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th><th className="num">Alert at</th><th>Status</th>{isOwner && <th />}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <MotionTr i={i} key={r.id} className="row-click" onClick={() => setOpen(r.id)}>
                        <td><div className="flex gap-3 items-center"><BookCover book={r} w={30} /><div><strong>{r.title}</strong>{r.edition && <em className="text-muted"> ({r.edition})</em>}<div className="text-muted text-[.8rem]">{r.author}</div></div></div></td>
                        <td>{[r.aisle && `Aisle ${r.aisle}`, r.rack && `Rack ${r.rack}`, r.shelf && `Shelf ${r.shelf}`].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="num">{r.stockQty}</td><td className="num">{r.reservedQty}</td><td className="num font-bold">{r.availableQty}</td>
                        <td className="num">{r.threshold}{r.thresholdIsDefault && <span className="text-muted text-[.75rem] font-sans"> (default)</span>}</td>
                        <td>{r.availableQty <= 0 ? <Badge kind="bad">out of stock</Badge> : r.isLowStock ? <Badge kind="warn">low</Badge> : <Badge kind="ok">ok</Badge>}</td>
                        {isOwner && <td><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setAdjust(r); }}>Correct…</button></td>}
                      </MotionTr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Async>
      {open && <BookDetail id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
      {adjust && <AdjustDialog book={adjust} onClose={() => setAdjust(null)} onDone={st.reload} />}
    </div>
  );
}
