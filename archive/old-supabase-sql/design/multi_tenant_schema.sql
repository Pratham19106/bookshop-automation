-- LOCAL DESIGN ONLY: clean installation into an empty Supabase database.
-- Do not run against the existing application database. This is not an upgrade migration.
-- All monetary amounts are integer minor units; percentage rates are basis points.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bookshop_private;
REVOKE ALL ON SCHEMA bookshop_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
  currency_code text NOT NULL DEFAULT 'INR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  currency_symbol text NOT NULL DEFAULT '₹', timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  tax_bp integer NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),
  staff_max_discount_bp integer NOT NULL DEFAULT 1000 CHECK (staff_max_discount_bp BETWEEN 0 AND 10000),
  default_low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (default_low_stock_threshold >= 0),
  restock_lookback_days integer NOT NULL DEFAULT 30 CHECK (restock_lookback_days BETWEEN 7 AND 365),
  restock_cover_days integer NOT NULL DEFAULT 21 CHECK (restock_cover_days BETWEEN 1 AND 365),
  restock_default_lead_days integer NOT NULL DEFAULT 7 CHECK (restock_default_lead_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  code text NOT NULL, name text NOT NULL, address text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', is_headquarters boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id), UNIQUE (business_id, code)
);
CREATE UNIQUE INDEX outlets_one_headquarters ON public.outlets(business_id) WHERE is_headquarters AND active;

-- Identity comes from Supabase Auth; credentials and session tokens are never stored here.
CREATE TABLE public.business_memberships (
  business_id uuid NOT NULL REFERENCES public.businesses(id), user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('owner','staff')), active boolean NOT NULL DEFAULT true,
  full_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);
CREATE INDEX memberships_user_active ON public.business_memberships(user_id, business_id) WHERE active;
-- Owners have access to all outlets in their business; staff need explicit assignments.
CREATE TABLE public.outlet_memberships (
  business_id uuid NOT NULL, outlet_id uuid NOT NULL, user_id uuid NOT NULL,
  PRIMARY KEY (business_id, outlet_id, user_id),
  FOREIGN KEY (business_id, outlet_id) REFERENCES public.outlets(business_id, id),
  FOREIGN KEY (business_id, user_id) REFERENCES public.business_memberships(business_id, user_id)
);
CREATE INDEX outlet_memberships_user ON public.outlet_memberships(user_id, business_id, outlet_id);

CREATE TABLE public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  title text NOT NULL CHECK (length(btrim(title))>0), author text NOT NULL DEFAULT '', isbn text,
  publisher text NOT NULL DEFAULT '', edition text NOT NULL DEFAULT '', genre text NOT NULL DEFAULT '',
  price_minor bigint NOT NULL CHECK (price_minor >= 0), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id), CHECK (isbn IS NULL OR isbn ~ '^([0-9]{13}|[0-9]{9}[0-9X])$')
);
CREATE UNIQUE INDEX books_isbn_per_business ON public.books(business_id, isbn) WHERE isbn IS NOT NULL;
CREATE UNIQUE INDEX books_identity_per_business ON public.books(business_id, lower(btrim(title)), lower(btrim(author)), lower(btrim(edition)), lower(btrim(publisher))) WHERE isbn IS NULL;
CREATE INDEX books_business_title ON public.books(business_id, title);

CREATE TABLE public.outlet_inventory (
  business_id uuid NOT NULL, outlet_id uuid NOT NULL, book_id uuid NOT NULL,
  stock_qty integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0), reserved_qty integer NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0 AND reserved_qty <= stock_qty),
  low_stock_threshold integer CHECK (low_stock_threshold >= 0),
  aisle text NOT NULL DEFAULT '', rack text NOT NULL DEFAULT '', shelf text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (business_id, outlet_id, book_id),
  FOREIGN KEY (business_id, outlet_id) REFERENCES public.outlets(business_id,id),
  FOREIGN KEY (business_id, book_id) REFERENCES public.books(business_id,id)
);
-- Costs are owner-only and kept separate from staff-readable inventory.
CREATE TABLE public.inventory_costs (
  business_id uuid NOT NULL, outlet_id uuid NOT NULL, book_id uuid NOT NULL,
  average_cost_minor bigint CHECK (average_cost_minor >= 0),
  PRIMARY KEY (business_id,outlet_id,book_id),
  FOREIGN KEY (business_id,outlet_id,book_id) REFERENCES public.outlet_inventory(business_id,outlet_id,book_id)
);
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, book_id uuid NOT NULL,
  stock_delta integer NOT NULL DEFAULT 0, reserved_delta integer NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN ('opening','sale','sale_void','refund','exchange','receipt','adjustment','reservation','reservation_release')),
  reference_type text NOT NULL DEFAULT '', reference_id uuid, note text NOT NULL DEFAULT '', actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (stock_delta <> 0 OR reserved_delta <> 0),
  FOREIGN KEY (business_id,outlet_id,book_id) REFERENCES public.outlet_inventory(business_id,outlet_id,book_id),
  FOREIGN KEY (business_id,actor_id) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE INDEX stock_movements_history ON public.stock_movements(business_id,outlet_id,book_id,created_at DESC);
CREATE INDEX stock_movements_actor ON public.stock_movements(business_id,actor_id);

CREATE TABLE public.phone_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL,
  order_no text NOT NULL, customer_name text NOT NULL, customer_phone text NOT NULL,
  delivery_type text NOT NULL CHECK (delivery_type IN ('pickup','delivery')), delivery_address text NOT NULL DEFAULT '',
  promised_date date, notes text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','ready','out_for_delivery','completed','cancelled')),
  discount_bp integer NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000), tax_bp integer NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0), discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0), total_minor bigint NOT NULL CHECK (total_minor = subtotal_minor-discount_minor+tax_minor AND total_minor >= 0),
  cancel_reason text NOT NULL DEFAULT '', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,outlet_id,id), UNIQUE (business_id,order_no),
  CHECK (delivery_type <> 'delivery' OR length(btrim(delivery_address)) > 0),
  FOREIGN KEY (business_id,outlet_id) REFERENCES public.outlets(business_id,id),
  FOREIGN KEY (business_id,created_by) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE TABLE public.phone_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, order_id uuid NOT NULL, book_id uuid NOT NULL,
  title text NOT NULL, quantity integer NOT NULL CHECK (quantity>0), unit_price_minor bigint NOT NULL CHECK (unit_price_minor>=0),
  UNIQUE(business_id,id), UNIQUE(business_id,order_id,book_id),
  FOREIGN KEY (business_id,outlet_id,order_id) REFERENCES public.phone_orders(business_id,outlet_id,id),
  FOREIGN KEY (business_id,book_id) REFERENCES public.books(business_id,id)
);
CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, order_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor<>0), method text NOT NULL CHECK(method IN ('cash','card','upi','other')),
  note text NOT NULL DEFAULT '', actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,outlet_id,order_id) REFERENCES public.phone_orders(business_id,outlet_id,id),
  FOREIGN KEY (business_id,actor_id) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, bill_no text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')), customer_name text NOT NULL DEFAULT '',
  payment_method text NOT NULL CHECK(payment_method IN ('cash','card','upi','other')),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor>=0), discount_bp integer NOT NULL CHECK(discount_bp BETWEEN 0 AND 10000),
  discount_minor bigint NOT NULL CHECK(discount_minor>=0), tax_bp integer NOT NULL CHECK(tax_bp BETWEEN 0 AND 10000),
  tax_minor bigint NOT NULL CHECK(tax_minor>=0), total_minor bigint NOT NULL CHECK(total_minor=subtotal_minor-discount_minor+tax_minor AND total_minor>=0),
  order_id uuid, idempotency_key text, cashier_id uuid NOT NULL, void_reason text, voided_at timestamptz, voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,id), UNIQUE(business_id,outlet_id,id), UNIQUE(business_id,bill_no),
  UNIQUE(business_id,idempotency_key), UNIQUE(business_id,order_id),
  CHECK ((status='completed' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
         (status='voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(btrim(void_reason))>0)),
  FOREIGN KEY(business_id,outlet_id) REFERENCES public.outlets(business_id,id),
  FOREIGN KEY(business_id,outlet_id,order_id) REFERENCES public.phone_orders(business_id,outlet_id,id),
  FOREIGN KEY(business_id,cashier_id) REFERENCES public.business_memberships(business_id,user_id),
  FOREIGN KEY(business_id,voided_by) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE INDEX sales_outlet_date ON public.sales(business_id,outlet_id,created_at DESC);
CREATE INDEX sales_business_date ON public.sales(business_id,created_at DESC);
CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, sale_id uuid NOT NULL, book_id uuid NOT NULL,
  title text NOT NULL, author text NOT NULL DEFAULT '', isbn text, edition text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK(quantity>0), unit_price_minor bigint NOT NULL CHECK(unit_price_minor>=0),
  line_total_minor bigint NOT NULL CHECK(line_total_minor=quantity*unit_price_minor),
  UNIQUE(business_id,id), UNIQUE(business_id,outlet_id,sale_id,id), UNIQUE(business_id,sale_id,book_id),
  FOREIGN KEY(business_id,outlet_id,sale_id) REFERENCES public.sales(business_id,outlet_id,id),
  FOREIGN KEY(business_id,book_id) REFERENCES public.books(business_id,id)
);
CREATE TABLE public.sale_item_costs (
  business_id uuid NOT NULL, sale_item_id uuid NOT NULL, unit_cost_minor bigint CHECK(unit_cost_minor>=0),
  PRIMARY KEY(business_id,sale_item_id), FOREIGN KEY(business_id,sale_item_id) REFERENCES public.sale_items(business_id,id)
);
CREATE TABLE public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, sale_id uuid NOT NULL, sale_item_id uuid NOT NULL,
  type text NOT NULL CHECK(type IN ('refund','exchange')), quantity integer NOT NULL CHECK(quantity>0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK(amount_minor>=0), replacement_book_id uuid,
  reason text NOT NULL DEFAULT '', actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type='exchange' AND replacement_book_id IS NOT NULL) OR (type='refund' AND replacement_book_id IS NULL)),
  FOREIGN KEY(business_id,outlet_id,sale_id,sale_item_id) REFERENCES public.sale_items(business_id,outlet_id,sale_id,id),
  FOREIGN KEY(business_id,replacement_book_id) REFERENCES public.books(business_id,id),
  FOREIGN KEY(business_id,actor_id) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE INDEX sale_returns_period ON public.sale_returns(business_id,outlet_id,created_at);
CREATE INDEX sale_returns_item ON public.sale_returns(business_id,outlet_id,sale_id,sale_item_id);
CREATE INDEX sale_items_book ON public.sale_items(business_id,book_id);
CREATE INDEX phone_order_items_parent ON public.phone_order_items(business_id,outlet_id,order_id);
CREATE INDEX order_payments_parent ON public.order_payments(business_id,outlet_id,order_id);

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  name text NOT NULL, contact_person text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '', categories text NOT NULL DEFAULT '', lead_time_days integer NOT NULL DEFAULT 7 CHECK(lead_time_days>=0),
  notes text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,id)
);
CREATE UNIQUE INDEX suppliers_name_per_business ON public.suppliers(business_id, lower(btrim(name)));
CREATE TABLE public.supplier_books (
  business_id uuid NOT NULL, supplier_id uuid NOT NULL, book_id uuid NOT NULL, unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>=0),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,supplier_id,book_id),
  FOREIGN KEY(business_id,supplier_id) REFERENCES public.suppliers(business_id,id),
  FOREIGN KEY(business_id,book_id) REFERENCES public.books(business_id,id)
);
CREATE INDEX supplier_books_by_book ON public.supplier_books(business_id,book_id);
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, supplier_id uuid NOT NULL,
  po_no text NOT NULL, status text NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','partially_received','received','cancelled')),
  expected_date date, notes text NOT NULL DEFAULT '', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,id), UNIQUE(business_id,outlet_id,id), UNIQUE(business_id,po_no),
  FOREIGN KEY(business_id,outlet_id) REFERENCES public.outlets(business_id,id),
  FOREIGN KEY(business_id,supplier_id) REFERENCES public.suppliers(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, po_id uuid NOT NULL, book_id uuid NOT NULL,
  qty_ordered integer NOT NULL CHECK(qty_ordered>0), qty_received integer NOT NULL DEFAULT 0 CHECK(qty_received BETWEEN 0 AND qty_ordered),
  unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>=0), UNIQUE(business_id,id), UNIQUE(business_id,outlet_id,po_id,id), UNIQUE(business_id,po_id,book_id),
  FOREIGN KEY(business_id,outlet_id,po_id) REFERENCES public.purchase_orders(business_id,outlet_id,id),
  FOREIGN KEY(business_id,book_id) REFERENCES public.books(business_id,id)
);
CREATE TABLE public.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, po_id uuid NOT NULL,
  total_minor bigint NOT NULL CHECK(total_minor>=0), note text NOT NULL DEFAULT '', idempotency_key text, actor_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,id), UNIQUE(business_id,outlet_id,po_id,id), UNIQUE(business_id,idempotency_key),
  FOREIGN KEY(business_id,outlet_id,po_id) REFERENCES public.purchase_orders(business_id,outlet_id,id),
  FOREIGN KEY(business_id,actor_id) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE TABLE public.goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid NOT NULL, po_id uuid NOT NULL,
  receipt_id uuid NOT NULL, po_item_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity>0), unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>=0),
  UNIQUE(business_id,receipt_id,po_item_id),
  FOREIGN KEY(business_id,outlet_id,po_id,receipt_id) REFERENCES public.goods_receipts(business_id,outlet_id,po_id,id),
  FOREIGN KEY(business_id,outlet_id,po_id,po_item_id) REFERENCES public.purchase_order_items(business_id,outlet_id,po_id,id)
);
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, outlet_id uuid,
  expense_date date NOT NULL, category text NOT NULL, description text NOT NULL DEFAULT '',
  amount_minor bigint NOT NULL CHECK(amount_minor>0), actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(business_id) REFERENCES public.businesses(id), FOREIGN KEY(business_id,outlet_id) REFERENCES public.outlets(business_id,id),
  FOREIGN KEY(business_id,actor_id) REFERENCES public.business_memberships(business_id,user_id)
);
CREATE INDEX expenses_period ON public.expenses(business_id,outlet_id,expense_date);
CREATE INDEX phone_orders_outlet_status ON public.phone_orders(business_id,outlet_id,status,created_at DESC);
CREATE INDEX purchase_orders_outlet_status ON public.purchase_orders(business_id,outlet_id,status,created_at DESC);
CREATE INDEX receipts_outlet_date ON public.goods_receipts(business_id,outlet_id,received_at DESC);
CREATE INDEX purchase_order_items_parent ON public.purchase_order_items(business_id,outlet_id,po_id);
CREATE INDEX goods_receipt_items_parent ON public.goods_receipt_items(business_id,outlet_id,po_id,receipt_id);

-- Read-only browser access. All mutations require a future trusted, transactional API.
-- Security-definer helpers are private, fixed search_path, and use only auth.uid(), not user metadata.
CREATE FUNCTION bookshop_private.is_member(target_business uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (select auth.uid()) IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_memberships m WHERE m.business_id=target_business AND m.user_id=(select auth.uid()) AND m.active)
$$;
CREATE FUNCTION bookshop_private.is_owner(target_business uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (select auth.uid()) IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_memberships m WHERE m.business_id=target_business AND m.user_id=(select auth.uid()) AND m.active AND m.role='owner')
$$;
CREATE FUNCTION bookshop_private.can_access_outlet(target_business uuid, target_outlet uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (select auth.uid()) IS NOT NULL AND (bookshop_private.is_owner(target_business) OR EXISTS (
 SELECT 1 FROM public.outlet_memberships o JOIN public.business_memberships m ON m.business_id=o.business_id AND m.user_id=o.user_id
 WHERE o.business_id=target_business AND o.outlet_id=target_outlet AND o.user_id=(select auth.uid()) AND m.active))
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bookshop_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA bookshop_private TO authenticated;
GRANT EXECUTE ON FUNCTION bookshop_private.is_member(uuid), bookshop_private.is_owner(uuid), bookshop_private.can_access_outlet(uuid,uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['businesses','outlets','business_memberships','outlet_memberships','books','outlet_inventory','inventory_costs','stock_movements','phone_orders','phone_order_items','order_payments','sales','sale_items','sale_item_costs','sale_returns','suppliers','supplier_books','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','expenses'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY business_read ON public.businesses FOR SELECT TO authenticated USING (bookshop_private.is_member(id));
CREATE POLICY memberships_read ON public.business_memberships FOR SELECT TO authenticated USING (user_id=(select auth.uid()) OR bookshop_private.is_owner(business_id));
CREATE POLICY outlet_memberships_read ON public.outlet_memberships FOR SELECT TO authenticated USING (user_id=(select auth.uid()) OR bookshop_private.is_owner(business_id));
CREATE POLICY outlets_read ON public.outlets FOR SELECT TO authenticated USING (bookshop_private.can_access_outlet(business_id,id));
CREATE POLICY books_read ON public.books FOR SELECT TO authenticated USING (bookshop_private.is_member(business_id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['outlet_inventory','stock_movements','phone_orders','phone_order_items','order_payments','sales','sale_items','sale_returns'] LOOP
   EXECUTE format('CREATE POLICY outlet_read ON public.%I FOR SELECT TO authenticated USING (bookshop_private.can_access_outlet(business_id,outlet_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['inventory_costs','sale_item_costs','suppliers','supplier_books','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','expenses'] LOOP
   EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING (bookshop_private.is_owner(business_id))',t);
 END LOOP;
END $$;
COMMIT;
