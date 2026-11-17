let symbol = '₹';
export const setCurrency = (s) => { symbol = s || '₹'; };

// Amounts travel in paise but are always whole rupees: no paise are ever shown or entered.
export const roundRupee = (cents) => Math.round((cents ?? 0) / 100) * 100;

export const fmt = (cents) => {
  const rupees = Math.round((cents ?? 0) / 100);
  return `${rupees < 0 ? '−' : ''}${symbol}${Math.abs(rupees).toLocaleString('en-IN')}`;
};

// "199" -> 19900; "199.50" is rounded to the nearest rupee (20000); null when blank or not a valid amount
export function parseMoney(s) {
  const t = String(s ?? '').trim().replace(/,/g, '');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t)) * 100 : null;
}
// Value for an amount input field (whole rupees).
export const money = (cents) => String(Math.round((cents ?? 0) / 100));

// Same arithmetic as the server (backend/src/lib/money.js computeTotals): discount and tax to the nearest rupee.
export function billTotals(subtotalCents, discountPercent, taxPercent) {
  const sub = roundRupee(subtotalCents);
  const disc = roundRupee((sub * Math.round((Number(discountPercent) || 0) * 100)) / 10000);
  const tax = roundRupee(((sub - disc) * Math.round((Number(taxPercent) || 0) * 100)) / 10000);
  return { sub, disc, tax, total: sub - disc + tax };
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const localISO = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
export const today = () => localISO(new Date());
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

export const label = (s) => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const bookName = (b) => b.title + (b.edition ? ` (${b.edition})` : '');

export const STATUS_KIND = {
  completed: 'ok', paid: 'ok', received: 'ok', ready: 'info', partial: 'warn', placed: 'info', ordered: 'info',
  partially_received: 'warn', out_for_delivery: 'warn', cancelled: 'bad', voided: 'bad', refund_due: 'bad', unpaid: '', refunded: '',
};
