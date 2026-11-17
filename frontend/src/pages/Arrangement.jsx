import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { get,post } from '../lib/api';
import { useCached } from '../lib/hooks';
import { broadcastEvent } from '../lib/events';
import { toast } from '../lib/overlays';
import { Async, Button, Empty, PageTitle } from '../lib/ui';
import { useAuth } from '../lib/auth';

export default function Arrangement() {
  const tasks=useCached(['arrangement'],()=>get('/arrangement'));
  const shelves=useCached(['layout'],()=>get('/shelves'));
  const { isManager }=useAuth();
  const [checked,setChecked]=useState({}),[edits,setEdits]=useState({});
  const receipt=Number(new URLSearchParams(useLocation().search).get('receipt')) || null;
  const rows=(tasks.data||[]).filter(t=>!receipt || (t.source==='receipt' && t.sourceRef===receipt));
  const value=(t,k)=>edits[t.id]?.[k] ?? (k==='shelfId' ? t.proposedShelfId || '' : t.qty);
  const change=(t,k,x)=>setEdits(old=>({...old,[t.id]:{...old[t.id],[k]:x}}));
  const selectAll=e=>setChecked(Object.fromEntries(rows.map(t=>[t.id,e.target.checked])));
  const suggestMigration=async()=>{
    const result=await post('/arrangement/suggest-migration',{});
    toast(`${result.assigned} copies assigned a shelf${result.remaining ? `; ${result.remaining} still need space` : ''}`);
    tasks.reload();broadcastEvent('arrangement');
  };
  const confirm=async()=>{
    const selected=rows.filter(t=>checked[t.id]).map(t=>({id:t.id,shelfId:Number(value(t,'shelfId')),quantity:Number(value(t,'quantity'))}));
    if(!selected.length) throw new Error('Select at least one task');
    if(selected.some(x=>!x.shelfId)) throw new Error('Choose a shelf for every selected task');
    const result=await post('/arrangement/confirm',{items:selected});
    toast(`${result.confirmed} arranged${result.skipped?`, ${result.skipped} already completed`:''}`);
    setChecked({});setEdits({});tasks.reload();shelves.reload();broadcastEvent('arrangement');
  };
  return <div><PageTitle>Books to arrange</PageTitle><p className="text-muted mb-3">Confirm placement after the books are physically on the shelf. Choose a shelf for unassigned copies.</p>{isManager && <div className="mb-3"><Button onClick={suggestMigration}>Suggest shelves for migrated books</Button></div>}{receipt && <p className="mb-3">Showing received books for this delivery. <Link to="/arrangement">Show all tasks</Link></p>}
    <Async state={tasks}>{()=>rows.length?<><div className="table-wrap"><table className="ledger"><thead><tr><th><input type="checkbox" aria-label="Select all tasks" checked={rows.length>0 && rows.every(t=>checked[t.id])} onChange={selectAll} /></th><th>Book</th><th>Source</th><th>Copies</th><th>Place on shelf</th></tr></thead><tbody>{rows.map(t=><tr key={t.id}><td><input type="checkbox" aria-label={`Select ${t.title}`} checked={!!checked[t.id]} onChange={e=>setChecked(x=>({...x,[t.id]:e.target.checked}))} /></td><td>{t.title}<div className="text-muted text-xs">{t.author}</div></td><td>{t.source}</td><td><input className="input !w-20" type="number" min="1" max={t.qty} value={value(t,'quantity')} onChange={e=>change(t,'quantity',e.target.value)} /> of {t.qty}</td><td><select className="input" value={value(t,'shelfId')} onChange={e=>change(t,'shelfId',e.target.value)}><option value="">No space: choose a shelf</option>{(shelves.data||[]).filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.aisle} · {s.rack} · {s.shelf} ({s.capacity-s.occupied} free)</option>)}</select></td></tr>)}</tbody></table></div><Button variant="primary" onClick={confirm}>Confirm arrangement</Button></>:<Empty>There are no books waiting to be arranged.</Empty>}</Async>
  </div>;
}
