-- Adjustment bills are additive; original sales and legacy return records are preserved.
ALTER TABLE shop_counters DROP CONSTRAINT shop_counters_kind_check;
ALTER TABLE shop_counters ADD CONSTRAINT shop_counters_kind_check CHECK (kind IN ('bill','order','po','adjustment'));

CREATE TABLE adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id bigint NOT NULL, shop_id bigint NOT NULL, original_sale_id bigint NOT NULL REFERENCES sales(id),
  adj_no text NOT NULL, type text NOT NULL CHECK (type IN ('refund','exchange')),
  net_cents bigint NOT NULL, payment_method text CHECK (payment_method IN ('cash','card','upi','other')),
  user_id bigint REFERENCES users(id), reason text NOT NULL DEFAULT '', idempotency_key text, request_hash text,
  legacy_return_id bigint UNIQUE REFERENCES sale_returns(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id,adj_no), UNIQUE(shop_id,idempotency_key), UNIQUE(business_id,shop_id,id),
  FOREIGN KEY(business_id,shop_id) REFERENCES shops(business_id,id),
  CHECK (net_cents = 0 OR payment_method IS NOT NULL)
);
CREATE INDEX adjustments_shop_date ON adjustments(shop_id,created_at);
CREATE INDEX adjustments_original_sale ON adjustments(original_sale_id);
CREATE TABLE adjustment_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adjustment_id bigint NOT NULL REFERENCES adjustments(id), book_id bigint NOT NULL REFERENCES books(id),
  title text NOT NULL, author text NOT NULL DEFAULT '', isbn text, edition text NOT NULL DEFAULT '',
  sign smallint NOT NULL CHECK (sign IN (-1,1)), quantity integer NOT NULL CHECK(quantity>0),
  unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), unit_cost_cents integer CHECK(unit_cost_cents>=0),
  line_total_cents bigint NOT NULL CHECK(line_total_cents>=0), tax_cents bigint NOT NULL CHECK(tax_cents>=0),
  source_sale_item_id bigint REFERENCES sale_items(id), source_adjustment_item_id bigint REFERENCES adjustment_items(id),
  returned_qty integer NOT NULL DEFAULT 0 CHECK(returned_qty BETWEEN 0 AND quantity),
  CHECK ((sign=1 AND source_sale_item_id IS NULL AND source_adjustment_item_id IS NULL) OR
         (sign=-1 AND ((source_sale_item_id IS NOT NULL)::integer + (source_adjustment_item_id IS NOT NULL)::integer)=1))
);
CREATE INDEX adjustment_items_adjustment ON adjustment_items(adjustment_id);
CREATE INDEX adjustment_items_source ON adjustment_items(source_sale_item_id,source_adjustment_item_id);
ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_items ENABLE ROW LEVEL SECURITY;

-- Assign deterministic per-shop numbers without relying on a global identifier.
WITH numbered AS (
 SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.shop_id ORDER BY r.created_at,r.id) AS n,
        COALESCE(c.value,0) AS base, sh.code, s.payment_method
 FROM sale_returns r JOIN sales s ON s.id=r.sale_id JOIN shops sh ON sh.id=r.shop_id
 LEFT JOIN shop_counters c ON c.shop_id=r.shop_id AND c.kind='adjustment'
)
INSERT INTO adjustments(business_id,shop_id,original_sale_id,adj_no,type,net_cents,payment_method,user_id,reason,legacy_return_id,created_at)
SELECT business_id,shop_id,sale_id,'ADJ-' || code || '-' || lpad((base+n)::text,5,'0'),type,
       CASE WHEN type='refund' THEN -(amount_cents+tax_cents) ELSE 0 END,
       CASE WHEN type='refund' THEN payment_method ELSE NULL END,user_id,reason,id,created_at FROM numbered;

INSERT INTO adjustment_items(adjustment_id,book_id,title,author,isbn,edition,sign,quantity,unit_price_cents,unit_cost_cents,line_total_cents,tax_cents,source_sale_item_id)
SELECT a.id,i.book_id,i.title,i.author,i.isbn,i.edition,-1,r.quantity,i.unit_price_cents,i.unit_cost_cents,
       CASE WHEN r.type='refund' THEN r.amount_cents ELSE 0 END,r.tax_cents,i.id
FROM sale_returns r JOIN adjustments a ON a.legacy_return_id=r.id JOIN sale_items i ON i.id=r.sale_item_id;

-- Historical exchanges did not retain replacement price/cost snapshots. Preserve zero impact and mark cost unknown.
INSERT INTO adjustment_items(adjustment_id,book_id,title,author,isbn,edition,sign,quantity,unit_price_cents,unit_cost_cents,line_total_cents,tax_cents)
SELECT a.id,b.id,b.title,b.author,b.isbn,b.edition,1,r.quantity,0,NULL,0,0
FROM sale_returns r JOIN adjustments a ON a.legacy_return_id=r.id JOIN books b ON b.id=r.replacement_book_id WHERE r.type='exchange';

INSERT INTO shop_counters(shop_id,kind,value)
SELECT shop_id,'adjustment',COUNT(*) FROM adjustments WHERE legacy_return_id IS NOT NULL GROUP BY shop_id
ON CONFLICT(shop_id,kind) DO UPDATE SET value=shop_counters.value+EXCLUDED.value;
