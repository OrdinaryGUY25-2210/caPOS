# Phase 2A.2 — Database Change Proposal (Case D)

Status: **proposal only — not executed.** Per Rule 4, this stops before any
SQL is applied and waits for an explicit decision.

## Exact problem

The cashier-facing POS (`/pos`) is the highest-priority UI in the Phase 2A.2
brief, and §11 asks for a visibly connected Product → Variant → Modifier →
Recipe → Ingredient flow. Master data for variants and modifiers already
exists and is manageable at `/dashboard/variants` and `/dashboard/modifiers`
(Phase 2A). But tracing the actual sales path shows they are **never used at
the point of sale**:

- `app/pos/page.tsx` queries only the `products` table (`.from("products")`)
  — never `product_variants`, never `modifier_groups`/`modifier_options`.
- `checkout_transaction()`, the canonical RPC used to record a paid sale
  (`supabase/schema.sql`, and its history across migrations 005/009/011/014),
  accepts `p_items JSONB` shaped strictly as `[{ "product_id": ..., "qty":
  ... }]`. There is no `variant_id`, no `modifier_ids`, and no per-item price
  adjustment field anywhere in its body.
- The one place an order *can* carry free-text variant info is
  `SendToKitchenModal` → `create_kitchen_order()`, which stores a plain
  `variant_notes` string per item (e.g. "Oat Milk, Less Sugar") for the
  kitchen ticket. That string is never priced, never validated against
  `product_variants`/`modifier_options`, and is dropped once the order is
  later paid through `checkout_transaction()` / `checkout_order_v2` — it
  never reaches `transaction_items`.

## Why existing schema cannot solve it (why this isn't Case A/B/C)

The variant/modifier **master data** schema is sufficient (Case A) — the
gap is entirely in the **transaction-recording** path. Building a variant/
modifier picker in the POS UI without a matching backend change would do
one of two things, both bad:
1. Silently do nothing to price, stock deduction, or the recorded sale
   (the picker would be decorative), or
2. Get bolted onto the existing free-text `variant_notes` field, which
   cannot carry a price delta, cannot be validated, and cannot drive
   ingredient-level stock deduction for the modifier's own recipe impact.

Either way this fails §31 ("no fake data / no functionality that only looks
real") and §33 ("existing business logic is sacred — checkout/stock
deduction not to be touched without isolation and testing"). A real fix
requires `checkout_transaction()` itself to understand variant pricing and
modifier surcharges, which is a genuine schema/function change — Case D.

## Affected objects

- Function: `checkout_transaction()` (canonical body in `supabase/schema.sql`,
  duplicated historically across migrations 005, 009, 011, 014 — see
  "consolidation" note below).
- Table: `transaction_items` (currently `transaction_id, product_id, qty,
  subtotal` only — no columns to record which variant/modifiers were
  selected).
- Indirectly: `create_kitchen_order()` / `order_items`, if kitchen tickets
  should also carry structured (not free-text) variant/modifier selections
  for consistency with what gets billed.

## Proposed change (sketch — needs review before any SQL is written for real)

1. `transaction_items`: add nullable `variant_id UUID REFERENCES
   product_variants(id)` and a `modifier_selections JSONB` column (snapshot
   of chosen modifier option ids + their price deltas at sale time, the same
   snapshot pattern already used elsewhere in this schema for price-in-time
   integrity).
2. `checkout_transaction()`: extend the expected shape of each element in
   `p_items` to optionally include `variant_id` and `modifier_option_ids`;
   when present, look up `product_variants.price`/`cost_price` in place of
   the base product price, and sum `modifier_options` price deltas into the
   line subtotal; write both onto the new `transaction_items` columns.
3. Stock/recipe consumption: confirm whether recipe consumption already
   keys off `product_id` alone or already supports `variant_id` (needs
   inspection of the recipe-consumption trigger/function before finalizing
   the SQL — not yet done, flagged as an open question below).

## Reason the change is required

Without it, any POS-side variant/modifier picker is cosmetic — it cannot
correctly price the sale, cannot correctly deduct the modifier's own
ingredient impact, and cannot be reflected in COGS reporting. This directly
blocks a correctly-functioning version of §10 step 3–4 and all of §11.

## Security implications

None beyond the existing `checkout_transaction()` surface — it is already
`SECURITY DEFINER` and already validates tenant membership before writing.
Adding fields to its JSONB input does not change that boundary, provided
each looked-up `variant_id`/`modifier_option_id` is re-validated server-side
against the same `tenant_id` (must not trust client-supplied prices).

## RLS implications

New columns on `transaction_items` inherit that table's existing RLS
policies (tenant/branch scoping) automatically — no new policy needed. New
FK to `product_variants(id)` needs no RLS since it's read via the
`SECURITY DEFINER` function, not directly by the client.

## Performance implications

Negligible — one additional lookup join per line item inside a function
that already loops per item; no new indexes strictly required, though
`product_variants(id)` and `modifier_options(id)` are already primary-keyed.

## Backward compatibility

Fully additive and backward compatible: `variant_id` and
`modifier_selections` are nullable; existing calls that omit them behave
exactly as today (base product price, no modifier surcharge). No existing
row or call site breaks.

## Can this be consolidated into an existing canonical migration?

Depends entirely on deployment state (see next section). If 012–015 have
**not** been deployed yet, this belongs in migration 012 (F&B Core, since
variants/modifiers/recipes are defined there) alongside a `CREATE OR REPLACE
FUNCTION checkout_transaction(...)` update. If 012–015 **have** already been
deployed, per Rule 5 this must NOT rewrite migration history — it needs a
separate, clearly labeled patch.

## Whether 012–015 have already been deployed

**Not determined in this session** — this sandbox has no connected Supabase
project to query. This must be confirmed by whoever owns the live database
before proceeding with either path above.

## Exact SQL required

**Not written.** Per Rule 4, SQL is only drafted once the deployment-state
question above is answered and the recipe-consumption question in step 3 is
resolved — writing exact SQL before that would risk shipping a migration
that either duplicates canonical migration 012 (if undeployed) or corrupts
an already-applied one (if deployed).

## Rollback strategy (once SQL exists)

Additive nullable columns and a backward-compatible function replacement
are trivially rollback-safe: `ALTER TABLE transaction_items DROP COLUMN IF
EXISTS variant_id, DROP COLUMN IF EXISTS modifier_selections;` and
`CREATE OR REPLACE FUNCTION checkout_transaction(...)` back to the prior
canonical body (kept in version control, e.g. via git history of
`supabase/schema.sql`).

## Marking

If and when SQL is drafted for a database that already has 012–015 deployed,
it must be headed:

```
-- NON-CANONICAL PATCH — REQUIRES APPROVAL
```

and must not be silently merged into `supabase/schema.sql`'s canonical
`checkout_transaction()` definition without that approval being recorded.
