import { useState } from 'react';
import { get, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BookCover } from '../lib/cover';
import { MotionTr } from '../lib/motion';
import { fmt, fmtDateTime, money, parseMoney } from '../lib/format';
import { useDebounced, useLoad } from '../lib/hooks';
import { confirmBox, toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Empty, Field, Loc, Modal, PageTitle, useAction } from '../lib/ui';

const REASONS = { sale: 'Sale', sale_void: 'Sale voided', receipt: 'Goods received', adjustment: 'Stock count correction', opening: 'Opening stock' };

// Add/edit form. Stock is not editable here: it only changes through sales, receipts and counted corrections.
export function BookForm({ book, onClose, onSaved }) {
  const { settings } = useAuth();
  const edit = !!book;
  const [f, setF] = useState({
    title: book?.title ?? '', author: book?.author ?? '', isbn: book?.isbn ?? '', publisher: book?.publisher ?? '', edition: book?.edition ?? '', genre: book?.genre ?? '',
    price: book ? money(book.priceCents) : '', threshold: book && !book.thresholdIsDefault ? String(book.lowStockThreshold) : '',
    openingStock: '0', aisle: book?.aisle ?? '', rack: book?.rack ?? '', shelf: book?.shelf ?? '',
  });
  const genres = useLoad(() => get('/books/genres'), []);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const [save, busy] = useAction(async () => {
    const price = parseMoney(f.price);
    if (price === null) throw new Error('Enter the price like 199 or 199.50');
    const body = {
      title: f.title, author: f.author, isbn: f.isbn, publisher: f.publisher, edition: f.edition, genre: f.genre, priceCents: price,
      aisle: f.aisle, rack: f.rack, shelf: f.shelf, lowStockThreshold: f.threshold === '' ? null : Number(f.threshold),
    };
    if (!edit) body.openingStock = Number(f.openingStock || 0);
    const saved = edit ? await put(`/books/${book.id}`, body) : await post('/books', body);
    toast(edit ? 'Book updated' : 'Book added');
    onSaved?.(saved); onClose();
  });
  const inp = (k, label, extra = {}) => (
    <Field label={label} htmlFor={`f-${k}`}><input id={`f-${k}`} className="input" value={f[k]} onChange={set(k)} {...extra} /></Field>
  );
  return (
    <Modal title={edit ? `Edit: ${book.title}` : 'Add a book'} wide onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid sm:grid-cols-2 gap-x-2.5">
          {inp('title', 'Title *', { required: true, maxLength: 300 })}
          {inp('author', 'Author *', { required: true, maxLength: 200 })}
          {inp('isbn', 'ISBN (10 or 13 digits)', { maxLength: 20, className: 'input font-mono' })}
          {inp('publisher', 'Publisher', { maxLength: 200 })}
          {inp('edition', 'Edition (e.g. 2nd, Paperback 2021)', { maxLength: 100 })}
          {inp('genre', 'Genre', { maxLength: 100, list: 'genres' })}
          {inp('price', `Selling price (${settings.currencySymbol}) *`, { required: true, inputMode: 'decimal', className: 'input font-mono' })}
          {inp('threshold', `Low-stock alert at (blank = shop default ${settings.defaultLowStockThreshold})`, { type: 'number', min: 0, className: 'input font-mono' })}
          {!edit && inp('openingStock', 'Opening stock', { type: 'number', min: 0, className: 'input font-mono' })}
        </div>
        <datalist id="genres">{(genres.data || []).map((g) => <option key={g} value={g} />)}</datalist>
        <h3>Shelf location</h3>
        <div className="grid grid-cols-3 gap-x-2.5">{inp('aisle', 'Aisle', { maxLength: 30 })}{inp('rack', 'Rack', { maxLength: 30 })}{inp('shelf', 'Shelf', { maxLength: 30 })}</div>
        <p className="text-muted text-[.85rem]">A different edition of the same title is a separate record with its own ISBN and stock.</p>
        <Actions><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{edit ? 'Save changes' : 'Add book'}</button></Actions>
      </form>
    </Modal>
  );
}

export function AdjustDialog({ book, onClose, onDone }) {
  const [counted, setCounted] = useState(String(book.stockQty));
  const [why, setWhy] = useState('');
  const apply = async () => {
    await post(`/books/${book.id}/adjust`, { countedQty: Number(counted), reason: why });
    toast('Stock corrected'); onDone?.(); onClose();
  };
  return (
    <Modal title={`Correct stock: ${book.title}`} onClose={onClose}>
      <p className="mb-2">System shows <strong className="font-mono">{book.stockQty}</strong> on hand{book.reservedQty ? ` (${book.reservedQty} reserved for phone orders)` : ''}. Enter the quantity you physically counted.</p>
      <Field label="Counted quantity" htmlFor="cnt"><input id="cnt" type="number" min={book.reservedQty} className="input font-mono" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
      <Field label="Reason (required, kept in the audit trail)" htmlFor="why"><input id="why" className="input" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. 2 copies damaged" /></Field>
      <Actions><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply}>Apply correction</Button></Actions>
    </Modal>
  );
}

export function BookDetail({ id, onClose, onChange }) {
  const { isOwner } = useAuth();
  const st = useLoad(async () => {
    const [book, moves, sup] = await Promise.all([get(`/books/${id}`), get(`/books/${id}/movements?limit=30`), isOwner ? get(`/books/${id}/suppliers`) : Promise.resolve(null)]);
    return { book, moves, sup };
  }, [id]);
  const [sub, setSub] = useState(null); // 'edit' | 'adjust'
  const changed = () => { st.reload(); onChange?.(); };

  return (
    <>
      <Modal title={st.data?.book.title ?? 'Book'} wide onClose={onClose}>
        <Async state={st}>
          {({ book: b, moves, sup }) => (
            <>
              <div className="flex gap-7 items-start mb-2">
              <BookCover book={b} w={130} className="mt-1" />
              <dl className="kv flex-1">
                <dt>Author</dt><dd>{b.author}</dd>
                <dt>Edition</dt><dd>{b.edition || '—'}{b.publisher && ` · ${b.publisher}`}</dd>
                <dt>ISBN</dt><dd className="font-mono">{b.isbn || '—'}</dd>
                <dt>Genre</dt><dd>{b.genre || '—'}</dd>
                <dt>Location</dt><dd><strong><Loc b={b} /></strong></dd>
                <dt>Price</dt><dd><span className="font-mono">{fmt(b.priceCents)}</span>{isOwner && <span className="text-muted text-[.85rem]"> · avg cost {b.costCents ? fmt(b.costCents) : 'unknown'}</span>}</dd>
                <dt>Stock</dt>
                <dd><strong className="font-mono">{b.stockQty}</strong> on hand · {b.reservedQty} reserved · <strong className={b.isLowStock ? 'text-ochre' : ''}>{b.availableQty} available</strong>
                  <span className="text-muted text-[.85rem]"> (alert at {b.lowStockThreshold}{b.thresholdIsDefault ? ', shop default' : ''})</span></dd>
                <dt>Status</dt><dd>{b.active ? <Badge kind="ok">active</Badge> : <Badge kind="bad">retired</Badge>}</dd>
              </dl>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn" onClick={() => setSub('edit')}>Edit details</button>
                {isOwner && <button className="btn" onClick={() => setSub('adjust')}>Correct stock…</button>}
                {isOwner && (
                  <Button variant={b.active ? 'danger' : ''} onClick={async () => {
                    if (b.active && !(await confirmBox(`Retire “${b.title}”? It will disappear from billing and search but keep its history.`))) return;
                    await post(`/books/${id}/active`, { active: !b.active });
                    toast(b.active ? 'Title retired' : 'Title restored'); changed();
                  }}>{b.active ? 'Retire title' : 'Restore title'}</Button>
                )}
              </div>
              {isOwner && (
                <>
                  <h3>Suppliers for this book</h3>
                  {sup.length === 0 ? <p className="text-muted">No supplier is linked yet. Add quotes from the Suppliers page.</p> : (
                    <div className="table-wrap"><table className="ledger">
                      <thead><tr><th>Supplier</th><th className="num">Quoted cost</th><th className="num">Last paid</th><th className="num">Bought</th><th className="num">Lead time</th></tr></thead>
                      <tbody>{sup.map((s) => (
                        <tr key={s.supplierId}>
                          <td>{s.name} {s.isCheapest && sup.length > 1 && <Badge kind="ok">cheapest</Badge>}<div className="text-muted text-[.8rem]">{s.phone} {s.email}</div></td>
                          <td className="num">{fmt(s.unitCostCents)}</td><td className="num">{s.lastPaidCents != null ? fmt(s.lastPaidCents) : '—'}</td>
                          <td className="num">{s.qtyPurchased}</td><td className="num">{s.leadTimeDays} d</td>
                        </tr>))}</tbody>
                    </table></div>
                  )}
                </>
              )}
              <h3>Recent stock movements</h3>
              {moves.length === 0 ? <p className="text-muted">No movements yet.</p> : (
                <div className="table-wrap"><table className="ledger">
                  <thead><tr><th>When</th><th>Reason</th><th className="num">Change</th><th>Note</th></tr></thead>
                  <tbody>{moves.map((m) => (
                    <tr key={m.id}><td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</td><td>{REASONS[m.reason] || m.reason}</td>
                      <td className={`num ${m.delta < 0 ? 'text-brick' : 'text-olive'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                      <td>{m.note}{m.user && <span className="text-muted text-[.8rem]"> ({m.user})</span>}</td></tr>))}</tbody>
                </table></div>
              )}
            </>
          )}
        </Async>
      </Modal>
      {sub === 'edit' && st.data && <BookForm book={st.data.book} onClose={() => setSub(null)} onSaved={changed} />}
      {sub === 'adjust' && st.data && <AdjustDialog book={st.data.book} onClose={() => setSub(null)} onDone={changed} />}
    </>
  );
}

export default function Catalogue() {
  const { isOwner } = useAuth();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [low, setLow] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const genres = useLoad(() => get('/books/genres'), []);
  const st = useLoad(() => get(`/books${qs({ q: dq, genre, low, inactive, limit: 100 })}`), [dq, genre, low, inactive]);

  return (
    <div>
      <PageTitle actions={<button id="add" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add book</button>}>Catalogue</PageTitle>
      <div className="toolbar">
        <div className="flex-1 min-w-[200px]"><label htmlFor="q">Search title, author, ISBN, publisher</label><input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <div><label htmlFor="genre">Genre</label>
          <select id="genre" className="input" value={genre} onChange={(e) => setGenre(e.target.value)}><option value="">All</option>{(genres.data || []).map((g) => <option key={g}>{g}</option>)}</select></div>
        <label className="!normal-case !font-normal !tracking-normal !text-[.9rem] !text-ink flex items-center gap-1"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
        {isOwner && <label className="!normal-case !font-normal !tracking-normal !text-[.9rem] !text-ink flex items-center gap-1"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show retired</label>}
      </div>
      <Async state={st}>
        {(r) => r.items.length === 0 ? <Empty>No books found. {q && 'Try fewer words, or '}<button className="btn btn-link" onClick={() => setAdding(true)}>add a new book</button>.</Empty> : (
          <>
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th className="num">Price</th><th className="num">In stock</th><th>Location</th></tr></thead>
                <tbody>
                  {r.items.map((b, i) => (
                    <MotionTr i={i} key={b.id} className="row-click" onClick={() => setOpen(b.id)}>
                      <td><div className="flex gap-3 items-center"><BookCover book={b} w={38} /><div><strong>{b.title}</strong>{b.edition && <em className="text-muted"> ({b.edition})</em>} {!b.active && <Badge kind="bad">retired</Badge>}
                        <div className="text-muted text-[.8rem]">{b.publisher}</div></div></div></td>
                      <td>{b.author}</td>
                      <td className="font-mono text-[.85rem] whitespace-nowrap">{b.isbn || <span className="text-muted">none</span>}</td>
                      <td className="num">{fmt(b.priceCents)}</td>
                      <td className="num"><span className={b.availableQty <= 0 ? 'text-brick' : b.isLowStock ? 'text-ochre' : ''}>{b.availableQty}</span>{b.reservedQty > 0 && <div className="text-muted text-[.8rem] font-sans">{b.reservedQty} reserved</div>}</td>
                      <td><Loc b={b} /></td>
                    </MotionTr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted text-[.85rem] mt-1">{r.total > r.items.length ? `Showing ${r.items.length} of ${r.total} — refine your search.` : `${r.total} title(s)`}</p>
          </>
        )}
      </Async>
      {adding && <BookForm onClose={() => setAdding(false)} onSaved={st.reload} />}
      {open && <BookDetail id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
