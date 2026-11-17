-- No paise anywhere: selling prices, supplier quotes and stock costs become whole rupees (nearest rupee).
-- Amounts stay stored in paise (rupees x 100); from now on every amount is a multiple of 100.
-- Completed bills, receipts and payments are history and are left exactly as they were recorded.

update books          set price_cents     = round(price_cents / 100.0) * 100     where price_cents % 100 <> 0;
update supplier_books set unit_cost_cents = round(unit_cost_cents / 100.0) * 100 where unit_cost_cents % 100 <> 0;
update shop_stock     set cost_cents      = round(cost_cents / 100.0) * 100      where cost_cents % 100 <> 0;
update purchase_order_items set unit_cost_cents = round(unit_cost_cents / 100.0) * 100
 where unit_cost_cents % 100 <> 0 and qty_received < qty_ordered;  -- only lines still to be received

-- Keep it that way for the values people enter.
alter table books          add constraint books_price_whole_rupees          check (price_cents % 100 = 0);
alter table supplier_books add constraint supplier_books_cost_whole_rupees  check (unit_cost_cents % 100 = 0);
alter table expenses       add constraint expenses_amount_whole_rupees      check (amount_cents % 100 = 0) not valid;
