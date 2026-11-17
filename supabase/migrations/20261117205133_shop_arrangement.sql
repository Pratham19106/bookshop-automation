-- Shop-specific physical layout. Existing quantities remain unassigned until confirmed.
CREATE TABLE shelves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id bigint NOT NULL, shop_id bigint NOT NULL,
  aisle text NOT NULL CHECK(length(btrim(aisle))>0), rack text NOT NULL CHECK(length(btrim(rack))>0),
  shelf text NOT NULL CHECK(length(btrim(shelf))>0), capacity integer NOT NULL CHECK(capacity>0),
  category_hint text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  UNIQUE(shop_id,aisle,rack,shelf), UNIQUE(business_id,shop_id,id),
  FOREIGN KEY(business_id,shop_id) REFERENCES shops(business_id,id)
);
CREATE TABLE shelf_stock (
  business_id bigint NOT NULL, shop_id bigint NOT NULL, shelf_id bigint NOT NULL, book_id bigint NOT NULL,
  qty integer NOT NULL CHECK(qty>=0), PRIMARY KEY(shelf_id,book_id),
  FOREIGN KEY(business_id,shop_id,shelf_id) REFERENCES shelves(business_id,shop_id,id),
  FOREIGN KEY(business_id,book_id) REFERENCES books(business_id,id),
  FOREIGN KEY(shop_id,book_id) REFERENCES shop_stock(shop_id,book_id)
);
CREATE INDEX shelf_stock_book ON shelf_stock(shop_id,book_id);
CREATE TABLE arrangement_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id bigint NOT NULL, shop_id bigint NOT NULL,
  book_id bigint NOT NULL, proposed_shelf_id bigint, qty integer NOT NULL CHECK(qty>0),
  source text NOT NULL CHECK(source IN ('receipt','return','adjustment','stock_count','migration')),
  source_ref bigint, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  created_by bigint REFERENCES users(id), done_by bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz,
  FOREIGN KEY(business_id,shop_id) REFERENCES shops(business_id,id),
  FOREIGN KEY(business_id,book_id) REFERENCES books(business_id,id),
  FOREIGN KEY(business_id,shop_id,proposed_shelf_id) REFERENCES shelves(business_id,shop_id,id),
  CHECK ((status='done') = (done_at IS NOT NULL AND done_by IS NOT NULL))
);
CREATE INDEX arrangement_open ON arrangement_tasks(shop_id,status,created_at,id);
CREATE INDEX arrangement_book ON arrangement_tasks(shop_id,book_id,status);
ALTER TABLE shelves ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelf_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrangement_tasks ENABLE ROW LEVEL SECURITY;

-- Locks prevent concurrent placements on the same shelf or book exceeding either limit.
CREATE FUNCTION enforce_shelf_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available integer; room integer; placed integer; occupied integer;
BEGIN
  SELECT stock_qty INTO available FROM shop_stock WHERE shop_id=NEW.shop_id AND book_id=NEW.book_id FOR UPDATE;
  SELECT capacity INTO room FROM shelves WHERE id=NEW.shelf_id AND business_id=NEW.business_id AND shop_id=NEW.shop_id AND active FOR UPDATE;
  IF available IS NULL OR room IS NULL THEN RAISE EXCEPTION 'Stock or active shelf missing' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(SUM(qty),0) INTO placed FROM shelf_stock WHERE shop_id=NEW.shop_id AND book_id=NEW.book_id AND shelf_id<>NEW.shelf_id;
  SELECT COALESCE(SUM(qty),0) INTO occupied FROM shelf_stock WHERE shelf_id=NEW.shelf_id AND book_id<>NEW.book_id;
  IF placed+NEW.qty>available THEN RAISE EXCEPTION 'Placed copies exceed stock' USING ERRCODE='23514'; END IF;
  IF occupied+NEW.qty>room THEN RAISE EXCEPTION 'Shelf capacity exceeded' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shelf_stock_guard BEFORE INSERT OR UPDATE ON shelf_stock FOR EACH ROW EXECUTE FUNCTION enforce_shelf_stock();
CREATE FUNCTION enforce_stock_after_placement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock_qty < (SELECT COALESCE(SUM(qty),0) FROM shelf_stock WHERE shop_id=NEW.shop_id AND book_id=NEW.book_id) THEN
    RAISE EXCEPTION 'Stock cannot be lower than placed copies' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_stock_shelf_guard BEFORE UPDATE OF stock_qty ON shop_stock FOR EACH ROW EXECUTE FUNCTION enforce_stock_after_placement();
CREATE FUNCTION enforce_shelf_edit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occupied integer;
BEGIN
 SELECT COALESCE(SUM(qty),0) INTO occupied FROM shelf_stock WHERE shelf_id=OLD.id;
 IF TG_OP='DELETE' THEN IF occupied>0 THEN RAISE EXCEPTION 'Shelf is not empty' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF NEW.capacity<occupied OR (NOT NEW.active AND occupied>0) THEN RAISE EXCEPTION 'Shelf contains too many books' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shelf_edit_guard BEFORE UPDATE OF capacity,active OR DELETE ON shelves FOR EACH ROW EXECUTE FUNCTION enforce_shelf_edit();

INSERT INTO shelves(business_id,shop_id,aisle,rack,shelf,capacity)
SELECT DISTINCT business_id,shop_id,aisle,rack,shelf,50 FROM shop_stock
WHERE btrim(aisle)<>'' AND btrim(rack)<>'' AND btrim(shelf)<>''
ON CONFLICT(shop_id,aisle,rack,shelf) DO NOTHING;
INSERT INTO arrangement_tasks(business_id,shop_id,book_id,qty,source)
SELECT business_id,shop_id,book_id,stock_qty,'migration' FROM shop_stock WHERE stock_qty>0;
