# Demo script (about 6 minutes)

**The day before:** reseed so "today" and "this month" have fresh figures: `npm run seed -- --force`
(demo database only). Then run `npm --prefix backend run prod-check -- <site-url> owner owner12345`.

**Ten minutes before:** open the site once so the free Render service is awake.

**Devices:** a phone (the owner) and a laptop (the counter). Both signed in on the live site.

| Who | Username | Password |
|---|---|---|
| Owner (phone) | `owner` | `owner12345` |
| FC Road counter (laptop) | `punestaff` | `staff12345` |
| Manager | `manager` | `manager12345` |
| Dadar counter | `staff` | `staff12345` |

## 1. Several shops, one owner (1 min)
- Phone, owner: **Dashboard**, Shop = *All shops*. Point out net sales, gross profit, operating profit, and
  "Net sales by shop" for Dadar (S01) and FC Road (S02).
- Header shop switcher: owner can work in either shop; bills are numbered per shop (`INV-S01-…`, `INV-S02-…`).

## 2. Realtime (1 min)
- Phone stays on **Bills** (or the Dashboard).
- Laptop, `punestaff`: **Billing** → search a title → add → **Finalize sale**.
- The phone shows the new `INV-S02-…` bill and updated figures **without refreshing**.
- Staff in Dadar would not see FC Road's bill; another business would see nothing.

## 3. Returns and exchange (1.5 min)
- Laptop: **Bills** → open the bill just made.
  - **Refund** one copy, add a reason → the amount handed back (including tax) is shown and the copy is back in stock.
  - On another bill, **Exchange** a copy for a different title **of the same price** that is in stock.
  - The return log on the bill shows who did what and when.
- Point out: only within the return window set in Settings (7 days); a different-price exchange is refused.

## 4. Financial statement (1.5 min)
- Phone or laptop, owner: **Reports → Financial Statement** → *Last month* (or *This month*), *All my shops*.
- It reads like a bill: one column per shop plus **Total**; sales at list price, discounts, refunds, net sales,
  tax, money received by payment method, cost of books sold, gross profit and margin, each expense category,
  operating profit, and stock bought.
- **Print / Save PDF**.

## 5. Manager and roles (1 min)
- Sign in as `manager`: Restocking → create a purchase order from a suggestion → Purchases → **Receive** it;
  stock and average cost update.
- Sign in as `staff`: no Dashboard / Suppliers / Purchases, no cost prices; the server refuses those requests too.

## If something goes wrong
- "Reconnecting…" in the header: the live connection dropped; it retries by itself and catches up.
- Very slow first load: the Render service was asleep; wait 30 seconds and reload.
