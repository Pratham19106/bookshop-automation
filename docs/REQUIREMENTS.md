# Requirements and Status

Status words are literal: **Implemented** = code exists; **Tested** = covered by automated tests that pass (70 backend tests);
**UI-checked** = exercised by the headless-browser test. Anything not listed as tested should be treated as unverified.

| # | Requirement | Where | Status |
|---|---|---|---|
| 4.1 | Catalogue and physical location | `services/books.js`, `pages/catalogue.js` | Implemented, tested (API), UI-checked (search, add) |
| 4.2 | Billing interface | `services/sales.js`, `pages/billing.js`, `receipt.html` | Implemented, tested, UI-checked (sale, oversell block, receipt) |
| 4.3 | Inventory and automatic stock updates | `services/inventory.js` | Implemented, tested |
| 4.4 | Rule-based restocking | `services/restock.js`, `pages/restock.js` | Implemented, tested (API); UI partly checked |
| 4.5 | Supplier management | `services/suppliers.js`, `purchasing.js` | Implemented, tested (API); UI not browser-tested |
| 4.6 | Sales and expenses dashboard | `services/dashboard.js`, `pages/dashboard.js` | Implemented, tested against known data; page renders |
| 4.7 | Phone-in orders | `services/orders.js`, `pages/orders.js` | Implemented, tested, UI-checked (create, ready, complete) |

## Acceptance criteria and where they are enforced

**Catalogue.** Each edition is its own record (own ISBN, own stock). ISBN-10/13 checksums are validated; duplicate ISBNs are rejected
with the clashing title named. Without an ISBN, title+author+edition+publisher must be unique. Search matches title, author, publisher,
genre, edition and ISBN (hyphens ignored), every word must match, exact ISBN ranks first. Results show price, available stock and Aisle/Rack/Shelf.

**Billing.** Prices, discount limits, tax and stock checks are computed on the server; client-sent prices are ignored. A sale runs in one
`BEGIN IMMEDIATE` transaction: any failure rolls back bill, items and stock. Items keep the title, price and cost at the time of sale.
An idempotency key makes a repeated submit return the original bill. Owners can void a counter bill (stock restored, excluded from reports).

**Inventory.** Stock changes only through one function (`applyStock`) with a guarded UPDATE, backed by `CHECK` constraints
(stock >= 0, reserved <= stock). Every change is written to an append-only `stock_movements` ledger. Owners correct stock by entering a counted quantity and a reason.
Low-stock threshold is per book or a shop default.

**Restocking.** Per book: sales velocity over a configurable window (counting only days actually observed), available stock (minus phone-order reservations),
quantity already on open purchase orders, days of cover versus supplier lead time, and the low-stock threshold. Output: urgency (critical/high/medium),
reasons in plain words, all underlying numbers, a suggested quantity (`ceil(velocity x cover days) + threshold - available - on order`), cheapest supplier and cost estimate.
Thin data is labelled low-confidence rather than hidden; voided sales and old sales are ignored.

**Suppliers and purchasing.** Supplier records, per-book quoted prices (several suppliers per book, cheapest first), purchase orders, and goods receipts that
accept partial deliveries, refuse over-receipt, update stock, the weighted-average cost and the supplier's price, and are idempotent. Owner-only.

**Dashboard.** Revenue = net sales (subtotal minus discount, excluding tax). COGS uses the cost recorded at the time of sale. Gross profit = revenue - COGS.
Purchase spend = value of goods received. Operating profit = gross profit - operating expenses (purchases are not deducted twice). A rough net cash movement is shown separately.
Sales with unknown cost are counted and flagged so profit is not silently overstated. Today / this week / this month plus any date range, grouped by day, week or month.

**Phone orders.** Lifecycle `placed -> ready -> (out_for_delivery) -> completed`, or `cancelled`. Stock is *reserved* on placement and only deducted on completion,
in the same transaction that creates the bill (`sales.order_id` is unique, so an order can never be billed twice). Payment status (unpaid/partial/paid/refund_due/refunded)
is derived from a separate payment ledger. Advance payments are not revenue until the order completes. Modifying an order re-syncs reservations; cancelling releases them.

## Assumptions (documented, changeable)

- Single currency; money stored as integer minor units (paise/cents). One global tax rate on the discounted subtotal (default 0 %, books are often exempt).
- Discount is a bill-level percentage; staff limit defaults to 10 %.
- Stock is not allowed to go negative and there are no backorders: a phone order cannot reserve more than is available.
- A phone order keeps the price agreed when a line was added; later catalogue price changes do not alter it.
- Purchase spend is recognised when goods are **received**, not when ordered.
- Phone-order bills cannot be voided from the Bills screen; cancel before completion instead.
- Reports use a fixed UTC offset (`TZ_OFFSET_MINUTES`), so daylight-saving shifts are not handled.

## Known limitations

- The UI has been checked by an automated browser test only partly (see table); suppliers, purchases, settings and expenses forms have no browser test.
- Single-process, single-database design (SQLite). Fine for one shop; not for multi-branch.
- Login throttling is in-memory and resets on restart. No password-reset email; the owner resets passwords in Settings.
- No barcode-scanner hardware integration (a scanner that types an ISBN plus Enter works in the search boxes), no online payments, no telephony.
- There is no automated test for the frontend beyond the browser script; no linting is configured.
