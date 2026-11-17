import { useState } from 'react';
import { get,post,put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCached } from '../lib/hooks';
import { broadcastEvent } from '../lib/events';
import { toast } from '../lib/overlays';
import { Async, Button, Empty, Field, Modal, PageTitle } from '../lib/ui';

function ShelfEditor({ shelf, close, saved }) {
  const [f,setF]=useState({...shelf});
  const set=k=>e=>setF(x=>({...x,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  return <Modal title="Edit shelf" onClose={close}><div className="grid sm:grid-cols-2 gap-3">
    {['aisle','rack','shelf','capacity','categoryHint'].map(k=><Field key={k} label={k==='categoryHint'?'Category hint':k}><input className="input" type={k==='capacity'?'number':'text'} value={f[k] ?? ''} onChange={set(k)} /></Field>)}
    <label><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
  </div><div className="flex justify-end gap-2 mt-4"><Button onClick={close}>Cancel</Button><Button variant="primary" onClick={async()=>{await put(`/shelves/${shelf.id}`,{...f,capacity:Number(f.capacity)});toast('Shelf saved');saved();close();}}>Save shelf</Button></div></Modal>;
}
export default function ShopLayout() {
  const {isManager}=useAuth();
  const state=useCached(['layout'],()=>get('/shelves'));
  const [form,setForm]=useState({aisles:1,racks:1,shelves:4,capacity:50});
  const [editing,setEditing]=useState(null),[selected,setSelected]=useState(null);
  const contents=useCached(['layout','contents',selected],()=>get(`/shelves/${selected}/books`),{enabled:!!selected});
  const refresh=()=>{state.reload();broadcastEvent('layout');};
  return <div><PageTitle>Floor &amp; shelves</PageTitle>
    {isManager && <section className="card mb-4"><h2>Set up shop shelves</h2><p className="text-muted text-sm">Generate shelf spaces for this shop. Existing shelf names are kept.</p><div className="flex flex-wrap gap-3 items-end">{Object.keys(form).map(k=><Field key={k} label={k==='shelves'?'Shelves per rack':k==='racks'?'Racks per aisle':k==='capacity'?'Copies per shelf':'Aisles'}><input className="input !w-24" type="number" min="1" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:Number(e.target.value)}))} /></Field>)}<Button variant="primary" onClick={async()=>{const r=await post('/shelves/layout',form);toast(`${r.created} shelves created`);refresh();}}>Create layout</Button></div></section>}
    <Async state={state}>{shelves=><section className="card"><h2>Shop floor</h2>{!shelves.length?<Empty>No shelves yet. Ask a manager to set up this shop.</Empty>:<div className="table-wrap"><table className="ledger"><thead><tr><th>Aisle</th><th>Rack</th><th>Shelf</th><th>Category</th><th>Copies</th><th>Free</th><th>Status</th><th /></tr></thead><tbody>{shelves.map(s=><tr key={s.id}><td>{s.aisle}</td><td>{s.rack}</td><td><button className="underline" onClick={()=>setSelected(s.id)}>{s.shelf}</button></td><td>{s.categoryHint||'—'}</td><td>{s.occupied} / {s.capacity}</td><td>{s.capacity-s.occupied}</td><td>{s.active?'Active':'Inactive'}</td><td>{isManager && <button className="btn btn-sm" onClick={()=>setEditing(s)}>Edit</button>}</td></tr>)}</tbody></table></div>}</section>}</Async>
    {selected && <Modal title="Books on shelf" onClose={()=>setSelected(null)}><Async state={contents}>{rows=>rows.length?<ul>{rows.map(b=><li key={b.id} className="py-1">{b.title} · {b.qty} copies</li>)}</ul>:<Empty>This shelf is empty.</Empty>}</Async></Modal>}
    {editing && <ShelfEditor shelf={editing} close={()=>setEditing(null)} saved={refresh} />}
  </div>;
}
