# Multi-business database design — local proposal

`multi_tenant_schema.sql` is a **fresh-database design**, not a migration or an instruction to execute SQL on the deployed project. It is deliberately outside `supabase/migrations`. The existing `master_schema.sql`, current SQLite app, and deployed database remain unchanged. Do not apply the new file over the old public tables. The old schema grants anonymous access and is not an authorization model to copy.

## Scope and model

- A business is an independent bookshop owner or chain (the vendor/tenant). A supplier is a wholesaler belonging to that business. A business may have zero, one or many outlets; there is no minimum-two-outlets rule. An active business may have at most one active headquarters.
- Supabase Auth identifies people. Memberships attach one person to one or more businesses. Owners can see all their business's outlets; staff can see only assigned outlets. Membership status is checked from the database, not user-editable JWT metadata.
- Each business owns its book catalogue and supplier records. An ISBN is unique within a business, not globally. Stock, reservations, location and weighted-average cost belong to a particular outlet. Cost is separated into owner-only tables; the same applies to historical sale item cost.
- Sales, returns, phone orders, payments, purchase orders, receipts, stock movements and expenses carry business and (where applicable) outlet identifiers. Composite foreign keys reject references to a different business or outlet. Business-wide expenses may have a null outlet. Amounts use `bigint` minor units; timestamps use `timestamptz` and business dates use `date`.
- Each sale and phone order retains the price, tax and discount at the time of the transaction. Returns identify their original sale item and, for exchanges, the replacement book. Sale and receipt idempotency keys are unique within a business, and a phone order can be linked to at most one sale.
- RLS protects every proposed public table. Anonymous access and client mutations are denied. Authenticated reads are limited by active membership, outlet assignment and owner role. Internal policy helpers are in an unexposed schema, have fixed search paths, check `auth.uid()`, and expose only boolean membership checks.

## Deliberately unfinished before integration

This file defines storage and read access, **not** a working replacement backend. It does not provide signup, membership administration, or write operations. A future trusted backend or carefully designed transactional database functions must authenticate every request and enforce membership and outlet permission before using a privileged connection. A service-role key bypasses RLS and must never reach the browser. Grant only the minimum privileges to the eventual backend role.

Implement atomic transactions with row locks and tests for: sale and stock deduction; retries scoped by business; order reservation, cancellation and fulfilment; partial purchasing receipts and weighted-average cost; refunds and exchanges (including cumulative returned quantity, tax/discount allocation, void-after-return and replacement stock); and stock movement recording. Constraints alone do not enforce these cross-row rules. Decide how to handle currency changes, tax/refund rounding, accounting period adjustments, owner succession, and historical snapshots before enabling writes. Add audit/retention and backup procedures appropriate to the deployment.

## Migration planning

1. Inventory all SQLite and existing Supabase records, and back them up. Resolve ownership of records with missing business/outlet IDs and duplicated catalogues; do not silently assign them to a real outlet. Create mapping tables for old integer/text IDs to new UUIDs. Preserve bill numbers, historical prices/costs, payment history, returns and inventory movements.
2. Reconcile book-level SQLite stock against actual outlet counts. Existing shared stock cannot establish which branch owns it. Verify opening balances and reservations with the owner before importing.
3. Provision Auth identities and business/outlet memberships through a trusted onboarding process. The current username/bcrypt sessions are not Supabase Auth sessions; plan a password-reset or other secure identity transition, and do not copy session tokens.
4. Build and test a separate import into a **fresh isolated Supabase project/local stack**. Reconcile counts and monetary totals per business/outlet, including voids and refunds. Test RLS with at least two businesses, multiple outlets, owner, assigned/unassigned staff and anonymous users. Exercise every transactional workflow and concurrency case. Run database advisors and query-plan checks.
5. Only once the application supports the new schema and the import is verified, plan a maintenance window, final backup, repeatable migration, reconciliation, rollback and cutover. This proposal does not deploy or migrate anything.

## Local verification

On a disposable local Supabase database only, apply the schema and run `schema_checks.sql` with `psql -v ON_ERROR_STOP=1`. The test uses a transaction and rolls back fixtures. It checks representative isolation, permissions and tenant-consistent foreign keys; it is not a substitute for testing all future application transactions. Follow [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API security guidance](https://supabase.com/docs/guides/api/securing-your-api) when integrating.
