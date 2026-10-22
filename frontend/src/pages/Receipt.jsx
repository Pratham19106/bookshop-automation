import { Link, useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt, fmtDateTime, label } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { Async } from '../lib/ui';

// Print-friendly 80mm receipt. The app chrome is hidden when printing.
export default function Receipt() {
  const { id } = useParams();
  const { settings } = useAuth();
  const st = useLoad(() => get(`/sales/${Number(id)}`), [id]);
  return (
    <Async state={st}>
      {(b) => (
        <div>
          <div className="print:hidden mb-3 flex gap-2">
            <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
            <Link className="btn" to="/bills">Back to bills</Link>
          </div>
          <div className="font-mono text-xs leading-snug bg-sheet border border-ink w-[80mm] max-w-full mx-auto px-4 py-5 print:border-0 print:w-full print:p-0">
            <div className="text-center font-bold text-base font-serif">{settings.shopName}</div>
            {settings.shopAddress && <div className="text-center">{settings.shopAddress}</div>}
            <hr className="border-t border-dashed border-ink my-1.5" />
            <div>Bill: {b.billNo}</div><div>Date: {fmtDateTime(b.createdAt)}</div><div>Cashier: {b.cashier}</div>
            {b.customerName && <div>Customer: {b.customerName}</div>}
            {b.status === 'voided' && <div className="text-center font-bold border-2 border-ink my-1">*** VOIDED ***</div>}
            <hr className="border-t border-dashed border-ink my-1.5" />
            {b.items.map((i) => (
              <div key={i.bookId} className="mb-0.5">
                <div>{i.title}{i.edition ? ` (${i.edition})` : ''}</div>
                <div className="flex justify-between pl-3"><span>{i.quantity} x {fmt(i.unitPriceCents)}</span><span>{fmt(i.lineTotalCents)}</span></div>
              </div>
            ))}
            <hr className="border-t border-dashed border-ink my-1.5" />
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(b.subtotalCents)}</span></div>
            {b.discountCents > 0 && <div className="flex justify-between"><span>Discount ({b.discountPercent}%)</span><span>-{fmt(b.discountCents)}</span></div>}
            {b.taxCents > 0 && <div className="flex justify-between"><span>Tax ({b.taxPercent}%)</span><span>{fmt(b.taxCents)}</span></div>}
            <div className="flex justify-between font-bold text-sm border-t border-ink mt-1 pt-0.5"><span>TOTAL</span><span>{fmt(b.totalCents)}</span></div>
            <div className="flex justify-between"><span>Paid by</span><span>{label(b.paymentMethod)}</span></div>
            <hr className="border-t border-dashed border-ink my-1.5" />
            <div className="text-center">Thank you for shopping with us!</div>
          </div>
        </div>
      )}
    </Async>
  );
}
