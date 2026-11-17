import React from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/format';
import { Printer } from 'lucide-react';

// Whole rupees only (amounts are rounded to the nearest rupee; no paise column).
function splitCents(cents) {
  const rs = Math.round(Math.max(0, cents || 0) / 100).toLocaleString('en-IN');
  return { rs };
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export default function PhysicalCashMemo({ bill, adjustment = null, onPrint, showActions = true }) {
  const { settings } = useAuth();

  if (adjustment) bill = adjustment;
  if (!bill) return null;
  const isAdjustment = !!adjustment;

  // Header comes from the shop the bill was made in (sent with the bill); settings only as a fallback.
  const shopName = (bill.shopName || settings?.shopName || '').toUpperCase();
  const shopAddress = bill.shopAddress ?? settings?.shopAddress ?? '';
  const shopPhone = bill.shopPhone ?? settings?.shopPhone ?? '';
  const paymentMethod = (bill.paymentMethod || (isAdjustment ? '' : 'cash')).toLowerCase();
  const billType = isAdjustment ? `${bill.type.toUpperCase()} - ADJUSTMENT BILL` : `${paymentMethod.toUpperCase()} - BILL`;
  const dateFormatted = formatDate(bill.createdAt);
  const customerName = bill.customerName || '';
  const billNumber = isAdjustment ? bill.adjustmentNo : bill.billNo;
  const returnDays = bill.returnWindowDays ?? settings?.returnWindowDays;

  const items = bill.items || [];
  const adjustmentTax = isAdjustment ? items.reduce((sum, item) => sum + item.sign * item.taxCents, 0) : 0;
  const total = splitCents(isAdjustment ? Math.abs(bill.netCents) : bill.totalCents);
  const subtotal = splitCents(bill.subtotalCents);
  const discount = !isAdjustment && bill.discountCents > 0 ? splitCents(bill.discountCents) : null;
  const tax = isAdjustment ? (adjustmentTax ? splitCents(Math.abs(adjustmentTax)) : null) : (bill.taxCents > 0 ? splitCents(bill.taxCents) : null);

  // Rubber stamp styling configuration
  let stampLabel = 'CASH PAID';
  let stampSub = 'OFFICIAL RECEIPT';
  let stampColorClass = 'border-[#2b3a8c] text-[#2b3a8c] bg-[#2b3a8c]/5 shadow-[0_0_0_2px_#2b3a8c]';

  if (isAdjustment) {
    stampLabel = bill.netCents < 0 ? 'REFUNDED' : bill.netCents > 0 ? 'COLLECTED' : 'EVEN';
    stampSub = paymentMethod ? paymentMethod.toUpperCase() : 'NO PAYMENT';
  } else if (bill.status === 'voided') {
    stampLabel = 'VOID';
    stampSub = 'CANCELLED';
    stampColorClass = 'border-[#BE123C] text-[#BE123C] bg-[#BE123C]/5 shadow-[0_0_0_2px_#BE123C]';
  } else if (paymentMethod === 'upi') {
    stampLabel = 'UPI PAID';
    stampSub = 'DIGITAL PAYMENT';
    stampColorClass = 'border-[#0c7356] text-[#0c7356] bg-[#0c7356]/5 shadow-[0_0_0_2px_#0c7356]';
  } else if (paymentMethod === 'card') {
    stampLabel = 'CARD PAID';
    stampSub = 'POS TRANSACTION';
    stampColorClass = 'border-[#1d4ed8] text-[#1d4ed8] bg-[#1d4ed8]/5 shadow-[0_0_0_2px_#1d4ed8]';
  } else if (paymentMethod === 'other') {
    stampLabel = 'PAID';
    stampSub = 'VERIFIED';
    stampColorClass = 'border-[#6b21a8] text-[#6b21a8] bg-[#6b21a8]/5 shadow-[0_0_0_2px_#6b21a8]';
  }

  // Ensure minimum rows to preserve authentic printed pad proportion
  const padRowsCount = Math.max(0, 4 - items.length);

  const handlePrint = () => {
    if (onPrint) onPrint();
    else window.print();
  };

  return (
    <div className="flex flex-col items-center w-full">
      {/* Top Action Bar (hidden when printing) */}
      {showActions && (
        <div className="print:hidden w-full max-w-[760px] mb-3 flex flex-wrap items-center justify-between gap-2 p-2 bg-amber-50/80 border border-ochre rounded">
          <div className="flex items-center gap-2">
            {bill.status === 'voided' ? <span className="badge badge-bad font-bold text-xs">Voided</span> : <span className="badge badge-ok font-bold text-xs">Saved</span>}
            <span className="text-xs font-mono font-bold text-ink">Bill No: {billNumber}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary flex items-center gap-1.5"
              onClick={handlePrint}
              title="Print, or choose Save as PDF in the print dialog"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save PDF</span>
            </button>
          </div>
        </div>
      )}

      {/* The Physical Cash Memo Paper */}
      <div
        className="cash-memo-container relative bg-white text-ink border-2 border-red-700 w-full max-w-[760px] p-5 shadow-hard print:border-red-700 print:shadow-none print:w-full print:max-w-none print:m-0 print:p-4 selection:bg-red-100"
        style={{ fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif' }}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between font-bold text-[13px] text-red-700 tracking-wider mb-2 border-b border-red-200 pb-1">
          <span className="uppercase">{billType}</span>
          {shopPhone && <span className="font-mono text-xs">Ph: {shopPhone}</span>}
        </div>

        {/* Store Title & Emblem */}
        <div className="text-center my-2">
          <div className="flex items-center justify-center gap-3">
            <svg className="w-8 h-8 text-red-700 fill-current" viewBox="0 0 24 24">
              <path d="M12 3.75c-3.75-2.25-8.25-2-10 0v14.5c1.75-2 6.25-2.25 10 0 3.75-2.25 8.25-2 10 0V3.75c-1.75-2-6.25-2.25-10 0zm0 13c-3-1.8-6.8-1.5-8.5-.2V5.5c1.7-1.3 5.5-1.6 8.5.2v11.05zm8.5-.2c-1.7-1.3-5.5-1.6-8.5.2V5.7c3-1.8 6.8-1.5 8.5-.2v10.75z"/>
            </svg>
            <h1 className="!border-0 !mb-0 text-3xl font-black tracking-[2px] text-red-700 font-serif uppercase leading-none">
              {shopName}
            </h1>
          </div>
          {shopAddress && <div className="text-xs font-semibold text-gray-700 mt-1.5">{shopAddress}</div>}
        </div>

        {/* Metadata Section with Classic Dotted Underlines */}
        <div className="my-4 text-[13.5px] leading-relaxed">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline flex-1 min-w-0">
              <span className="font-extrabold text-red-700 text-sm mr-1.5">No.</span>
              <span className="font-mono font-black text-red-700 text-base flex-1 border-b border-dotted border-gray-600 px-1">
                {billNumber}
              </span>
            </div>
            <div className="flex items-baseline w-[220px]">
              <span className="font-extrabold text-red-700 text-sm mr-1.5 whitespace-nowrap">Date :</span>
              <span className="font-mono font-bold text-gray-900 flex-1 border-b border-dotted border-gray-600 px-1 text-center">
                {dateFormatted}
              </span>
            </div>
          </div>

          <div className="flex items-baseline mt-2">
            <span className="font-bold text-gray-800 whitespace-nowrap mr-2">Customer Name :</span>
            <span className="font-bold text-gray-900 flex-1 border-b border-dotted border-gray-600 px-2 font-mono">
              {customerName}
            </span>
          </div>
          {isAdjustment && <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-mono"><span><strong>Against invoice:</strong> {bill.billNo}</span><span><strong>Staff:</strong> {bill.staff || '—'}</span></div>}
        </div>

        {/* Ledger Table with Red Borders */}
        <div className="relative border-2 border-red-700 mt-3">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b-2 border-red-700 bg-red-50/40 text-red-800 text-xs font-black uppercase">
                <th className="w-12 py-1.5 px-1 border-r border-red-700 text-center">Sl.<br/>No.</th>
                <th className="py-1.5 px-3 border-r border-red-700 text-left">PARTICULARS</th>
                <th className="w-14 py-1.5 px-1 border-r border-red-700 text-center">QTY.</th>
                <th className="w-20 py-1.5 px-2 border-r border-red-700 text-right">RATE</th>
                <th className="w-28 py-1.5 px-2 text-right">AMOUNT (Rs.)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const rate = splitCents(it.unitPriceCents || 0);
                const line = splitCents(it.lineTotalCents ?? ((it.quantity * it.unitPriceCents) || 0));
                return (
                  <tr key={it.id || it.bookId || idx} className="border-b border-red-100">
                    <td className="border-r border-red-700 text-center py-2 px-1 align-top">
                      <span className="inline-block w-5 h-5 rounded-full border border-gray-800 text-[11px] font-bold leading-[18px]">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="border-r border-red-700 py-2 px-3 align-top">
                      <div className="font-bold text-gray-900 leading-snug">{isAdjustment && <span>{it.sign < 0 ? 'RETURN: ' : 'REPLACEMENT: '}</span>}{it.title}</div>
                      <div className="text-[11px] text-gray-600 font-mono mt-0.5">
                        {it.author ? `${it.author}` : ''}
                        {it.isbn ? ` · ISBN ${it.isbn}` : ''}
                        {it.edition ? ` · (${it.edition})` : ''}
                      </div>
                    </td>
                    <td className="border-r border-red-700 text-center font-bold py-2 px-1 align-top font-mono">
                      {it.quantity}
                    </td>
                    <td className="border-r border-red-700 text-right font-mono font-bold py-2 px-2 align-top text-gray-800">
                      {rate.rs}
                    </td>
                    <td className="text-right font-mono font-black py-2 px-2 align-top text-gray-900">
                      {isAdjustment ? (it.sign < 0 ? '−' : '+') : ''}{line.rs}
                    </td>
                  </tr>
                );
              })}

              {/* Blank filler rows to give authentic bill book height */}
              {Array.from({ length: padRowsCount }).map((_, i) => (
                <tr key={`pad-${i}`} className="h-7 border-b border-red-50">
                  <td className="border-r border-red-700"></td>
                  <td className="border-r border-red-700"></td>
                  <td className="border-r border-red-700"></td>
                  <td className="border-r border-red-700"></td>
                  <td></td>
                </tr>
              ))}

              {/* Discount Row */}
              {discount && (
                <tr className="border-t border-red-700 bg-red-50/20 text-xs font-semibold">
                  <td colSpan={4} className="border-r border-red-700 py-1 px-3 text-right">
                    Discount ({bill.discountPercent}%):
                  </td>
                  <td className="text-right font-mono font-bold py-1 px-2 text-brick">
                    -{discount.rs}
                  </td>
                </tr>
              )}

              {/* Tax Row */}
              {tax && (
                <tr className="border-t border-red-700 bg-red-50/20 text-xs font-semibold">
                  <td colSpan={4} className="border-r border-red-700 py-1 px-3 text-right">
                    {isAdjustment ? 'Net tax:' : `Tax (${bill.taxPercent}%):`}
                  </td>
                  <td className="text-right font-mono font-bold py-1 px-2 text-gray-800">
                    {isAdjustment && adjustmentTax < 0 ? '−' : ''}{tax.rs}
                  </td>
                </tr>
              )}

              {/* TOTAL Row (Contains required 'TOTAL' keyword) */}
              <tr className="border-t-2 border-red-700 bg-red-50/60 font-black text-red-800">
                <td colSpan={4} className="border-r border-red-700 py-2 px-3 text-right tracking-wider text-sm font-serif">
                  {isAdjustment ? (bill.netCents < 0 ? 'TOTAL TO REFUND' : bill.netCents > 0 ? 'TOTAL TO COLLECT' : 'EVEN EXCHANGE') : 'TOTAL'}
                </td>
                <td className="text-right font-mono text-base font-black py-2 px-2 text-red-900">
                  {isAdjustment && bill.netCents < 0 ? '−' : ''}{total.rs}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Dynamic Authentic Rubber Stamp (Tilted diagonally over bottom area) */}
          <div
            className={`absolute bottom-5 left-16 sm:left-24 transform -rotate-12 border-[3.5px] border-dashed rounded-lg px-4 py-1.5 text-center pointer-events-none select-none z-10 ${stampColorClass}`}
            style={{ opacity: 0.94 }}
          >
            <div className="font-black text-2xl sm:text-3xl tracking-[2px] leading-none uppercase font-serif">
              {stampLabel}
            </div>
            <div className="text-[9px] font-extrabold tracking-widest uppercase border-t border-current mt-1 pt-0.5">
              {stampSub} · {dateFormatted}
            </div>
          </div>
        </div>

        {/* Footer with Disclaimer & Signature Block */}
        <div className="flex items-end justify-between mt-4 pt-2 text-xs">
          <div className="text-red-700 font-semibold italic text-xs">
            {isAdjustment ? <>{paymentMethod ? `Settlement: ${paymentMethod.toUpperCase()}` : 'No payment needed'}{bill.reason && <div>Reason: {bill.reason}</div>}</> : (returnDays > 0 ? `Returns and exchanges within ${returnDays} days with this bill.` : 'Goods once sold are not taken back.')}
          </div>
          <div className="text-right">
            <div className="font-extrabold text-red-700 uppercase text-xs">
              For {shopName}
            </div>
            <div className="mt-6 pt-1 border-t border-dashed border-gray-500 font-sans text-[11px] text-gray-600">
              Authorized Signatory
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

