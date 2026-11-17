import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';

// Plain-language user manual. Roles: Owner (whole business), Manager (assigned shops), Staff (counter work in their shop).
const HELP_SECTIONS = [
  {
    id: 'billing', title: 'Billing', group: 'Sales', path: '/billing', role: 'Everyone',
    summary: 'Sell books at the counter and print the bill.',
    steps: [
      'Search by title, author or ISBN (a barcode scanner types the ISBN) and pick the book.',
      'Change the quantity if needed. You cannot sell more copies than the shop has available.',
      'Optionally enter the customer name and phone, a discount and the payment method.',
      'Click "Finalize bill". The bill gets the next number for this shop (e.g. INV-S01-000042) and the receipt opens.',
      'To serve someone else first, click "Hold" to park the cart; resume it later from "Parked drafts".',
    ],
    rules: [
      'Discount limits: staff up to 10%, managers up to 25% (the owner can change both in Settings).',
      'Stock is taken off at the moment the bill is saved; two counters can never sell the same last copy.',
      'Clicking "Finalize" twice does not create two bills.',
    ],
  },
  {
    id: 'bills', title: 'Bills, returns and exchanges', group: 'Sales', path: '/bills', role: 'Everyone (void: owner)',
    summary: 'Find past bills, reprint them, refund or exchange books.',
    steps: [
      'Search by bill number or customer, or filter by date and status. Click a bill to open it.',
      'Click "Return / exchange", select the returned quantities and optionally add replacement books.',
      'Review the difference, choose the settlement method and confirm. Print the linked adjustment bill if needed.',
      'The owner can void an unadjusted counter bill entered by mistake.',
    ],
    rules: [
      'Returns and exchanges are accepted within the return window set in Settings (7 days by default).',
      'Each adjustment has its own bill, linked to the original sale. Replacements inherit the original discount and tax rates.',
      'Bills from phone orders cannot be voided; cancel the order instead.',
    ],
  },
  {
    id: 'orders', title: 'Phone orders', group: 'Sales', path: '/orders', role: 'Everyone',
    summary: 'Take orders by phone, hold the books, and bill them on pickup or delivery.',
    steps: [
      'Click "New order", enter the customer and add the books. Those copies are set aside at once.',
      'Record any advance payment.',
      'Mark the order Ready, then Out for delivery if it is delivered.',
      'Click "Complete & bill" when the customer pays the balance; a normal bill is created.',
    ],
    rules: [
      'Set-aside copies cannot be sold at the counter.',
      'Cancelling an order puts the copies back on sale; advance payments are refunded from the order.',
    ],
  },
  {
    id: 'catalogue', title: 'Catalogue', group: 'Stock', path: '/catalogue', role: 'Everyone (edit: manager, owner)',
    summary: 'The list of titles your business sells, with price, stock in this shop and shelf location.',
    steps: [
      'Search by title, author, ISBN or publisher; click a title to see its stock history.',
      'Managers add a title with "Add book": type an ISBN or title to find it in the ISBN catalogue, pick it, then set the price and opening stock.',
      'Use "Correct stock" after a physical count; a reason is required.',
    ],
    rules: [
      'Titles and prices are shared by all shops; stock and shelf location are per shop.',
      'An ISBN can be added only once per business.',
    ],
  },
  {
    id: 'inventory', title: 'Inventory', group: 'Stock', path: '/inventory', role: 'Everyone',
    summary: 'Stock on hand, copies set aside for phone orders, and copies available, for this shop.',
    steps: ['Filter to "Low stock" to see what needs reordering.'],
    rules: ['Stock never goes below zero; every change is recorded with its reason.'],
  },
  {
    id: 'shelves', title: 'Floor & shelves', group: 'Stock', path: '/shelves', role: 'Everyone (edit: manager, owner)',
    summary: 'Where each book sits: aisle, rack and shelf.',
    steps: ['Managers create shelves using the layout form and can edit each shelf.', 'Open Books to Arrange, select copies, choose a shelf and confirm after placement.'],
    rules: ['Shelf capacities count copies. Only confirmed placements appear in catalogue locations.'],
  },
  {
    id: 'restock', title: 'Restocking', group: 'Stock', path: '/restock', role: 'Manager, owner',
    summary: 'Suggested reorders for this shop, with the figures behind each suggestion.',
    steps: [
      'Each suggestion shows copies sold per day, stock available, copies already on order and supplier lead time.',
      'Tick the titles to order and click "Create purchase order".',
    ],
    rules: [
      'Sales per day are counted over the days the shop actually traded.',
      'Suggestions based on less than 14 days of sales are marked "low confidence".',
    ],
  },
  {
    id: 'suppliers', title: 'Suppliers', group: 'Stock', path: '/suppliers', role: 'Manager, owner',
    summary: 'Suppliers, their lead times and the price they quote per title.',
    steps: ['Add a supplier with contact details and lead time, then add their quoted prices for titles.'],
    rules: ['The quoted price is updated when goods are received at a different cost.'],
  },
  {
    id: 'purchases', title: 'Purchases', group: 'Stock', path: '/purchases', role: 'Manager, owner',
    summary: 'Purchase orders to suppliers and receiving the delivery into this shop.',
    steps: [
      'Create an order for a supplier with titles, quantities and cost.',
      'When the delivery arrives, open the order and click "Receive" with the quantities that actually came.',
    ],
    rules: [
      'Part deliveries are allowed; the order stays open until everything is received or it is cancelled.',
      'You cannot receive more than was ordered. The book\'s cost becomes the average of old and new stock.',
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard', group: 'Reports', path: '/dashboard', role: 'Manager, owner',
    summary: 'Sales, profit, stock alerts and open orders for one shop or all shops.',
    steps: ['Choose a shop (or all shops), a date range and day / week / month grouping.'],
    rules: [
      'Net sales = bills after discount, before tax, minus refunds. Voided bills are never counted.',
      'Gross profit = net sales minus the cost of the books sold.',
    ],
  },
  {
    id: 'statement', title: 'Financial statement', group: 'Reports', path: '/statement', role: 'Manager, owner',
    summary: 'A printable statement for any date range, one column per shop plus a total.',
    steps: ['Pick the period and shop(s), then "Print" (choose "Save as PDF" in the print dialog for a file).'],
    rules: ['Uses exactly the same figures as the dashboard.'],
  },
  {
    id: 'expenses', title: 'Expenses', group: 'Reports', path: '/expenses', role: 'Manager, owner',
    summary: 'Rent, wages, electricity and other running costs of the shop.',
    steps: ['Add the date, category, amount and a note.'],
    rules: ['Book purchases are not expenses; their cost counts when the books are sold.'],
  },
  {
    id: 'settings', title: 'Settings', group: 'Admin', path: '/settings', role: 'Everyone (business settings: owner)',
    summary: 'Your password; for the owner also shops, people and business rules.',
    steps: [
      'Owner: add shops (name, address, phone are printed on that shop\'s bills).',
      'Owner: add people, choose their role and which shops they work in.',
      'Owner: tax rate, discount limits, return window and low-stock level.',
    ],
    rules: ['Permissions are checked by the server, not only hidden on screen.'],
  },
];

export default function Help({ publicView = false }) {
  const location = useLocation();
  const [filter, setFilter] = useState('');
  const [highlightedId, setHighlightedId] = useState(null);

  useEffect(() => {
    const target = new URLSearchParams(location.search).get('section') || location.hash.replace('#', '');
    if (!target) return;
    setHighlightedId(target);
    setTimeout(() => document.getElementById(`help-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [location]);

  const q = filter.toLowerCase();
  const sections = HELP_SECTIONS.filter((s) => !q || [s.title, s.group, s.summary, ...s.steps, ...s.rules].some((t) => t.toLowerCase().includes(q)));

  return (
    <div className="max-w-[1100px] mx-auto py-2 px-1">
      <div className="card mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-ink">
          <h1 className="!mb-0 !border-0 text-2xl font-serif">Help</h1>
          {publicView && <Link to="/login" className="btn btn-primary">Sign in</Link>}
        </div>
        <input type="search" className="input max-w-[380px]" placeholder="Search help (e.g. refund, discount)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {HELP_SECTIONS.map((s) => (
          <a key={s.id} href={`#/help?section=${s.id}`} className={`btn btn-sm text-[.78rem] no-underline ${highlightedId === s.id ? 'bg-ink text-paper font-bold' : ''}`}>{s.title}</a>
        ))}
      </div>

      <div className="space-y-4">
        {sections.length === 0 ? <div className="empty">Nothing matches "{filter}".</div> : sections.map((s) => (
          <article key={s.id} id={`help-${s.id}`} className={`card p-4 ${highlightedId === s.id ? 'help-highlighted' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 pb-2.5 mb-3 border-b border-hair">
              <div>
                <div className="text-muted text-[.8rem] mb-1">{s.group} · {s.role}</div>
                <h2 className="!mb-0 text-xl font-serif text-ink">{s.title}</h2>
              </div>
              {!publicView && <Link to={s.path} className="btn btn-sm">Open {s.title}</Link>}
            </div>
            <p className="text-[.94rem] mb-3">{s.summary}</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="!mt-0 !mb-2 !text-[.85rem] uppercase tracking-wider text-muted font-bold">How to</h3>
                <ol className="list-decimal list-inside space-y-1.5 text-[.9rem]">{s.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </div>
              <div>
                <h3 className="!mt-0 !mb-2 !text-[.85rem] uppercase tracking-wider text-muted font-bold">Good to know</h3>
                <ul className="list-disc list-inside space-y-1.5 text-[.9rem]">{s.rules.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
