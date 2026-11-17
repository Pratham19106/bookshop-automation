import React from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/format';
import { Printer, Download, ExternalLink } from 'lucide-react';

function splitCents(cents) {
  const c = Math.max(0, cents || 0);
  const rs = Math.floor(c / 100);
  const ps = String(c % 100).padStart(2, '0');
  return { rs, ps };
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export default function PhysicalCashMemo({ bill, onPrint, onDownloadPdf, showActions = true }) {
  const { settings } = useAuth();

  if (!bill) return null;

  const shopName = (settings?.shopName || 'PRATHAM BOOKSHOP').toUpperCase();
  const shopAddress = settings?.shopAddress || 'Main Road, 12 College Road, Mumbai - 400 001';
  const shopPhone = 'Ph : 040-6455 5452 / +91 98200 11111';
  const paymentMethod = (bill.paymentMethod || 'cash').toLowerCase();
  const billType = `${paymentMethod.toUpperCase()} - BILL`;
  const dateFormatted = formatDate(bill.createdAt);
  const customerName = bill.customerName || 'Walk-in Customer';
  const billNumber = bill.billNo || `INV-${String(bill.id || 1).padStart(6, '0')}`;

  const items = bill.items || [];
  const total = splitCents(bill.totalCents);
  const subtotal = splitCents(bill.subtotalCents);
  const discount = bill.discountCents > 0 ? splitCents(bill.discountCents) : null;
  const tax = bill.taxCents > 0 ? splitCents(bill.taxCents) : null;

  // Rubber stamp styling configuration
  let stampLabel = 'CASH PAID';
  let stampSub = 'OFFICIAL RECEIPT';
  let stampColorClass = 'border-[#2b3a8c] text-[#2b3a8c] bg-[#2b3a8c]/5 shadow-[0_0_0_2px_#2b3a8c]';

  if (paymentMethod === 'upi') {
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

  const handleDownloadPdf = async () => {
    if (onDownloadPdf) {
      onDownloadPdf();
      return;
    }
    try {
      const res = await fetch(`/api/sales/${bill.id}/pdf`, {
        headers: { 'X-Requested-With': 'bookshop' }
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CashMemo-${billNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(`/api/sales/${bill.id}/pdf`, '_blank');
    }
  };

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
            <span className="badge badge-ok font-bold text-xs">Finalized</span>
            <span className="text-xs font-mono font-bold text-ink">Bill No: {billNumber}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary flex items-center gap-1.5"
              onClick={handlePrint}
              title="Print Cash Memo (Ctrl+P)"
            >
              <Printer className="w-4 h-4" />
              <span>Print Memo</span>
            </button>
            <button
              type="button"
              className="btn btn-sm flex items-center gap-1.5 border-ink hover:bg-tint"
              onClick={handleDownloadPdf}
              title="Download Authentic PDF generated with Puppeteer"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </button>
            <a
              href={`/api/sales/${bill.id}/html`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm flex items-center gap-1"
              title="Open standalone printable bill in new window"
            >
              <span>Standalone Tab</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
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
          <span className="font-mono text-xs">{shopPhone}</span>
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
          <div className="text-xs font-semibold text-gray-700 mt-1.5">
            {shopAddress}
          </div>
          <div className="text-[11px] font-bold text-red-700 uppercase tracking-wide mt-1">
            DISTRIBUTORS : ALL TYPES OF BOOK &amp; STATIONERY · ACADEMIC &amp; LITERATURE
          </div>
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

          <div className="flex items-baseline mt-2">
            <span className="font-bold text-gray-800 whitespace-nowrap mr-2">Address :</span>
            <span className="text-gray-700 flex-1 border-b border-dotted border-gray-600 px-2 text-xs italic">
              Counter Sale / Direct Purchase
            </span>
          </div>
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
                <th colSpan={2} className="w-28 py-1 px-1 text-center">
                  Amount<br/>
                  <div className="flex justify-between px-2 text-[10px] font-normal border-t border-red-200">
                    <span>Rs.</span>
                    <span>Ps.</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const rate = splitCents(it.unitPriceCents || 0);
                const line = splitCents(it.lineTotalCents || (it.quantity * it.unitPriceCents) || 0);
                return (
                  <tr key={it.bookId || idx} className="border-b border-red-100">
                    <td className="border-r border-red-700 text-center py-2 px-1 align-top">
                      <span className="inline-block w-5 h-5 rounded-full border border-gray-800 text-[11px] font-bold leading-[18px]">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="border-r border-red-700 py-2 px-3 align-top">
                      <div className="font-bold text-gray-900 leading-snug">{it.title}</div>
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
                    <td className="border-r border-red-200 text-right font-mono font-black py-2 px-2 align-top text-gray-900 w-20">
                      {line.rs}
                    </td>
                    <td className="text-center font-mono font-black py-2 px-1 align-top text-gray-700 w-8">
                      {line.ps}
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
                  <td className="border-r border-red-200"></td>
                  <td></td>
                </tr>
              ))}

              {/* Discount Row */}
              {discount && (
                <tr className="border-t border-red-700 bg-red-50/20 text-xs font-semibold">
                  <td colSpan={4} className="border-r border-red-700 py-1 px-3 text-right">
                    Discount ({bill.discountPercent}%):
                  </td>
                  <td className="border-r border-red-200 text-right font-mono font-bold py-1 px-2 text-brick">
                    -{discount.rs}
                  </td>
                  <td className="text-center font-mono font-bold py-1 px-1 text-brick">
                    {discount.ps}
                  </td>
                </tr>
              )}

              {/* Tax Row */}
              {tax && (
                <tr className="border-t border-red-700 bg-red-50/20 text-xs font-semibold">
                  <td colSpan={4} className="border-r border-red-700 py-1 px-3 text-right">
                    Tax ({bill.taxPercent}%):
                  </td>
                  <td className="border-r border-red-200 text-right font-mono font-bold py-1 px-2 text-gray-800">
                    {tax.rs}
                  </td>
                  <td className="text-center font-mono font-bold py-1 px-1 text-gray-700">
                    {tax.ps}
                  </td>
                </tr>
              )}

              {/* TOTAL Row (Contains required 'TOTAL' keyword) */}
              <tr className="border-t-2 border-red-700 bg-red-50/60 font-black text-red-800">
                <td colSpan={4} className="border-r border-red-700 py-2 px-3 text-right tracking-wider text-sm font-serif">
                  TOTAL
                </td>
                <td className="border-r border-red-200 text-right font-mono text-base font-black py-2 px-2 text-red-900">
                  {total.rs}
                </td>
                <td className="text-center font-mono text-base font-black py-2 px-1 text-red-900">
                  {total.ps}
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
            goods once sold will not taken back.
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

