import { useMemo, useRef, useState } from 'react';
import { post } from '../lib/api';
import { fmt } from '../lib/format';
import { toast } from '../lib/overlays';
import { broadcastEvent } from '../lib/events';
import { Actions, BookPicker, Button, Field, Modal } from '../lib/ui';

function allocate(total, weights) {
  const sum = weights.reduce((a,b)=>a+b,0);
  if (!sum) return weights.map(()=>0);
  const rows = weights.map((weight,index) => { const n=BigInt(total)*BigInt(weight), d=BigInt(sum); return { index, value:Number(n/d), remainder:n%d }; });
  const remaining = total-rows.reduce((n,r)=>n+r.value,0);
  const ordered=[...rows].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
  for(let i=0;i<remaining;i++) ordered[i].value++;
  return rows.map(r=>r.value);
}
function allocations(items, discount, tax) {
  const gross=items.map(i=>i.unitPriceCents*i.quantity), discounts=allocate(discount,gross);
  const net=gross.map((v,i)=>v-discounts[i]), taxes=allocate(tax,net);
  return items.map((i,n)=>({net:allocate(net[n],Array(i.quantity).fill(1)),tax:allocate(taxes[n],Array(i.quantity).fill(1))}));
}
const total = (items) => items.reduce((a,b)=>a+b,0);

export default function AdjustmentDialog({ sale, onClose, onSuccess }) {
  const [quantities,setQuantities]=useState({});
  const [replacements,setReplacements]=useState([]);
  const [method,setMethod]=useState('cash');
  const [reason,setReason]=useState('');
  const key=useRef(crypto.randomUUID());
  const sources=useMemo(()=>{
    const original=allocations(sale.items,sale.discountCents,sale.taxCents);
    const items=sale.items.map((item,index)=>({ ...item, key:`s${item.id}`, saleItemId:item.id, allocation:original[index] }));
    for(const adjustment of sale.adjustments || []) for(const item of adjustment.items) if(item.sign===1 && !adjustment.isLegacy) {
      items.push({...item,key:`a${item.id}`,adjustmentItemId:item.id,allocation:{net:allocate(item.lineTotalCents,Array(item.quantity).fill(1)),tax:allocate(item.taxCents,Array(item.quantity).fill(1))}});
    }
    return items.filter(i=>i.quantity>i.returnedQty);
  },[sale]);
  const returned=sources.reduce((value,item)=>{
    const qty=Number(quantities[item.key]||0), start=item.returnedQty||0;
    return value+total(item.allocation.net.slice(start,start+qty))+total(item.allocation.tax.slice(start,start+qty));
  },0);
  const subtotal=replacements.reduce((n,i)=>n+i.priceCents*i.quantity,0);
  const discount=Math.round(subtotal*sale.discountPercent/100), replacementNet=subtotal-discount;
  const net=replacementNet+Math.round(replacementNet*sale.taxPercent/100)-returned;
  const selected=sources.filter(i=>Number(quantities[i.key])>0);
  const submit=async()=>{
    const body={ returns:selected.map(i=>({...(i.saleItemId?{saleItemId:i.saleItemId}:{adjustmentItemId:i.adjustmentItemId}),quantity:Number(quantities[i.key])})),
      replacements:replacements.map(i=>({bookId:i.id,quantity:i.quantity})), paymentMethod:net ? method : null, reason, idempotencyKey:key.current };
    const result=await post(`/sales/${sale.id}/adjustments`,body);
    broadcastEvent('return', { saleId:sale.id, adjustmentId:result.adjustment.id });
    toast(`${result.adjustment.adjustmentNo} saved`); onSuccess(result.adjustment); onClose();
  };
  return <Modal title={`Return or exchange · ${sale.billNo}`} wide onClose={onClose}>
    <p>Select the books being returned and optionally add replacements. The original discount and tax rates apply.</p>
    <div className="table-wrap"><table className="ledger"><thead><tr><th>Return item</th><th>Available</th><th>Quantity</th></tr></thead><tbody>{sources.map(i=><tr key={i.key}>
      <td>{i.title} {i.adjustmentItemId && <span className="text-muted">(replacement)</span>}</td><td>{i.quantity-i.returnedQty}</td>
      <td><input aria-label={`Return quantity ${i.title}`} className="input !w-20" type="number" min="0" max={i.quantity-i.returnedQty} value={quantities[i.key]||0} onChange={e=>setQuantities(q=>({...q,[i.key]:Math.max(0,Math.min(i.quantity-i.returnedQty,Number(e.target.value)||0))}))} /></td>
    </tr>)}</tbody></table></div>
    <h3>Replacement books</h3><BookPicker onPick={book=>setReplacements(items=>items.some(i=>i.id===book.id)?items:[...items,{...book,quantity:1}])} />
    {replacements.map(i=><div key={i.id} className="flex gap-2 items-center my-2"><span className="flex-1">{i.title} · {fmt(i.priceCents)} · {i.availableQty} available</span><input aria-label={`Replacement quantity ${i.title}`} className="input !w-20" type="number" min="1" max={i.availableQty} value={i.quantity} onChange={e=>setReplacements(items=>items.map(x=>x.id===i.id?{...x,quantity:Math.max(1,Math.min(i.availableQty,Number(e.target.value)||1))}:x))} /><button className="btn btn-sm" onClick={()=>setReplacements(items=>items.filter(x=>x.id!==i.id))}>Remove</button></div>)}
    <div className="notice my-3"><strong>Returned: −{fmt(returned)} · Replacements: {fmt(replacementNet+Math.round(replacementNet*sale.taxPercent/100))}</strong><br />{net>0?`Collect ${fmt(net)}`:net<0?`Return ${fmt(-net)}`:'Even exchange'}</div>
    {net!==0 && <Field label="Settlement method" htmlFor="adjustment-method"><select id="adjustment-method" className="input" value={method} onChange={e=>setMethod(e.target.value)}>{['cash','card','upi','other'].map(m=><option key={m} value={m}>{m.toUpperCase()}</option>)}</select></Field>}
    <Field label="Reason" htmlFor="adjustment-reason"><input id="adjustment-reason" className="input" value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} /></Field>
    <Actions><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!selected.length || replacements.some(i=>i.quantity>i.availableQty)} onClick={submit}>Confirm adjustment</Button></Actions>
  </Modal>;
}
