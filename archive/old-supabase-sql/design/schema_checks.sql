-- Run only against a disposable Supabase database after installing multi_tenant_schema.sql.
-- Run as a privileged test role; everything below rolls back.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
INSERT INTO public.businesses(id,name,slug) VALUES
 ('20000000-0000-0000-0000-000000000001','Business A','schema-check-a'),
 ('20000000-0000-0000-0000-000000000002','Business B','schema-check-b');
INSERT INTO public.outlets(id,business_id,code,name) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A1','A1'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','A2','A2'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','B1','B1');
INSERT INTO public.business_memberships(business_id,user_id,role,full_name) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','Owner A'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','staff','Staff A'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','owner','Owner B');
INSERT INTO public.outlet_memberships(business_id,outlet_id,user_id) VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO public.books(id,business_id,title,price_minor) VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Book A',100),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Book B',100);
INSERT INTO public.outlet_inventory(business_id,outlet_id,book_id,stock_qty) VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',5),
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',7),
 ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002',8);
INSERT INTO public.inventory_costs(business_id,outlet_id,book_id,average_cost_minor) VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',50);
DO $$ BEGIN
 BEGIN
   INSERT INTO public.outlet_inventory(business_id,outlet_id,book_id) VALUES
    ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
   RAISE EXCEPTION 'cross-business book reference unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF has_table_privilege('anon','public.books','SELECT') OR has_table_privilege('authenticated','public.books','INSERT') THEN
   RAISE EXCEPTION 'unexpected client privileges';
 END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.outlet_inventory) <> 1 THEN RAISE EXCEPTION 'staff outlet isolation failed'; END IF;
 IF (SELECT count(*) FROM public.books) <> 1 THEN RAISE EXCEPTION 'staff business isolation failed'; END IF;
 IF (SELECT count(*) FROM public.inventory_costs) <> 0 THEN RAISE EXCEPTION 'staff can see purchase costs'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.outlet_inventory) <> 2 THEN RAISE EXCEPTION 'owner outlet visibility failed'; END IF;
 IF (SELECT count(*) FROM public.inventory_costs) <> 1 THEN RAISE EXCEPTION 'owner cost access failed'; END IF;
 IF (SELECT count(*) FROM public.books) <> 1 THEN RAISE EXCEPTION 'owner business isolation failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.outlet_inventory) <> 1 THEN RAISE EXCEPTION 'second business isolation failed'; END IF;
 IF (SELECT count(*) FROM public.inventory_costs) <> 0 THEN RAISE EXCEPTION 'cross-business cost visibility failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
