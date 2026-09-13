# Phase 2A.2 — UI/UX & Product Flow Audit

Status: **first increment only** — see honesty note below before reading further.

## Honesty note on scope

The Phase 2A.2 brief covers 40 sections (global design system, IA, dashboard,
POS, F&B relationship flow, tables, KDS, shifts, CRM, purchasing, analytics,
responsive, roles, forms, performance, a11y, PWA, and full regression testing)
across a ~45-page app. That is genuinely a multi-session engineering program,
not something that can be truthfully completed — with real inspection, real
diffs, and real verification — in one pass. Rather than mark all 40 boxes done
without having actually touched most of them, this document reports exactly
what was inspected, what was changed, what was verified, and what remains —
per the brief's own "STOP and report instead of guessing" rule (§40).

## 1. Page inventory (as found)

45 page.tsx files under `app/`, plus 30 files under `components/`. Route list
confirmed via filesystem walk (not assumed):

- Auth: `/login`, `/register`, `/forgot-password`
- POS/Kitchen/Order: `/pos`, `/kitchen`, `/order/[branch]/[table]`, `/reserve/[branch]`
- Admin: `/admin`
- Dashboard (32 sub-routes) — see §2 below
- API routes under `/app/api/*` (account, cashiers, employees, midtrans, orders, register, tables)

No route exists outside what's listed above. No dead code was found in this
pass beyond the sidebar gap noted below.

## 2. Findings

### Navigation / Information Architecture (Priority 2)
- **Before**: `DashboardSidebar.tsx` rendered a single flat, ungrouped list of
  32 links — no sectioning, no visual hierarchy, hard to scan.
- **Finding**: `/dashboard/cashiers` is a real, working page (manage cashier
  accounts, tier-limited) but had **no sidebar entry at all** — reachable only
  via a link buried inside `/dashboard/faq`. This is exactly the kind of
  "unclear route ownership" the brief asks to report rather than silently fix
  by deleting. It was not a duplicate or dead page, so it was **restored into
  the nav**, not removed.
- **Finding**: every other existing sidebar href maps 1:1 to a real route
  directory (cross-checked programmatically) — no dead links found elsewhere.
- **Finding**: the brief's suggested reference IA (§8) includes a standalone
  **"Finance"** group (Expenses / Budgets / Cash Control / Reconciliation).
  No such pages exist anywhere in this repo. Per "only expose modules that
  actually exist," this group was **not added**. This is a real functionality
  gap worth flagging for a future phase, not a UI omission to paper over.

### Global design system (Priority 1)
- **Finding**: a baseline design system already exists in `globals.css`
  (`.btn-primary`, `.btn-outline`, `.btn-danger`, `.card`, `.input-field`,
  `.badge-active` / `.badge-urgent` / `.badge-warning`) plus a shared
  `Skeleton.tsx` and `Modal.tsx`. This is a reasonable foundation — it was
  **not rewritten** blindly. Not yet audited page-by-page for consistent
  *usage* of these tokens (e.g. whether every page's tables/empty
  states/toasts actually use them, vs. one-off inline classes). That
  page-by-page usage audit is unstarted and is the natural next increment.

### Dependencies
- `package.json` lists Framer Motion as part of the stated stack in the
  brief, but it is **not actually an installed dependency** in this repo
  (only `recharts`, `dexie`, `qrcode`, `xlsx`, `jspdf`, `lucide-react`, no
  `framer-motion`). Flagging rather than silently adding a new dependency,
  per §26 ("do not introduce unnecessary dependencies") — worth an explicit
  decision before adding it just to satisfy the brief's mention of it.

## 3. Changes made this increment

- `components/DashboardSidebar.tsx`: regrouped the 32 nav items into 9
  labeled sections (Ringkasan, Katalog Produk, Inventori, Purchasing,
  Operasional & Channel, Pelanggan, Analitik, Cabang & Tim, Pengaturan),
  matching the brief's grouping intent to the app's *actual* modules. Added
  the missing `/dashboard/cashiers` entry. No hrefs removed, no logic
  touched, no business/data code touched — pure navigation presentation.

## 4. Verification performed

- `npx tsc --noEmit` — **passes, 0 errors** (baseline and after change).
- `npm run build` — compiles and lints (only pre-existing `<img>` /
  exhaustive-deps warnings, not introduced by this change); prerender of
  `/kitchen` fails in this sandbox because no `.env.local` / Supabase
  credentials are configured here — this is a sandbox environment gap, not a
  regression (confirmed by checking `.env.local.example` and that no
  `.env.local` exists in this checkout).
- Manual runtime click-through was **not** performed (no live Supabase
  project connected in this environment).

## 5. Pages intentionally left unchanged

Everything except `DashboardSidebar.tsx`. In particular `/dashboard/menu` vs
products (brief §30) was not touched — deciding whether they're duplicates
requires reading both implementations in full, which wasn't done yet.

## 5b. Increment 2 — Global design system: card/button token audit

Went page-by-page (and into the shared components behind pages that
delegate rendering) checking whether the existing tokens in `globals.css`
(`.card`, `.btn-primary`, `.btn-danger`) were actually used, or whether pages
had quietly re-implemented the same visual pattern with raw Tailwind
classes. Found real drift in two tiers:

**Tier 1 — page-level card duplication.** 9 dashboard pages (`crm/customers`,
`qr-tables`, `reservations`, `promotions`, `channel-pricing`, `online-orders`,
`analytics/menu-engineering`, `analytics/growth`, `reserve/[branch]`) had
hand-written `bg-white rounded-2xl border border-neutral-200` wrappers
instead of the `.card` class — functionally the same box, just not sharing
the token, and missing the `.card` class's `shadow-sm`. Consolidated all 13
occurrences onto `.card`.

**Tier 2 — a different app hiding inside this one.** The Purchasing module
(`PurchaseOrderDashboard.tsx`, `SupplierManagement.tsx`) and the shared
Analytics component (`AnalyticsComponents.tsx`, which backs the
peak-hours/profitability/waste-loss pages) were built with **stock Tailwind
blue/green/red** buttons (`bg-blue-600`, `bg-green-600`, `bg-red-600`) and
`rounded-lg`/plain `shadow` cards — none of the app's actual primary
(emerald), urgent (red), or `.card`/`.btn-primary` tokens. Concretely: the
"+ Buat PO" and "+ Terima Barang (GRN)" buttons in Purchasing were blue and
green respectively, while every other primary action in the app is emerald —
so this one module visually looked like a different product bolted on. Fixed
by mapping every one of those buttons/cards onto `.btn-primary` / `.btn-danger`
/ `.card` (13 button occurrences + 14 card occurrences across the 3 files).

**Deliberately not touched:** a decorative `bg-gradient-to-r from-blue-400
to-blue-600` bar in the menu-engineering chart — that's a data-viz color, not
a button/card, and re-coloring it wasn't part of this audit's scope. Also
left alone: widespread use of Tailwind's default `gray-*` palette (e.g.
`text-gray-600`) instead of the app's custom `neutral-*` scale, found in the
same Purchasing/Analytics files. This is real drift (two different grays
producing subtly different shades across the app) but the custom `neutral`
scale only defines shades 50/100/200/300/500/700/900 — a blind find/replace
onto undefined shades (e.g. `gray-400`) would silently produce no styling at
all. This needs a deliberate per-line decision, not a mechanical sweep, so
it's flagged here for a dedicated future increment rather than risked now.

**Verification:** `npx tsc --noEmit` — 0 errors (re-confirmed after this
change, in a fresh `npm install` after node_modules had been removed for
packaging — first run showed spurious "cannot find module" errors because
tsc was accidentally run before reinstalling deps; re-run after `npm install`
was clean). `npm run build` — same pre-existing `<img>`/`exhaustive-deps`
warnings as the increment-1 baseline, no new warning types introduced
(diffed rule sets to confirm), same sandbox-only `/kitchen` prerender
failure (missing Supabase env, unrelated to this change).

## 5c. Increment 3 — gray-vs-neutral palette drift (safe subset only)

Increment 2 flagged that the Purchasing/Analytics/CRM files use Tailwind's
stock `gray-*` palette instead of the app's custom `neutral-*` scale. This
increment closed the safe part of that gap.

Checked every `gray-*` shade actually in use across the app:
`border-gray-300` (44×), `text-gray-600` (30×), `text-gray-500` (20×),
`bg-gray-50` (17×), `bg-gray-100` (2×) — all confined to 4 files:
`AnalyticsComponents.tsx`, `CustomerLoyaltyModal.tsx`,
`PurchaseOrderDashboard.tsx`, `SupplierManagement.tsx`.

The app's custom `neutral` scale (`tailwind.config.ts`) only defines shades
50, 100, 200, 300, 500, 700, 900 — **there is no `neutral-600`.** So:
- `border-gray-300 → border-neutral-300`, `bg-gray-50 → bg-neutral-50`,
  `bg-gray-100 → bg-neutral-100`, `text-gray-500 → text-neutral-500`: exact
  1:1 matches, safe to replace mechanically. Applied across all 4 files
  (83 occurrences total).
- `text-gray-600` (30 occurrences): **left untouched.** There's no defined
  `neutral-600`; mapping it to `neutral-500` (lighter) or `neutral-700`
  (darker) is a visual judgment call, not a mechanical fact, and guessing
  wrong would be a real (if small) visual regression — exactly the kind of
  "unnecessary change" §29 warns against. Flagged here rather than guessed.

**Verification:** fresh `npm install` → `tsc --noEmit` 0 errors → `next lint`
diffed against the increment-1 baseline rule-set (no new rule types) →
`npm run build` same pre-existing sandbox-only `/kitchen` failure, no new
errors.

## 5d. Increment 4 — dashboard "right now" operational snapshot (§9)

Increment 3 flagged that `/dashboard` had no at-a-glance operational widget —
only 7-day historical KPIs. Built the smallest safe version of that gap-fill:
two new cards, **Order Aktif Sekarang** (active orders) and **Bahan Baku
Stok Menipis** (low-stock ingredients), placed directly under the existing
3-card KPI row.

**Database-first check performed before writing any query:**
- `orders.status` (migration 013) already has exactly the states needed —
  counted "active" as anything not yet `SERVED`/`COMPLETED`/`CANCELLED`.
- `branch_ingredients_stock` + `ingredients.low_stock_threshold` (migration
  012) already carry everything needed for a low-stock check.
- This is Case A/C from the brief's decision tree (existing schema
  sufficient; computation safely derived client-side) — **no SQL was
  written, no view/RPC created.**

**No new "low stock" definition was invented.** `app/dashboard/ingredients/
page.tsx` already has a canonical `branchStockFor()` rule (consolidated view
sums stock across branches against the ingredient's threshold; a single
selected branch uses that branch's own stock against its threshold override,
falling back to the ingredient's threshold). That exact rule is replicated
in the dashboard's new query so the two pages can never disagree about what
counts as "low stock." Both new cards respect the existing branch selector
(`selectedBranchId` / `ALL_BRANCHES`) the same way every other widget on this
page already does.

Each card links to where the user would act on it (`/kitchen` for active
orders, `/dashboard/ingredients` for low stock) rather than just displaying
a number with nowhere to go.

**Verification:** `tsc --noEmit` 0 errors; `next lint` — no new warnings in
`app/dashboard/page.tsx` specifically, and no new rule-types vs. the
increment-1 baseline; `npm run build` — same pre-existing sandbox-only
`/kitchen` prerender failure (missing Supabase env), nothing new.

**Not done in this pass:** low-margin products, top products, branch
performance, and recent-transactions widgets from §9's full list. Each needs
its own schema check and, likely, its own small query — deferred to keep
this increment reviewable and low-risk rather than one large dashboard
rewrite.

## 5e. Increment 5 — POS/cashier deep-dive (Priority 4, §10–§11)

Went through `/pos` (1,268 lines), `CartPanel`, `SendToKitchenModal`,
`TablePicker`, `OpenBillPanel` end to end before touching anything, since
this is the highest-risk module in the brief (§33 "existing business logic
is sacred").

**What was already solid — left alone.** The POS product grid, cart, sold-
out handling, stock guards, and `SendToKitchenModal`'s dine-in/takeaway/
delivery selector (§10's order-type-visual-clarity requirement) are already
well-built and already use the shared `.card`/`.btn-primary`/`.input-field`
tokens with `cx()`. This module didn't need the kind of design-system
cleanup increments 2–3 did elsewhere — redesigning it "because a different
implementation looks cleaner" would have violated §1's own instruction, so
nothing there was rewritten.

**Real, safe UX win shipped:** cart quantity was +/- only, one tap at a
time — for a 12x order a cashier had to tap 12 times. Added a tap-to-edit
numeric field in the middle of the +/- buttons (`setQtyDirect` alongside the
existing `updateQty`) so an exact quantity can be typed directly. Same stock-
limit guard as the +/- buttons; no checkout/business logic touched, purely
an additional way to reach the same cart state.

**Real, significant gap found — deliberately NOT built, per §40's stop
condition:** variant/modifier selection does not exist anywhere in the POS
cart flow. Tracing it further: `checkout_transaction()`, the RPC that
records every paid sale, only ever accepts `{product_id, qty}` — no
variant, no modifier, no price delta. The only place variant info can be
attached today is a free-text `variant_notes` string on kitchen tickets,
which is never priced and is dropped once the order is paid. Building a
variant/modifier picker in the POS UI without fixing this would be
decorative — it could not correctly price the sale or deduct the modifier's
own ingredient cost, which fails §31 ("no fake data/functionality") and
would mean silently touching "sacred" checkout logic without isolation or
testing (§33). Documented as a full Case D proposal in
`docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md` instead of guessing at a fix —
no SQL was written or applied.

**Verification:** fresh `npm install` → `tsc --noEmit` 0 errors → `next
lint` diffed against baseline (no new rule types; zero warnings specifically
in `app/pos/page.tsx`) → `npm run build` same pre-existing sandbox-only
`/kitchen` failure, nothing new.

## 5f. Increment 6 — input/select/textarea + secondary-button token audit

Continuation of the Priority 1 design-system pass (§5b/§5c) into the
remaining category flagged as open: form fields. Same method as before —
precise extraction of every `<input>`/`<select>`/`<textarea>`'s own
`className` (not labels or surrounding text), across the whole app.

**Finding:** the same cluster of files identified in increments 2–3
(`CustomerLoyaltyModal.tsx`, `AnalyticsComponents.tsx`,
`PurchaseOrderDashboard.tsx`, `SupplierManagement.tsx`) plus
`app/dashboard/crm/customers/page.tsx` had every form field hand-styled as
raw `border border-neutral-300 rounded-lg` (or `rounded-xl`) instead of the
shared `.input-field` token — 39 fields total. One field
(`CustomerLoyaltyModal.tsx`) even carried a stray `focus:ring-blue-500`,
the same off-brand blue found in increment 2's buttons. A drag-and-drop
upload zone's hover state (`hover:border-blue-500 hover:text-blue-600`) was
also on-brand-corrected to the primary/neutral palette. Separately, a
"Cancel" button pattern (`border border-neutral-300 rounded-lg
hover:bg-neutral-50`, 6 occurrences across the same 4 files) was
consolidated onto `.btn-outline`, which is the exact secondary-button token
already used everywhere else in the app.

Every substitution was confirmed against the field's actual `onChange`
handler before replacing, to make sure real `<input>`/`<select>` elements
were being touched — not a lookalike label or button with similar wrapping
classes.

**Verification:** fresh `npm install` → `tsc --noEmit` 0 errors → `next
lint` diffed against the increment-1 baseline (no new rule types) → `npm
run build` — same pre-existing sandbox-only `/kitchen` failure, nothing new.

**Not done:** badges, tables, toasts/alerts, and empty states — the
remaining named categories under Priority 1 — were not audited this pass.

## 5g. Increment 7 — responsive audit (Priority 13, §21)

**Important limitation up front:** this sandbox has no browser, so nothing
here was verified visually at real breakpoints or on a real device — this
is a code-level audit (which Tailwind breakpoint classes exist, whether
headers can wrap, whether tables scroll) not a pixel-level one. Treat every
finding below as "confirmed by reading the code," not "confirmed on
screen."

**Method:** surveyed breakpoint-class usage (`sm:`/`md:`/`lg:`/`xl:`),
`overflow-x-auto` presence on `<table>`s, and fixed-width usage across the
brief's own priority order (§21: POS, Dashboard, Tables, KDS, Products,
Ingredients, Recipes, Orders, Customers, Analytics).

**Already fine, no changes needed:**
- POS: already has a dedicated mobile cart bottom-sheet vs. desktop sidebar
  split, and a responsive product grid (`grid-cols-2 sm:grid-cols-3
  lg:grid-cols-4`). Not touched.
- Ingredients: its 2 tables are already wrapped in `overflow-x-auto`.
- `/dashboard/transactions` (Orders): uses a flexible card-row layout with
  `truncate`/`min-w-0`/`shrink-0` rather than a rigid table — naturally
  narrow-safe without needing breakpoint classes. This is actually a good
  pattern, not a gap.
- No unguarded 4+ column grid or fixed-pixel-width element was found
  anywhere in the app that would force horizontal overflow.

**Fixed — genuine overflow risk, KDS header:** `/kitchen`'s header packed a
full title, an online/offline badge, and two full-text buttons into one
`h-16` row with no wrap and no truncation. At a narrow width this row would
be forced to squeeze or clip. Fixed by: letting the header wrap
(`flex-wrap`), truncating the title with a shorter "KDS" label below the
`sm:` breakpoint, and collapsing both buttons and the badge to icon-only
below `sm:` (their onClick behavior is unchanged — only the label text is
conditionally hidden).

**Fixed — same gap, 6 page headers:** `attendance`, `employees`,
`membership`, `menu`, `cashiers`, and `target` all have a title+subtitle+
primary-action-button header using `flex items-center justify-between`
with no wrap — the same shape as the KDS bug, just with one button instead
of two, so a milder but real risk on narrow phones. `transactions.tsx`
already had the correct fix (`flex-wrap gap-3`) for this exact pattern, so
the same fix was applied to the other 6 rather than inventing a new
approach — 10 occurrences total (including their loading-skeleton
counterparts, so the skeleton doesn't jump layout once real data loads).
This is purely additive: `flex-wrap` only changes behavior when content
doesn't fit on one line, so nothing changes at normal desktop widths.

**Verification:** fresh `npm install` → `tsc --noEmit` 0 errors → `next
lint` diffed against the increment-1 baseline (no new rule types, no
warnings in `app/kitchen/page.tsx`) → `npm run build` — same pre-existing
sandbox-only `/kitchen` prerender failure (missing Supabase env, unrelated
to this change), nothing new.

**Not done — genuinely open:** Dashboard, Products (Menu grid itself),
Recipes, Customers, and Analytics were only spot-checked for the specific
overflow patterns above, not fully read top-to-bottom for every possible
mobile issue (long table columns needing `overflow-x-auto`, touch-target
sizing, safe-area insets for PWA). No real device or browser testing has
been done at any point in this project's audits. If this app has a live
preview environment, a real click-through on an actual phone is the next
step that would catch anything this code-only pass cannot.

## 6. Unresolved / recommended next increments (in brief's priority order)

1. ~~Card/button token audit~~ — done (increment 2). ~~Safe gray→neutral
   palette fix~~ — done (increment 3, except `text-gray-600`, deliberately
   left for a human visual call — see §5c). ~~Input/select/textarea +
   secondary-button token audit~~ — done (increment 6, §5f). Still open
   within Priority 1: badges, tables, toasts/alerts, empty states haven't
   had the same pass yet.
2. Dashboard KPI data-integrity: confirmed real Supabase queries throughout
   (`daily_sales_analytics`, `peak_hours_analytics`, `best_seller_analytics`,
   `orders`, `branch_ingredients_stock`/`ingredients`) — no hardcoded/mock
   numbers anywhere in `app/`. ~~"Right now" operational snapshot (active
   orders, low-stock ingredients)~~ — done in increment 4 (§5d). Still open:
   low-margin products, top products, branch performance, recent-transactions
   widgets from §9's full list.
3. POS flow (§10): deep-dive done in increment 5 (§5e) — cart quantity is
   now typeable, and the module's existing design/order-type UX was found
   already solid and left alone. **Top open decision:** whether to approve
   the Case D database change in `docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md`
   (wiring variants/modifiers into `checkout_transaction()`), which blocks
   any real Product→Variant→Modifier→Recipe→Ingredient UX at POS (§11).
4. Decide Framer Motion in/out before any KDS/animation work (§16).
5. Responsive/mobile audit (§21): first pass done in increment 7 (§5g) —
   KDS header + 6 page headers fixed for narrow-width overflow. **Genuinely
   unverified visually** — no browser/device available in this sandbox.
   Dashboard/Recipes/Customers/Analytics pages, touch-target sizing, and
   PWA safe-area handling still need a full pass, ideally with real device
   testing. Full functional regression (§34) also still needs a real
   Supabase project connected.

**Delivery note:** starting this increment, all changes ship in a single
consolidated zip per request, rather than one zip per increment.

No database schema was inspected as "requiring a change" in this increment
— see `docs/PHASE_2A2_COMPLETION_REPORT.md` §Database Change Report.
