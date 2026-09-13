# PHASE A — DATABASE FIX APPLIED (FINAL)

Deployment status for 012–015, per your confirmation: **NOT deployed.**
Fix applied directly to `migration_015` in place, as instructed.

## 1. Exact change made

File: `supabase/migration_015_capos_phase5_financial_intelligence_final.sql`,
inside `generate_recurring_expenses()`.

```diff
-    WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner', 'admin')
+    -- BUG FIX (Phase A final): original checked role IN ('owner','admin'), but
+    -- 'admin' is not a member of the user_role enum, which raised
+    -- "invalid input value for enum user_role" on every call regardless of caller.
+    WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner', 'super_admin')
```

One executable predicate changed, one explanatory comment added (matching
the comment style already used for the four earlier fixes of this same bug
class in this file). Nothing else in the file was touched.

Diffed against the original zip to confirm — this is the entire change,
line-for-line.

## 2. Migration files changed

- `supabase/migration_015_capos_phase5_financial_intelligence_final.sql` — this file only.

## 3. Confirmation: 001–014 and schema.sql unchanged

Verified by SHA-256 checksum against the pre-fix state:

- `migration_001_profiles_email_active.sql` — OK, unchanged
- `migration_011_multi_branch_stock_opname.sql` — OK, unchanged
- `migration_012_capos_phase1_fnb_core.sql` — OK, unchanged
- `migration_013_capos_phase2_pos_operations.sql` — OK, unchanged
- `migration_014_capos_phase3_business_omnichannel.sql` — OK, unchanged
- `supabase/schema.sql` — OK, unchanged

(001–010 were not individually re-hashed but were never opened or written
to in this pass — only migration_015 was.)

## 4. Confirmation: no migration_016 created

`ls supabase/ | grep 016` returns nothing. No new migration file exists.

## 5. Validation results

**Structural / static SQL check** (no live DB connection available, so this
is parse-level, not executed):
- Parentheses balanced (172 open / 172 close) in the edited file.
- Dollar-quoting balanced (`$$` count = 6, i.e. 3 complete function bodies).
- Exactly one `CREATE OR REPLACE FUNCTION generate_recurring_expenses` — no
  duplicate introduced.
- Full re-search of the file confirms **zero remaining executable
  `'admin'` enum references** — every `role IN (...)` predicate in the file
  now reads `('owner', 'super_admin')`. The only remaining occurrences of
  the string "admin" are: (a) historical audit comments documenting past
  fixes, and (b) two `RAISE EXCEPTION` message strings ("hanya owner/admin
  yang dapat...") — these are user-facing text, not enum comparisons, so
  they don't error; they're cosmetically stale but not a functional bug,
  and weren't in scope of this fix.
- **Migration ordering** 012 → 013 → 014 → 015: unchanged, and still
  correct — `deduct_recipe_stock_for_transaction()` (012) is still defined
  before its first caller in 014; nothing in this fix touched any
  cross-migration dependency.
- **No duplicate function/table definitions** introduced — the fix
  modified an existing function body via `CREATE OR REPLACE`, it did not
  add a new object.
- **No destructive statements** introduced — diff contains no `DROP`,
  `TRUNCATE`, or `DELETE FROM`.
- **RLS**: policy counts in migration_015 unchanged (`CREATE POLICY` = 7,
  `DROP POLICY IF EXISTS` = 7, same as before the fix) — the edit was
  inside a function body, not a policy, so RLS definitions are untouched.

**Application checks:**
- `npx tsc --noEmit`: **0 errors.**
- `npm run lint`: **0 new warnings** — same pre-existing set as before
  (2 `exhaustive-deps`, 5 `no-img-element`).
- `npm run build`: **succeeds**, all 54 routes generate.

**Not performed:** actual execution against a live/disposable Postgres
instance (none available in this environment) — so this fix is
**STATIC VERIFIED**, not **RUNTIME VERIFIED**. The predicate change itself
is low-risk (identical pattern already proven correct four times over
elsewhere in this same file), but it hasn't been run.

## 6. Remaining blockers

None for this specific fix — it's complete and self-contained.

Carried over from the audit, unchanged and not addressed in this pass
(out of scope here, still valid for later):
- Variant/modifier pricing gap at POS — Phase B scope.
- Stale migration-number references (019/020) in a few code comments and
  Phase 3/4 docs — cosmetic only.
- The two `RAISE EXCEPTION` message strings noted in §5 that still say
  "owner/admin" in their text — cosmetic, not a bug, not fixed here since
  it wasn't requested.

## Status

**PHASE A: COMPLETE.**

Migration 015 corrected in place, no migration_016, 001–014 and
schema.sql byte-identical to before, all static/application checks pass.
Not deployed to Supabase — that step is yours to run when ready.
