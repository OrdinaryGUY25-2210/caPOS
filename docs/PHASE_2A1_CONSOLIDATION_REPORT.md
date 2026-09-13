# Phase 2A.1 — Migration Consolidation + Cleanup + Verification Report

## A. Database Deployment Status

- **001–011: DEPLOYED** (confirmed by user — live database has migrations 1–11 applied).
- **012–021 (all prior variants): NOT DEPLOYED.** Nothing beyond 011 has ever
  been applied to a real database. This meant the full 012–015 migration
  history could be safely rewritten with zero production risk.

## Starting state (what was actually in the repo, not what Phase 2A.1 assumed)

The repo did **not** match the assumed clean `001–015` + `016–021` structure.
Instead, `supabase/` had **duplicate migration numbers**:

- Two `migration_012_*` files, two `migration_013_*`, two `migration_014_*`
- A standalone `migration_015_phase2_table_foundation.sql`
- `migration_016` through `migration_021` (021 marked `DRAFT`)

The "GABUNGAN" (merged) `012/013/014` files were an earlier, undocumented
consolidation attempt (Sep 7, mid-way through authoring) that folded in
content through old migration_018, but **never absorbed 019, 020, or 021**
(those were written afterward). This was confirmed by diffing every
`CREATE TABLE/FUNCTION/VIEW/TRIGGER/INDEX` object between the old individual
files and the GABUNGAN files — the GABUNGAN files are true supersets of
old 012–018.

## B. What Phase 2A.1 did

1. Audited every object in every migration variant (016–021 plus both
   012/013/014 lineages) individually.
2. Used the GABUNGAN files as the base (documented superset of old
   012–018), folded in 019 and 020 on top.
3. Re-split all resulting SQL into four domain-pure canonical files
   matching the target architecture:
   - `migration_012_capos_phase1_fnb_core.sql` — units, ingredients,
     branch ingredient stock, variants, modifiers, recipes, recipe items,
     recipe costing/consumption engine (`deduct_recipe_stock`,
     `deduct_recipe_stock_for_transaction`), ingredient availability,
     hard-delete guards, realtime menu availability.
   - `migration_013_capos_phase2_pos_operations.sql` — kitchen stations,
     orders/order_items, shifts, cash movements, checkout engine
     (`checkout_order_v2`, `create_kitchen_order`), table foundation,
     void/cancel/refund, supervisor PIN authorization, stock reversal,
     split bill.
   - `migration_014_capos_phase3_business_omnichannel.sql` — purchasing/
     suppliers, CRM, loyalty, promotions, vouchers, QR self-order,
     reservations, channel pricing, omnichannel/growth analytics,
     checkout-transaction loyalty wiring.
   - `migration_015_capos_phase5_financial_intelligence_final.sql` —
     expense categories, expenses, budgets, budget-vs-actual reporting.
4. Verified the full chain (`schema.sql` → 001–011 → 012–015) against a
   disposable local Postgres seeded to match the real live database state
   (001–011 only). Iteratively fixed every ordering/forward-reference
   issue found until all four files load with zero errors.
5. Ran a full functional E2E test (seed data → `create_kitchen_order` →
   `checkout_order_v2` → recipe stock deduction → retry) and an RLS
   tenant-isolation test directly against the consolidated schema.
6. Verified idempotency: re-running 012–015 a second time on top of
   themselves succeeds with no errors.
7. Ran `npx tsc --noEmit`, `npm run lint`, and `npm run build` against the
   application code — all pass.

## C–H. Per-migration disposition

| Source | Disposition |
|---|---|
| old `migration_012_phase2_kitchen_shift_cash.sql` | REMOVED — superseded by GABUNGAN-012, content preserved |
| GABUNGAN `migration_012_phase2_shift_purchasing_qr_growth.sql` | REMOVED as a file — content re-split across the new 012/013/014 |
| old `migration_013_phase3_purchasing_crm_promosi_analitik.sql` | REMOVED — superseded, content preserved |
| GABUNGAN `migration_013_table_foundation_void_refund.sql` | REMOVED as a file — content re-split, mostly into new 013 |
| old `migration_014_phase4_qr_reservasi_multichannel_growth.sql` | REMOVED — superseded, content preserved |
| GABUNGAN `migration_014_loyalty_fnb_core_expenses_deduction.sql` | REMOVED as a file — content re-split across new 012/013/014/015 |
| `migration_015_phase2_table_foundation.sql` | REMOVED — confirmed pure duplicate of content already inside GABUNGAN-013; this was also the root cause of the `create_kitchen_order` regression (see below) |
| `migration_016_phase2_void_refund.sql` | REMOVED — confirmed fully absorbed into GABUNGAN-013 (object-level diff, zero missing) |
| `migration_017_checkout_loyalty_promo_voucher.sql` | REMOVED — confirmed fully absorbed into GABUNGAN-014 |
| `migration_018_expenses_budgets.sql` | REMOVED — confirmed fully absorbed into GABUNGAN-014 |
| `migration_019_pin_stockreversal_tables_splitbill.sql` | REMOVED as a file — content folded into new 013 (mostly) after fixing two real bugs found in it (see below) |
| `migration_020_realtime_menu_availability.sql` | REMOVED as a file — content folded into new 012/014 |
| `migration_021_DRAFT_fix_create_kitchen_order_regression.sql` | **OBSOLETE, confirmed, not a guess.** Root cause: the standalone `migration_015` (removed above) redefined `create_kitchen_order()` with an old, incomplete (pre-recipe) body *after* the correct complete version. Removing that duplicate file removes the bad redefinition entirely, so the complete version is naturally the only one left. Verified directly: the final consolidated `create_kitchen_order()` includes full variant/recipe resolution. |

## Real bugs found and fixed (all pre-existing, reproduced from the original untouched source files)

1. **`create_kitchen_order()` regression** — see 021 disposition above.
2. **`checkout_order_v2()` silently dropped recipe-stock deduction.**
   Migration 019's rewrite of this function was based on the *pre-014*
   version and omitted the `PERFORM deduct_recipe_stock(p_order_id)` call
   that 014 had added. Fixed by merging 019's split-bill/manual-discount
   logic with 014's deduction wiring. Verified live: a 2× order correctly
   deducted `2×18g` ingredient A and `2×120ml` ingredient B.
3. **`table_live_status` view — invalid SQL.** Mixed `SUM()` with an
   un-grouped `ORDER BY`, which Postgres rejects outright. Rewritten as a
   correlated subquery scoped to the single most recent active order.
4. **`product_profitability` view — referenced schema that never
   existed.** Joined to a `product_categories` table that was never
   created anywhere in the codebase, and referenced `product_name`/
   `category_id` columns that don't exist on `products` (the real columns
   are `name`/`category`). Also never exposed `branch_id`, even though
   `app/actions/purchasing-loyalty-actions.ts` filters on it. Rewritten
   against the real schema, with `branch_id` recovered via a join through
   `orders`.
5. **`peak_hours_analytics` view — same `branch_id` mistake**, plus an
   incompatible column-type change against the base view already created
   by `migration_005`, and a column rename (`total_orders` →
   `transaction_count`) that would have broken `app/dashboard/page.tsx`,
   which reads `total_orders` by name. Fixed: joined through `orders` for
   `branch_id`, kept the `total_orders` name, explicit `DROP VIEW` before
   recreate (required since `CREATE OR REPLACE VIEW` cannot change an
   existing column's type).
6. **Five RLS policies checked `role IN ('owner', 'admin')`.** `'admin'`
   is not a valid `user_role` enum value — the real enum is
   `super_admin/owner/manager/cashier`. The migration's own comment
   flagged this exact assumption as unverified
   ("*ASUMSI YANG PERLU DIVERIFIKASI... role... 'owner' | 'admin' | ...*").
   Fixed to `role IN ('owner', 'super_admin')`, the real top-authority
   roles.
7. **`deduct_recipe_stock()` — ambiguous column reference, found only by
   actually executing the function.** Its own
   `RETURNS TABLE(order_item_id uuid, ...)` output signature creates an
   implicit PL/pgSQL variable named `order_item_id`, which collided with
   the real `order_item_modifiers.order_item_id` column inside the
   function body. This is invisible to static SQL review and to
   `check_function_bodies` validation — it only surfaces when the
   function actually runs. Found via the live E2E checkout test and fixed
   by qualifying the column reference.

## Migration-file idempotency gap (found via re-run test, fixed)

Two `CREATE POLICY` statements (`rls_suppliers` family, `expense_categories_select`)
were not guarded with `DROP POLICY IF EXISTS`, unlike the rest of the
codebase's consistent pattern. Re-running 012–015 a second time failed on
"policy already exists." Fixed with an automated pass that adds the missing
guard to every `CREATE POLICY` statement that didn't already have one.
Verified: 012–015 now re-apply cleanly on top of themselves.

## I. Files removed

- `supabase/migration_012_phase2_kitchen_shift_cash.sql`
- `supabase/migration_012_phase2_shift_purchasing_qr_growth.sql`
- `supabase/migration_013_phase3_purchasing_crm_promosi_analitik.sql`
- `supabase/migration_013_table_foundation_void_refund.sql`
- `supabase/migration_014_loyalty_fnb_core_expenses_deduction.sql`
- `supabase/migration_014_phase4_qr_reservasi_multichannel_growth.sql`
- `supabase/migration_015_phase2_table_foundation.sql`
- `supabase/migration_016_phase2_void_refund.sql`
- `supabase/migration_017_checkout_loyalty_promo_voucher.sql`
- `supabase/migration_018_expenses_budgets.sql`
- `supabase/migration_019_pin_stockreversal_tables_splitbill.sql`
- `supabase/migration_020_realtime_menu_availability.sql`
- `supabase/migration_021_DRAFT_fix_create_kitchen_order_regression.sql`
- `docs/MIGRATION_019_NOTES.md` (confirmed unused — no code references, only documented a now-removed file)

## J. Files added/modified

- Added: `supabase/migration_012_capos_phase1_fnb_core.sql`
- Added: `supabase/migration_013_capos_phase2_pos_operations.sql`
- Added: `supabase/migration_014_capos_phase3_business_omnichannel.sql`
- Added: `supabase/migration_015_capos_phase5_financial_intelligence_final.sql`
- Modified: `docs/CATATAN_PENGGABUNGAN.md` — marked superseded with a
  pointer to this report (kept as historical record, not deleted, since
  it documents real design decisions from the first merge pass).
- Added: `docs/PHASE_2A1_CONSOLIDATION_REPORT.md` (this file)

## K. Files/modules intentionally left untouched

- `supabase/migration_001` through `migration_011` — unchanged, matches live DB.
- `supabase/schema.sql`, `supabase/reset_all.sql` — no changes needed.
- `app/dashboard/menu/page.tsx` — verified this is the master product
  catalog CRUD page (manages the `products` table). There is no separate
  `/dashboard/products` page anywhere in the codebase, so there was no
  genuine duplication to resolve. Left untouched.
- All Phase 2A F&B UI pages (`/dashboard/ingredients`, `/dashboard/variants`,
  `/dashboard/modifiers`, `/dashboard/recipes`) — untouched, build clean.
- Midtrans payment integration (`app/api/midtrans/*`) — untouched, verified
  it validates the SHA-512 webhook signature server-side before trusting
  any payment status (not client-trusted).
- `docs/PHASE3_IMPLEMENTATION_GUIDE.md`, `docs/PHASE3_SUMMARY.md`,
  `docs/README_PHASE4.md` — left as-is (historical/contextual docs, not
  blocking; may contain stale migration-number references — see Remaining
  Gaps).

## L. E2E test results

| Test | Result | Evidence |
|---|---|---|
| Fresh load (schema → 001–011 → 012–015) | **PASS** | Zero errors against disposable Postgres seeded to match live DB (001-011 only) |
| Idempotent re-run of 012–015 | **PASS** | Second run on top of itself succeeds with zero errors |
| Recipe COGS / stock deduction | **PASS** | Live call: 2× product order deducted exactly 36g + 240ml per recipe math; `recipe_consumption_logs` shows 2 correct audit rows |
| Idempotency (checkout retry) | **PASS** | Re-invoking `deduct_recipe_stock` on the same order returned `ALREADY_DEDUCTED`, stock unchanged, log count stayed at 2 |
| POS (kitchen order → checkout) | **PASS** | `create_kitchen_order` → `checkout_order_v2` end-to-end via live function calls |
| Shift / Cash | **PASS (structural)** | `open_shift_v2`, `record_cash_movement`, `close_shift` confirmed present with server-computed `expected_cash`/`actual_cash`/`difference` return signature — expected cash is not client-supplied. Not exercised through the full UI in this environment. |
| Payment / Webhook | **PASS (code review)** | Confirmed `app/api/midtrans/notification/route.ts` validates the SHA-512 `signature_key` against `MIDTRANS_SERVER_KEY` before trusting `transaction_status`; untouched by this consolidation. Not exercised against a real Midtrans sandbox. |
| Security / RLS | **PASS** | Live cross-tenant test: authenticated as a second tenant's owner, queries against `ingredients` and `branch_ingredients_stock` for the first tenant returned **0 rows**; a cross-tenant write attempt did not alter the target tenant's data. |
| F&B Master Data UI (ingredients/variants/modifiers/recipes) | **PASS (build-level)** | All four pages compile and are present in the production build output; not exercised through the browser in this environment. |

## M. Build results

- **ESLint:** PASS — only pre-existing warnings unrelated to this work (missing `useEffect` deps in 2 files, `<img>` vs `next/image` suggestions in 5 files).
- **TypeScript (`npx tsc --noEmit`):** PASS — zero errors.
- **Production build (`npm run build`):** PASS — compiles and generates all 54 pages successfully (requires real `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` env vars to prerender `/kitchen`; confirmed with placeholder values, not a code defect).

## N. Remaining gaps (not hidden)

- Shift/cash and payment/webhook were verified structurally and via code
  review, not through the actual running Next.js app against a live
  Supabase project or Midtrans sandbox — that wasn't available in this
  environment.
- F&B Master Data UI pages were verified at the build level, not through
  interactive browser testing.
- A handful of code comments elsewhere in the app (`app/api/tables/merge/route.ts`,
  `app/api/orders/deduct-stock/route.ts`, `components/order/SelfOrderClient.tsx`,
  `lib/useProductAvailabilityChannel.ts`) reference old migration numbers
  (019/020) in documentation comments only, not imports. Harmless but now
  slightly stale — not updated as part of this pass.
- `docs/PHASE3_IMPLEMENTATION_GUIDE.md`, `docs/PHASE3_SUMMARY.md`,
  `docs/README_PHASE4.md` were not audited for staleness against the new
  migration structure.
- This consolidation has **not** been run against a real Supabase project
  (only a disposable local Postgres with a hand-built shim for `auth.*`,
  roles, and `supabase_realtime`). Before deploying to the real project,
  run it once against a staging Supabase project first.
