let symbol = '₹';
export const setCurrency = (s) => { symbol = s || '₹'; };

export const fmt = (cents) =>
  `${symbol}${((cents ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "199.50" -> 19950; null when blank or not a valid amount
export function parseMoney(s) {
  const t = String(s ?? '').trim();
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}
export const money = (cents) => (cents / 100).toFixed(2);

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
