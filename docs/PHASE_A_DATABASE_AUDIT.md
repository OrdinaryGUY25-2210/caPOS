# PHASE A DATABASE AUDIT

Scope: `caPOS_Phase2A2.zip`. Static repository audit only — see §0 on live
verification. Nothing in `supabase/001`–`015` was modified, reordered,
renamed, or deleted. No migration 016 was created.

---

## 0. Live Database Verification

**LIVE DATABASE DEPLOYMENT STATE COULD NOT BE VERIFIED.**

- No real `.env.local` is present in this package — only `.env.local.example`
  (placeholder values). No Supabase URL, anon key, or service-role key was
  available to this session, and none was read, printed, or guessed.
- This sandbox's network egress does not reach `*.supabase.co` even if
  credentials had been present.
- The last on-record deployment statement (`docs/PHASE_2A1_CONSOLIDATION_REPORT.md`)
  says **001–011 were confirmed deployed by the user**, and **012–021 (all
  variants) were confirmed NOT deployed** at that time.
- That is now stale information relative to this session: separate context
  indicates caPOS has since gone live in production (Vercel + Supabase),
  which post-dates that 2A.1 confirmation. **Whether migrations 012–015 have
  since been applied to the live Supabase project is unknown and must be
  confirmed by you before any further action.** Everything below that
  depends on deployment state is written conditionally for exactly this
  reason.

---

## 1. Executive Summary

**Database health: 78/100 — NEEDS CLEANUP**

The schema itself is coherent, non-duplicated, and the 012–015 consolidation
done in Phase 2A.1 holds up under re-inspection — object-level dedup, RLS
idempotency, and dependency order are all sound. Score is held back by one
concrete function bug that survived the 2A.1 cleanup pass, plus the
deployment-state uncertainty in §0, both of which must be resolved before
Phase B.

## 2. Migration Inventory

| Migration | Purpose | Status | Risk |
|---|---|---|---|
| `schema.sql` | Clean-install baseline; cumulative snapshot of state through 011 | ACTIVE (baseline) | Low |
| 001 | `profiles.email`/`is_active` columns | ACTIVE, deployed | Low |
| 002 | Fix RLS recursion on `profiles` | ACTIVE, deployed | Low |
| 003 | `payments` table (Midtrans) | ACTIVE, deployed | Low |
| 004 | Subscription plan column | ACTIVE, deployed | Low |
| 005 | Tiers, `shifts`, analytics, first `checkout_transaction()` | ACTIVE, deployed | Low |
| 006 | Remove invite codes | ACTIVE, deployed | Low |
| 007a/007b | Manager role, `attendance`, `approval_requests` | ACTIVE, deployed | Low |
| 008 | Referral system | ACTIVE, deployed | Low |
| 009 | Stock/HPP/target, `checkout_transaction()` revision | ACTIVE, deployed | Low |
| 010 | Admin tools, `admin_special_codes` | ACTIVE, deployed | Low |
| 011 | Multi-branch, stock opname, `checkout_transaction()` revision | ACTIVE, deployed | Low |
| 012 | F&B core: units/ingredients/variants/modifiers/recipes | ACTIVE (canonical, per 2A.1) | **Deployment unconfirmed** |
| 013 | POS operations: kitchen, orders, shifts v2, `checkout_order_v2` | ACTIVE (canonical, per 2A.1) | **Deployment unconfirmed** |
| 014 | Omnichannel: purchasing/CRM/loyalty/QR/reservations, final `checkout_transaction()` | ACTIVE (canonical, per 2A.1) | **Deployment unconfirmed; contains the P1 bug in §5/§12** |
| 015 | Financial: expense categories/expenses/budgets | ACTIVE (canonical, per 2A.1) | **Deployment unconfirmed; contains the P0 bug in §5/§10/§12** |

No `migration_016`+ files exist in this package. 001–011 are internally
consistent with `schema.sql` (all forward-only `CREATE TABLE IF NOT EXISTS`,
confirmed by inspection — see §9).

## 3. Table Inventory (abridged — full set is large; flagged rows only)

| Table | Source | Tenant | Branch | RLS | Status |
|---|---|---|---|---|---|
| `profiles`, `tenants`, `products`, `transactions`, `transaction_items`, `payments`, `memberships`, `shifts`, `attendance`, `approval_requests`, `referrals`, `referral_redemptions` | schema.sql / 001–011 | ✓ | partial (branch added in 011) | ✓ | ACTIVE |
| `branches`, `branch_stock`, `stock_opname_logs` | 011 | ✓ | ✓ (defines it) | ✓ | ACTIVE |
| `units`, `ingredients`, `branch_ingredients_stock`, `product_variants`, `modifier_groups`, `modifiers`, `recipes`, `recipe_items`, `recipe_consumption_logs` | 012 | ✓ | ✓ | ✓ | ACTIVE |
| `orders`, `order_items`, `order_item_modifiers`, `kitchen_stations`, `cash_movements`, `branch_tables`, `reservations`, `audit_log`, `refunds` | 013 | ✓ | ✓ | ✓ | ACTIVE |
| `suppliers`, `purchase_orders`, `customers`, `loyalty_config`, `promotions`, `vouchers`, `qr_orders`, `channel_pricings` | 014 | ✓ | ✓ | ✓ | ACTIVE |
| `expense_categories`, `expenses`, `budgets` | 015 | ✓ | ✓ (nullable — business-wide allowed by design) | ✓ | ACTIVE |

No table name is defined by `CREATE TABLE` (unguarded) in more than one
migration file. Every apparent "repeat" (`payments`, `shifts`, `attendance`,
`approval_requests`, `referrals`, `referral_redemptions` all appear in both
`schema.sql` and a numbered migration) is `CREATE TABLE IF NOT EXISTS` in the
numbered migration — i.e. `schema.sql` is a cumulative fresh-install
snapshot, the numbered files are the incremental path. This is the expected,
correct pattern, not duplication. No DUPLICATE/CONFLICT/UNUSED tables found.

## 4. RPC / Function Inventory (high-priority functions only)

| Function | Canonical source | Called by | Security | Status |
|---|---|---|---|---|
| `checkout_transaction()` | Evolving `CREATE OR REPLACE` across 005 → 009 → 011 → 014; **014 is the live-order canonical body** | `app/pos/page.tsx` ("Bayar Langsung" quick-sale path) | `SECURITY DEFINER`, `search_path` locked | ACTIVE, correct |
| `checkout_order_v2()` | Defined/finalized in 013 | `components/MultiPaymentModal.tsx`, `components/pos/SplitBillModal.tsx` | `SECURITY DEFINER` | ACTIVE, correct |
| `create_kitchen_order()` | 013 (final, post-2A.1 fix; earlier duplicate/regression already resolved — see §10) | `SendToKitchenModal` | `SECURITY DEFINER` | ACTIVE, correct |
| `deduct_recipe_stock_for_transaction()` / `deduct_recipe_stock()` | 012 | Called internally by `checkout_transaction()` / `checkout_order_v2()` | `SECURITY DEFINER` | ACTIVE, correct |
| `generate_recurring_expenses()` | 015 | Not currently called from any app code (server-only function) | `SECURITY DEFINER` | **BROKEN — see §5/§12, P0** |

`checkout_transaction()` being redefined across four migrations is expected
evolutionary history, not accidental duplication — each `CREATE OR REPLACE`
fully supersedes the last when migrations run in order, and 014's body is
confirmed the only one that survives to the live schema.

**Real design finding (not a bug, but worth surfacing):** `app/pos/page.tsx`
explicitly runs two parallel checkout paths by design (its own comment says
so): a direct "Bayar Langsung" sale via `checkout_transaction()`, and a
kitchen/table-order path via `create_kitchen_order()` → `checkout_order_v2()`.
Both correctly call recipe-stock deduction. Neither supports variant/modifier
pricing — that gap is pre-existing and already correctly scoped in
`docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md` (see §11).

## 5. Role Audit

Enum is `user_role AS ENUM ('super_admin', 'owner', 'manager', 'cashier')` —
**there is no `'admin'` value.**

Repository-wide, four historical `role IN ('owner', 'admin')` predicates in
migration_015 were already corrected in the Phase 2A.1 pass to
`role IN ('owner', 'super_admin')`, each marked with a `-- BUG FIX (Phase
2A.1 audit)` comment. Re-checking the file line by line found **one instance
the 2A.1 fix pass missed**:

- `migration_015_capos_phase5_financial_intelligence_final.sql:277`, inside
  `generate_recurring_expenses()`:
  ```sql
  WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner', 'admin')
  ```
  This is not merely an authorization bug (letting the wrong role in) — it's
  a **hard runtime failure**. Postgres must cast `'admin'` to `user_role` to
  evaluate the `IN` list, and `'admin'` isn't a member of that enum, so the
  cast raises `invalid input value for enum user_role: "admin"` every time
  this function is invoked, for every role including `owner`. The function
  cannot currently succeed for anyone. See §12 for priority.

All other role references found in the codebase (UI copy, comments) are
harmless labels, not SQL predicates, and are not reported as bugs.

## 6. RLS Audit

| Scope | SELECT | INSERT | UPDATE | DELETE | Verdict |
|---|---|---|---|---|---|
| 001–011 tables | policy present | policy present | policy present | n/a (soft-delete pattern) | SAFE |
| 012 (F&B core) | policy present | policy present | policy present | n/a | SAFE |
| 013 (orders/kitchen) | policy present | policy present | policy present | n/a | SAFE |
| 014 (purchasing/CRM/loyalty) | policy present | policy present | policy present | n/a | SAFE |
| 015 (expenses/budgets) | policy present | policy present | policy present | n/a | SAFE |

Idempotency re-check: counted every `CREATE POLICY` against every
`DROP POLICY IF EXISTS` per file. 012/013/014 have equal-or-more drop guards
than creates (some drops retire renamed policies), and 015 is an exact 7/7
match. This confirms the 2A.1 report's claim that the idempotency gap found
in that pass was fully closed — re-running 012–015 on a fresh instance
should not hit "policy already exists." Not independently re-executed
against a live/disposable Postgres in this session (see §9).

## 7. Tenant Isolation

**PASS (structural).** Every tenant-scoped table carries `tenant_id NOT
NULL`, and every RLS policy inspected filters through `tenant_id` (directly,
or via a join to a table that does). No table was found with RLS enabled
but a permissive `USING (true)` policy, and no tenant-scoped table was found
with RLS disabled. Not independently re-verified with a live cross-tenant
query in this session (2A.1 previously ran that test live and reported
0-row cross-tenant leakage — not re-run here since no live DB is connected).

## 8. Branch Isolation

**PASS (structural).** `branch_id` is present and RLS-checked on every
branch-scoped table (`branch_ingredients_stock`, `orders`, `branch_tables`,
`kitchen_stations`, `expenses`, etc.). Business-wide records (e.g. an
expense with no branch) correctly use a nullable `branch_id` rather than a
sentinel value. Frontend branch filtering exists in addition to, not
instead of, these RLS policies.

## 9. Schema ↔ Application Contract

- `npx tsc --noEmit`: **0 errors.**
- `npx next lint`: **0 new warnings** — only the same pre-existing warnings
  already known from Phase 2A.2 (missing `useEffect` deps in 2 files,
  `<img>` vs `next/image` in 5 files).
- `npm run build`: **succeeds**, all 54 routes compile and generate.
- These are **STATIC VERIFIED**, not RUNTIME VERIFIED — no live Supabase
  project was queried, so RPC parameter/column matching was checked by
  reading the SQL and TypeScript side by side, not by executing calls.
- No mismatch found between `lib/types.ts` interfaces and the migration
  column definitions for the tables spot-checked (`expenses`, `orders`,
  `transaction_items`, `products`).

## 10. Migration 015 Findings (the 015 ↔ 018 identity issue)

`migration_015_capos_phase5_financial_intelligence_final.sql` opens with an
explicit inline comment: `>>> BERASAL DARI: migration_018_expenses_budgets.sql`.
This is **historical provenance, not duplicate-execution risk**. Per
`docs/PHASE_2A1_CONSOLIDATION_REPORT.md`, the original standalone
`migration_018_expenses_budgets.sql` file was deleted as part of that
consolidation after its content was confirmed fully absorbed into what is
now migration_014/015. There is only one file on disk that creates
`expenses`/`expense_categories`/`budgets` — no double-creation risk exists
today. The comment is a leftover authorship trail and is cosmetic; it does
not need to be removed for correctness, though it may read as confusing to
a future developer unfamiliar with the 2A.1 history.

## 11. Variant / Modifier / Recipe Findings

Unchanged from `docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md`, re-confirmed by
tracing both live checkout paths in this session:

- `product_variants` / `modifier_groups` / `modifier_options` master data
  exists and is manageable (`/dashboard/variants`, `/dashboard/modifiers`).
- Neither `checkout_transaction()` nor `checkout_order_v2()` accepts a
  `variant_id` or modifier selection in `p_items` — both only take
  `product_id` + `qty`. `transaction_items` has no column to record a
  selected variant/modifier or its price delta.
- `SendToKitchenModal` carries variant info only as a free-text
  `variant_notes` string for the kitchen ticket — unpriced, unvalidated,
  and dropped before it reaches `transaction_items`.
- This is correctly classified as **Case D (genuine new database
  requirement)** in the existing proposal, and correctly deferred: it's a
  transaction-recording schema change, not something the existing schema
  already supports. **This belongs to Phase B**, not Phase A — it doesn't
  block database stabilization, it blocks a specific future POS feature.

## 12. Critical Findings

- **P0** — `generate_recurring_expenses()` (migration 015, line 277) will
  raise a Postgres enum-cast error on every invocation, for every role. This
  is a straggler from the same bug class the 2A.1 pass already fixed four
  other instances of, in the same file. Recurring-expense generation is
  currently non-functional wherever this migration set is deployed.
- **P1** — Deployment state of 012–015 is unconfirmed against the live
  production Supabase project (§0). This blocks a confident answer to "is
  the P0 bug above already live," which changes whether the fix is a
  same-file edit (not yet deployed) or requires a separate approved patch
  migration (already deployed).
- **P2** — Variant/modifier pricing gap at POS (§11) — real, but Phase B
  scope, not a stabilization blocker.
- **P3** — Stale migration-number references (019/020) in a few code
  comments (`app/api/tables/merge/route.ts`, `app/api/orders/deduct-stock/route.ts`,
  `components/order/SelfOrderClient.tsx`, `lib/useProductAvailabilityChannel.ts`)
  and in `docs/PHASE3_IMPLEMENTATION_GUIDE.md` / `PHASE3_SUMMARY.md` /
  `README_PHASE4.md` — cosmetic, comment-only, no functional effect.

## 13. Recommended Actions

**P0 — `generate_recurring_expenses()` enum bug**
- Why it matters: function cannot run at all today for any caller.
- Recommended fix: change `role IN ('owner', 'admin')` to
  `role IN ('owner', 'super_admin')`, matching the fix already applied to
  the other four occurrences in the same file.
- Migration required: **conditional on §0.** If 012–015 are confirmed NOT
  yet deployed, this is a direct edit to the existing (still-undeployed)
  migration_015 — not a rewrite of deployed history, just finishing an
  incomplete draft, and needs your explicit go-ahead since Rule 3 froze
  001–015 for this audit. If 012–015 ARE confirmed already deployed, this
  requires a `migration_016_fix_generate_recurring_expenses_role_patch.sql`
  headed `-- NON-CANONICAL PATCH — REQUIRES APPROVAL`, per Rule 4.
- Risk: very low either way — one literal value, one line, fully additive
  in effect (fixes a currently-total failure, can't make it worse).
- Priority: P0.

**P1 — confirm live deployment state of 012–015**
- Why it matters: gates the fix path above and gates whether Phase B can
  safely assume 012–015 are live.
- Recommended action: check the live Supabase project's migration history /
  information_schema directly (or confirm from memory of when it was
  applied), then tell me which of the two paths above to take.
- Migration required: no — this is a verification step, not a schema
  change.
- Risk: none (read-only check).
- Priority: P1.

**P2 — variant/modifier pricing at POS**
- Already fully specified in `docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md`. No
  action needed from Phase A; carry forward to Phase B planning.

**P3 — stale migration-number comments**
- Cosmetic only. Safe to defer indefinitely or clean up opportunistically
  during unrelated edits to those files.

---

## FINAL DECISION

**OPTION 2 — DATABASE CLEANUP REQUIRED.**

No new migration is being created automatically. One genuine, narrow bug
(§5/§12, P0) exists in the current canonical migration_015 and should be
fixed — but the *mechanism* for fixing it (direct edit vs. approved patch
migration_016) depends entirely on the unresolved deployment-state question
in §0/P1, which only you can answer from the live Supabase project.
Migration 016 is **not** being proposed here merely because a bug was found
— per Rule 4, it's justified only if 012–015 are confirmed already deployed,
which is not yet established.

Nothing else in this audit rises to a database-change requirement for
Phase A. The variant/modifier gap is real but is Phase B work.

---

Repository audit complete.
Live database state: **NOT VERIFIED**

DATABASE HEALTH: 78%
CRITICAL ISSUES: 1
P1 ISSUES: 1
P2 ISSUES: 1
MIGRATION REQUIRED: YES (conditional — see P0 above)
MIGRATION 016: NOT APPROVED (pending deployment-state confirmation)
LIVE SUPABASE VERIFIED: NO
RECOMMENDED NEXT PHASE: Resolve P0/P1 above first (single-line role fix,
applied via whichever mechanism §0 resolves to), then proceed to Phase B
with the variant/modifier/recipe work as the first item.
