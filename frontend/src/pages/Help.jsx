import { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const HELP_SECTIONS = [
  {
    id: 'billing',
    title: 'Point-of-Sale Billing',
    group: 'Sales',
    path: '/billing',
    role: 'Owner & Staff',
    summary: 'Ringing up counter sales, scanning ISBNs, applying discounts, finalizing transactions, and printing receipts.',
    steps: [
      'Search for books using the barcode/ISBN scanner or typing title/author in the book search field.',
      'Click or press Enter on the search result to add the item to the active bill register.',
      'Adjust quantities using the + / - buttons or the numeric quantity input. The system strictly blocks overselling beyond available on-hand stock.',
      'Optionally specify a customer name and phone number for purchase records.',
      'Apply a bill discount percentage if needed. Staff accounts are restricted to the shop discount limit configured in Settings.',
      'Hold / Save Draft: If a customer needs to fetch more books or look for cash, click "Hold / Save Draft" to park their cart into the draft queue and immediately free the register for another customer.',
      'Resume Parked Draft: Click "Parked Drafts" at the top of the bill section to view all held tickets. Click "Resume Draft" to restore any parked customer bill back into the register.',
      'Review the itemized totals, tax (calculated on discounted subtotal), and final grand total.',
      'Click "Finalize Bill (Enter)" to commit the sale. The transaction runs atomically in the database and immediately prints or opens the receipt.'
    ],
    rules: [
      'Persistent Auto-Save: The active bill is auto-saved locally in real-time. Switching windows, navigating between pages, or accidental browser reloads will never erase your active cart.',
      'Multi-Customer Queue: You can park multiple customer drafts simultaneously. Resuming a draft while another cart is active automatically parks the current cart so nothing is lost.',
      'Atomic Transaction: The bill, line items, and stock deductions are processed in a single BEGIN IMMEDIATE database transaction.',
      'Historical Cost Snapshot: Each sale records the item cost at the exact time of sale so financial reporting (COGS) remains accurate even if costs change later.',
      'Idempotency: Resubmitting the same bill submission avoids duplicate charges.'
    ]
  },
  {
    id: 'bills',
    title: 'Bills & Sales Register',
    group: 'Sales',
    path: '/bills',
    role: 'Owner & Staff (Void: Owner only)',
    summary: 'Historical ledger of finalized sales, reprint duplicate receipts, and void erroneous transactions.',
    steps: [
      'Browse chronological invoices with invoice number, date/time, items count, cashier name, and grand total.',
      'Click on any invoice row to expand its full line-item details, applied discounts, and tax breakdowns.',
      'Click "Print Receipt" to reprint the thermal or standard receipt at any time.',
      'If an error occurred on a counter sale, an Owner can click "Void Bill". Staff cannot void bills.'
    ],
    rules: [
      'Voiding Restores Stock: Voiding an invoice immediately credits the books back into inventory and marks the invoice as VOID.',
      'Reports Exclusion: Voided bills are excluded from dashboard sales figures and revenue reports.',
      'Phone Order Protection: Phone order invoices cannot be voided from the Bills screen; cancel the order prior to completion instead.'
    ]
  },
  {
    id: 'orders',
    title: 'Phone-in Orders & Reservations',
    group: 'Sales',
    path: '/orders',
    role: 'Owner & Staff',
    summary: 'Manage customer telephone reservations, advance deposits, and delivery/pickup fulfillment lifecycle.',
    steps: [
      'Click "+ New Phone Order" and enter customer name, phone number, and optional delivery address.',
      'Add items to the order. The system immediately reserves the required quantity so counter customers cannot buy them.',
      'Record any advance payment received (Cash, Card, UPI, or Bank Transfer).',
      'Progress the order status through the lifecycle: Placed → Ready for Pickup/Dispatch → Completed.',
      'When the customer collects and pays the balance, click "Complete & Bill" to deduct physical inventory and generate an official invoice.'
    ],
    rules: [
      'Stock Reservation: Reserved stock is subtracted from available counter stock upon order placement, avoiding double-selling.',
      'Payment Ledger: Advance payments are tracked independently and recognized as sales revenue only when the order is marked Completed.',
      'Order Cancellation: Cancelling an order immediately releases all reserved stock back to the shelf.'
    ]
  },
  {
    id: 'catalogue',
    title: 'Book Catalogue & Shelf Locations',
    group: 'Stock',
    path: '/catalogue',
    role: 'Owner & Staff',
    summary: 'Master inventory book records, ISBN-10/13 checksum validation, pricing, and physical store coordinates.',
    steps: [
      'Use the search bar to find books by title, author, publisher, genre, or ISBN.',
      'Click "+ Add Book" to catalog a new edition with title, author, publisher, publication year, edition, and retail price.',
      'Provide an ISBN-10 or ISBN-13. The system validates the standard mathematical checksum to prevent typos.',
      'Tag the exact physical store coordinates: Aisle, Rack, and Shelf (e.g., "Aisle 2, Rack B, Shelf 4"). Staff can instantly locate copies for customers.',
      'Set an optional low-stock alert threshold specific to this title.'
    ],
    rules: [
      'Checksum Verification: Invalid ISBN checksums or duplicate ISBNs across editions are refused.',
      'Fallback Identity: If no ISBN is available, title + author + edition + publisher must be uniquely identifiable.'
    ]
  },
  {
    id: 'inventory',
    title: 'Inventory Audit & Stock Adjustments',
    group: 'Stock',
    path: '/inventory',
    role: 'Owner & Staff (Adjustments: Owner only)',
    summary: 'Real-time on-hand stock monitoring, reserved stock tracking, and recorded physical audit corrections.',
    steps: [
      'Filter stock by location or low-stock warning status to spot books needing shelf replenishment.',
      'View On-Hand, Reserved (phone orders), and Available quantities for every title.',
      'During physical counts, an Owner can click "Adjust Stock" to correct discrepancies.',
      'Enter the actual counted quantity and select a required audit reason (e.g., "Physical inventory count", "Damaged copy", "Found stock").'
    ],
    rules: [
      'Zero Negative Stock Constraint: Database CHECK constraints prevent available stock from dropping below zero.',
      'Append-Only Movement Ledger: Every single stock increase, sale, reservation, and manual correction is recorded in the permanent stock_movements table.'
    ]
  },
  {
    id: 'restock',
    title: 'Rule-Based Restocking Recommendations',
    group: 'Stock',
    path: '/restock',
    role: 'Owner only',
    summary: 'Automated purchasing intelligence based on observed sales velocity, cover days, and supplier lead times.',
    steps: [
      'Review flagged titles categorized by urgency (Critical, High, Medium).',
      'Examine the plain-language explanation showing exactly why a book was recommended for reorder.',
      'Inspect the math: observed daily sales velocity (excluding voided sales), current available stock, open purchase orders, and supplier lead time.',
      'See the suggested order quantity calculated to cover expected sales plus safety buffer.',
      'Click "Create PO" next to the recommended cheapest quoting supplier to generate a purchase order draft.'
    ],
    rules: [
      'True Velocity: Calculated only across days the store actually traded, avoiding misleading dilution from closed days.',
      'Low Confidence Labeling: If sales history is under 14 days, recommendations are flagged with "Low Confidence" rather than hidden.'
    ]
  },
  {
    id: 'suppliers',
    title: 'Suppliers & Quoted Price Matrix',
    group: 'Stock',
    path: '/suppliers',
    role: 'Owner only',
    summary: 'Vendor records, lead time in days, payment terms, and per-book wholesale price quotes.',
    steps: [
      'Click "+ Add Supplier" to register distributor name, contact person, email, phone, and standard lead time in days.',
      'Assign quoted prices for specific book ISBNs to each supplier.',
      'Compare competing wholesale prices across multiple suppliers for the same title to secure maximum margin.',
      'Track active supplier status and contact information for rapid reordering.'
    ],
    rules: [
      'Lead Time Integration: Supplier lead time is directly fed into the restocking engine to calculate safety stock days.',
      'Cost Quotes: Quoted prices are updated automatically when receiving higher or lower costs on goods delivery.'
    ]
  },
  {
    id: 'purchases',
    title: 'Purchases & Goods Receipts',
    group: 'Stock',
    path: '/purchases',
    role: 'Owner only',
    summary: 'Purchase order management, shipment check-in, partial deliveries, and weighted-average cost updating.',
    steps: [
      'Click "+ New Purchase Order", select a supplier, and add required book titles with quantities and negotiated unit costs.',
      'Send or print the purchase order for the distributor.',
      'When deliveries arrive, open the PO and click "Receive Goods".',
      'Enter the quantity actually received in this shipment. If fewer books arrived than ordered, the PO remains partially open.',
      'Confirm the invoiced unit cost. The system automatically updates the stock count and computes the new weighted-average unit cost.'
    ],
    rules: [
      'No Over-Receipt: The system prevents receiving more units than authorized on the purchase order.',
      'Weighted-Average COGS: The unit cost of the book in inventory is recalibrated using the weighted average of existing stock and incoming delivery cost.'
    ]
  },
  {
    id: 'dashboard',
    title: 'Financial & Operational Dashboard',
    group: 'Reports',
    path: '/dashboard',
    role: 'Owner only',
    summary: 'Business performance metrics, true COGS, gross margins, operating expenses, and net profit.',
    steps: [
      'Select time range presets (Today, This Week, This Month) or pick custom start and end dates.',
      'Choose grouping granularity (Daily, Weekly, Monthly) to analyze trend patterns.',
      'Review Net Revenue (subtotal minus discounts, excluding tax collected).',
      'Examine Cost of Goods Sold (COGS) evaluated from unit costs recorded at sale time.',
      'Analyze Gross Profit (Revenue - COGS) and Gross Margin percentage.',
      'Review Operating Expenses and final Net Operating Profit.'
    ],
    rules: [
      'No Double Counting: Operating profit deducts operating expenses; goods purchase costs are accounted for via COGS upon sale.',
      'Unknown Cost Warnings: In the event a book sold without an established cost price, the dashboard flags the count so profit is never falsely overstated.'
    ]
  },
  {
    id: 'expenses',
    title: 'Operating Expense Tracking',
    group: 'Reports',
    path: '/expenses',
    role: 'Owner only',
    summary: 'Track non-inventory overheads such as shop rent, electricity, packaging materials, and maintenance.',
    steps: [
      'Click "+ Record Expense" to log a store expenditure.',
      'Enter the amount, expense date, category (e.g. Rent, Utilities, Packaging, Supplies, Marketing), and description.',
      'Filter and inspect historical operational expenditures alongside revenue reports.'
    ],
    rules: [
      'Overhead Separation: Operating expenses are kept distinct from supplier inventory purchases for correct P&L accounting.'
    ]
  },
  {
    id: 'settings',
    title: 'Store Configuration & Staff Admin',
    group: 'Admin',
    path: '/settings',
    role: 'Owner (Staff can view own details)',
    summary: 'Manage shop metadata, tax rates, staff discount caps, and create/manage cashier and manager accounts.',
    steps: [
      'Configure Shop Name and print header displayed on customer receipts.',
      'Set Currency Symbol (e.g., ₹, $, £, €) and minor unit formatting.',
      'Set the Default Tax Rate percentage (applied to discounted sales subtotals).',
      'Set the Maximum Staff Discount percentage to prevent unauthorized counter markdowns.',
      'Under User Management, add new Staff users with distinct usernames and passwords.',
      'Reset passwords or deactivate user accounts when necessary.'
    ],
    rules: [
      'Server Enforced Permissions: Staff restrictions on voiding, supplier costs, purchasing, and dashboard are enforced on backend endpoints, not just hidden in the frontend.',
      'Session Security: Authenticated sessions use HTTP cookies with secure credentials.'
    ]
  }
];

export default function Help({ publicView = false }) {
  const location = useLocation();
  const { isOwner } = useAuth();
  const [filter, setFilter] = useState('');
  const [highlightedId, setHighlightedId] = useState(null);
  const sectionRefs = useRef({});

  // Determine target section from query param (?section=xyz) or hash (#xyz)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetSection = params.get('section') || location.hash.replace('#', '');
    if (targetSection) {
      setHighlightedId(targetSection);
      const el = document.getElementById(`help-${targetSection}`);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }, [location]);

  const filteredSections = HELP_SECTIONS.filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.group.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.steps.some((st) => st.toLowerCase().includes(q)) ||
      s.rules.some((r) => r.toLowerCase().includes(q))
    );
  });

  const jumpTo = (id) => {
    setHighlightedId(id);
    const el = document.getElementById(`help-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="max-w-[1180px] mx-auto py-2 px-1">
      {/* Header Banner */}
      <div className="card shadow-hard bg-sheet border-ink mb-4 p-4 animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-ink">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="badge badge-info uppercase tracking-widest text-[.72rem]">Operations Manual</span>
              <span className="text-muted text-[.8rem]">· Reference & Functional Guidelines</span>
            </div>
            <h1 className="!mb-0 !border-0 text-2xl font-serif">System Help & User Guide</h1>
          </div>
          <div className="flex gap-2">
            {publicView ? (
              <Link to="/" className="btn btn-primary">← Return to Landing / Sign In</Link>
            ) : (
              <Link to="/landing" className="btn btn-sm">View Platform Overview</Link>
            )}
          </div>
        </div>

        <p className="text-muted text-[.92rem] max-w-3xl mb-3">
          Comprehensive operational reference for the Bookshop Automation System. Select any feature below to inspect
          step-by-step procedures, business rule constraints, and direct application links.
        </p>

        {/* Quick Search & Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="input max-w-[380px]"
            placeholder="Search keywords (e.g. ISBN, void, discount, COGS, lead time)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="btn btn-sm" onClick={() => setFilter('')}>Clear search</button>
          )}
          <span className="text-muted text-[.8rem] ml-auto">
            Showing {filteredSections.length} of {HELP_SECTIONS.length} modules
          </span>
        </div>
      </div>

      {/* Quick Navigation Shortcuts */}
      <div className="flex flex-wrap gap-1.5 mb-4 sticky top-1 z-10 bg-paper/95 backdrop-blur-sm p-1.5 border border-ink">
        <span className="text-[.72rem] uppercase font-bold tracking-wider text-muted self-center mr-1">Jump to:</span>
        {HELP_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jumpTo(s.id)}
            className={`btn btn-sm text-[.78rem] ${highlightedId === s.id ? 'bg-ink text-paper font-bold' : ''}`}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* Help Sections Container */}
      <div className="space-y-4">
        {filteredSections.length === 0 ? (
          <div className="empty">No matching help articles found for "{filter}".</div>
        ) : (
          filteredSections.map((s) => {
            const isTarget = highlightedId === s.id;
            return (
              <article
                key={s.id}
                id={`help-${s.id}`}
                className={`card bg-sheet border border-ink p-4 transition-all duration-300 ${isTarget ? 'help-highlighted' : 'shadow-hard-sm'}`}
              >
                {/* Section Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-2.5 mb-3 border-b border-hair">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge badge-info">{s.group}</span>
                      <span className="badge">{s.role}</span>
                      {isTarget && <span className="badge badge-warn font-bold animate-pulse">Selected Section</span>}
                    </div>
                    <h2 className="!mb-0 text-xl font-serif text-ink">{s.title}</h2>
                  </div>
                  {!publicView && (
                    <Link
                      to={s.path}
                      className="btn btn-primary btn-sm flex items-center gap-1 font-bold"
                    >
                      Open {s.title} in App →
                    </Link>
                  )}
                </div>

                {/* Summary */}
                <p className="text-[.94rem] text-ink font-medium mb-3">
                  {s.summary}
                </p>

                {/* Two Column Layout: Steps & Constraints */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Step by Step */}
                  <div className="p-3 bg-paper border border-hair">
                    <h3 className="!mt-0 !mb-2 !text-[.85rem] uppercase tracking-wider text-muted !border-b-hair font-bold">
                      Standard Workflow & Operating Steps
                    </h3>
                    <ol className="list-decimal list-inside space-y-1.5 text-[.88rem] text-ink">
                      {s.steps.map((st, i) => (
                        <li key={i} className="leading-snug">
                          <span className="align-text-top">{st}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Rules and System Integrity */}
                  <div className="p-3 bg-paper border border-hair">
                    <h3 className="!mt-0 !mb-2 !text-[.85rem] uppercase tracking-wider text-muted !border-b-hair font-bold">
                      System Rules & Integrity Safeguards
                    </h3>
                    <ul className="space-y-1.5 text-[.88rem] text-ink">
                      {s.rules.map((r, i) => (
                        <li key={i} className="leading-snug flex items-start gap-1.5">
                          <span className="text-navy font-bold">▪</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Footer jump back */}
                <div className="mt-3 pt-2 border-t border-hair flex justify-between items-center text-[.78rem] text-muted">
                  <span>URL Anchor: <code className="font-mono text-ink">#/help#{s.id}</code></span>
                  <button className="btn-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    ↑ Top of Page
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

