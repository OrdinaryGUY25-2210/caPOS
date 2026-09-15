export type UserRole = "super_admin" | "owner" | "manager" | "cashier";
export type SubStatus = "trial" | "active" | "past_due" | "expired";

export interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  has_custom_website: boolean;
  custom_website_url: string | null;
  show_wifi_on_receipt: boolean;
  wifi_ssid: string | null;
  wifi_password: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  status: SubStatus;
  trial_ends_at: string;
  valid_until: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  role: UserRole;
  job_title: string | null;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  /** Cabang penugasan (migration_011). NULL untuk owner/super_admin — mereka akses semua cabang. */
  branch_id: string | null;
}

/** Cabang/outlet milik 1 tenant (migration_011 — Multi-Cabang). */
export interface Branch {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  /** Cabang pertama tenant, dibuat otomatis saat tenant daftar — tidak bisa dihapus. */
  is_main: boolean;
  is_active: boolean;
  /** BARU (Phase 4) — dipakai di URL publik /order/[slug]/[table] & /reserve/[slug]. */
  slug: string;
  created_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  category: string;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
}

export interface Membership {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  member_code: string;
  discount_percentage: number;
  valid_until: string;
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  tenant_id: string;
  cashier_id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  member_id: string | null;
  is_offline_sync: boolean;
  created_at: string;
  /** Cabang tempat transaksi terjadi (migration_011). NULL = transaksi lama sebelum multi-cabang. */
  branch_id: string | null;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  product_id: string;
  qty: number;
  subtotal: number;
}

export interface CartItem extends Product {
  qty: number;
  /**
   * BARU (Phase 2A.3) — kunci unik baris keranjang: `${product_id}::${variant_id ?? "base"}::${sorted modifier_ids}`.
   * Berbeda dari `id` (product id) supaya 2 konfigurasi berbeda dari produk
   * yang sama (mis. Large+Oat vs Large+Full Cream) TIDAK otomatis digabung
   * jadi satu baris. Item lama/tanpa konfigurasi tetap boleh pakai `id`
   * sebagai fallback (opsional, backward-compatible).
   */
  cartItemId?: string;
  variantId?: string | null;
  variantName?: string | null;
  modifiers?: { modifier_id: string; name: string; price_adjustment: number }[];
  /** Harga akhir per unit = base/variant price + total price_adjustment modifier. Fallback ke `price` kalau tidak ada konfigurasi. */
  unitPrice?: number;
}

/* =========================================================
 * PHASE 2 — Kitchen Engine, Operational Flow, Cash Management
 * (migration_012_phase2_kitchen_shift_cash.sql)
 * ========================================================= */

export type OrderStatus = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "COMPLETED" | "CANCELLED";
export type OrderType = "dine_in" | "takeaway" | "delivery";
export type PaymentMethod = "cash" | "qris" | "debit" | "credit" | "ewallet" | "bank_transfer";
export type CashMovementType = "cash_in" | "cash_out";

export interface KitchenStation {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  code: string;
  printer_name: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export type RefundType = "FULL" | "PARTIAL" | "ITEM";
export type RefundStatus = "PENDING_APPROVAL" | "COMPLETED" | "REJECTED";
export type RefundReasonCategory =
  | "CUSTOMER_REQUEST"
  | "WRONG_ORDER"
  | "DUPLICATE_PAYMENT"
  | "PRODUCT_UNAVAILABLE"
  | "DAMAGED"
  | "QUALITY_ISSUE"
  | "OTHER";

/** Refund (Phase 2 Update 3) — SELALU record baru, tidak pernah mengubah transactions/transaction_items asli. */
export interface Refund {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  transaction_id: string;
  refund_type: RefundType;
  amount: number;
  items: { transaction_item_id: string; product_name: string; qty: number; amount: number }[] | null;
  reason_category: RefundReasonCategory;
  reason_note: string | null;
  status: RefundStatus;
  requested_by: string | null;
  approved_by: string | null;
  created_at: string;
  decided_at: string | null;
  /** BARU (Migrasi 019) — status pengembalian stok lewat toggle "Restore Stock to Inventory". */
  stock_restored: boolean;
  stock_restored_at: string | null;
  stock_restored_by: string | null;
}

export interface Order {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  shift_id: string | null;
  cashier_id: string | null;
  order_number: string;
  order_type: OrderType;
  table_number: string | null;
  customer_name: string | null;
  status: OrderStatus;
  notes: string | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  transaction_id: string | null;
  created_at: string;
  /** BARU (Phase 4) — tautan ke branch_tables, diisi kalau order berasal dari QR meja. */
  table_id: string | null;
  /** BARU (Phase 4) — asal pesanan. */
  channel: OrderChannel;
  /** BARU (Phase 4) — snapshot komisi platform (gofood/grabfood/shopeefood) saat order dibuat. */
  channel_commission_amount: number;
  /** BARU (Migrasi 019) — diskon manual Rupiah (wajib otorisasi PIN supervisor untuk kasir). */
  manual_discount_amount: number;
  manual_discount_reason: string | null;
  manual_discount_by: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  station_id: string | null;
  product_name: string;
  variant_notes: string | null;
  qty: number;
  unit_price: number;
  subtotal: number;
  item_status: "NEW" | "PREPARING" | "READY";
  created_at: string;
  /** BARU (Phase 2 Update 3) — qty yang dibatalkan dari qty asli lewat void_order_item(). Sisa yang ditagih = qty - voided_qty. */
  voided_qty: number;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  /** BARU (Migrasi 019) — jejak audit price override (unit_price aktif tetap kolom unit_price). */
  original_unit_price: number | null;
  price_override_reason: string | null;
  price_overridden_by: string | null;
  price_overridden_at: string | null;
  /** BARU (Migrasi 019) — qty yang sudah tertagih lewat Split Bill (Split by Item). */
  split_billed_qty: number;
  /**
   * BARU (Phase 2A F&B Master Data, migration_014) — snapshot varian/modifier/resep
   * terstruktur. Kolom sudah ada di DB sejak migration_014, tapi baru diisi kalau
   * create_kitchen_order() menerima variant_id/modifier_ids di p_items (lihat
   * catatan di app/pos/page.tsx). Nullable — item lama/tanpa varian tetap valid.
   */
  variant_id?: string | null;
  variant_name?: string | null;
  modifier_selections?: { modifier_id: string; name: string; price_adjustment: number }[];
  recipe_id?: string | null;
  recipe_version?: number | null;
}

/** Order dengan relasi item + nama kasir, dipakai di KDS & tiket cetak. */
export interface OrderWithItems extends Order {
  order_items: OrderItem[];
  cashier_name?: string | null;
}

export interface TransactionPayment {
  id: string;
  transaction_id: string;
  method: PaymentMethod;
  amount: number;
  reference_number: string | null;
  created_at: string;
}

export interface CashMovement {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  shift_id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  created_by: string | null;
  created_at: string;
}

/** Baris tabel `shifts` setelah Phase 2 (opening/closing cash). */
export interface ShiftDetail {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
  opening_cash: number;
  closing_cash_expected: number | null;
  closing_cash_actual: number | null;
  cash_difference: number | null;
  closing_notes: string | null;
  closed_by: string | null;
}

/** Hasil RPC shift_cash_summary() — dipakai live di modal Tutup Shift. */
export interface ShiftCashSummary {
  opening_cash: number;
  total_cash_sales: number;
  total_cash_in: number;
  total_cash_out: number;
  expected_cash: number;
  total_transactions: number;
  total_transactions_count: number;
}

// =========================================================
// Phase 4 — QR Self-Order, Reservasi, Multi-channel, Growth
// =========================================================
/* =========================================================
 * PHASE 4 — QR Self-Order, Reservasi Meja, Online Order Hub,
 * Advanced Growth Analytics (phase4_schema.sql)
 *
 * Tempel isi file ini ke akhir `lib/types.ts` yang sudah ada
 * (jangan timpa file lama — Phase 4 murni menambah tipe baru).
 * ========================================================= */

export type OrderChannel =
  | "pos"
  | "qr_self_order"
  | "reservation"
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "website";

export type OnlineChannel = "gofood" | "grabfood" | "shopeefood" | "website";

export type QrPaymentMethod = "qris" | "pay_at_cashier";
export type QrPaymentStatus = "unpaid" | "pending" | "paid" | "failed";

export type ReservationStatus = "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";
export type DepositStatus = "unpaid" | "paid" | "refunded" | "forfeited";

export type TableLiveStatusValue = "AVAILABLE" | "RESERVED" | "OCCUPIED" | "BILL_PRINTED" | "CLEANING";

/** Meja fisik per cabang (sumber QR Code & alokasi reservasi). */
export interface BranchTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_number: string;
  capacity: number;
  qr_token: string;
  is_active: boolean;
  created_at: string;
  /** BARU (Phase 2 Update 1) — true setelah order dine-in di meja ini lunas, sampai kasir menandai selesai dibersihkan. */
  needs_cleaning: boolean;
  cleaning_started_at: string | null;
}

/** Baris view `table_live_status` — dipakai peta meja live di Dashboard POS & /pos. */
export interface TableLiveStatus {
  table_id: string;
  tenant_id: string;
  branch_id: string;
  table_number: string;
  capacity: number;
  is_active: boolean;
  status: TableLiveStatusValue;
  active_order_id: string | null;
  /** BARU (Phase 2 Update 1) */
  active_order_number: string | null;
  active_order_status: OrderStatus | null;
  active_order_total: number;
  occupied_at: string | null;
  cleaning_started_at: string | null;
  /** BARU (Migrasi 019) — diset oleh mark_bill_printed(), menentukan status BILL_PRINTED. */
  bill_printed_at: string | null;
  upcoming_reservation_id: string | null;
}

/* =========================================================
 * MIGRASI 019 — Supervisor PIN, Stock Reversal, Table Actions, Split Bill
 * ========================================================= */

/** Tindakan sensitif yang wajib otorisasi PIN supervisor (SupervisorPinModal.tsx). */
export type SensitiveAction = "VOID_ITEM" | "CANCEL_ORDER" | "MANUAL_DISCOUNT" | "PRICE_OVERRIDE";

/** Hasil RPC verify_supervisor_pin() — kosong (null) berarti PIN salah/tidak ada yang cocok. */
export interface SupervisorAuthResult {
  supervisor_id: string;
  supervisor_name: string | null;
  supervisor_role: UserRole;
}

/** Baris untuk 1 sub-bill di mode "Split by Item" (state lokal SplitBillModal, belum dikirim ke server). */
export interface SplitByItemGroup {
  id: string;
  label: string;
  /** order_item_id -> qty yang dialokasikan ke grup ini */
  allocations: Record<string, number>;
}

/** "Amplop" pembayaran & info pelanggan di atas 1 order QR Self-Order. */
export interface QrOrder {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string | null;
  order_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: QrPaymentMethod;
  payment_status: QrPaymentStatus;
  payment_reference: string | null;
  total_amount: number;
  created_at: string;
}

export interface Reservation {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  reservation_at: string;
  duration_minutes: number;
  reminder_window_minutes: number;
  deposit_amount: number;
  deposit_status: DepositStatus;
  status: ReservationStatus;
  notes: string | null;
  order_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Baris view `reservation_calendar` — sudah menyertakan nomor meja. */
export interface ReservationCalendarRow extends Reservation {
  table_number: string | null;
}

export interface ChannelPricing {
  id: string;
  tenant_id: string;
  product_id: string;
  channel: OnlineChannel;
  markup_pct: number;
  commission_pct: number;
  is_active: boolean;
  created_at: string;
}

/** Baris view `channel_commission_report`. */
export interface ChannelCommissionRow {
  tenant_id: string;
  branch_id: string | null;
  channel: OrderChannel;
  sale_date: string;
  total_orders: number;
  gross_revenue: number;
  total_commission: number;
  net_revenue: number;
}

/** Baris view `customer_visit_stats` / `inactive_customers`. */
export interface CustomerVisitStats {
  tenant_id: string;
  member_id: string;
  customer_name: string;
  customer_phone: string;
  visit_count: number;
  lifetime_value: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  days_since_last_visit: number | null;
  is_repeat_customer: boolean;
}

/** Hasil RPC growth_summary(). */
export interface GrowthSummary {
  total_customers: number;
  repeat_customers: number;
  repeat_visit_rate: number;
  avg_ltv: number;
  inactive_customers_count: number;
}

export type MenuEngineeringClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG";

/** Baris hasil RPC menu_engineering_report(). */
export interface MenuEngineeringRow {
  product_id: string;
  product_name: string;
  category: string | null;
  price: number;
  cost_price: number;
  margin_amount: number;
  margin_pct: number;
  qty_sold: number;
  revenue: number;
  avg_qty_sold: number;
  avg_margin_amount: number;
  classification: MenuEngineeringClass;
  recommendation: string;
}

/* ---- Halaman publik QR Self-Order (hasil RPC get_qr_order_page) ---- */
export interface QrOrderPageProduct {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url: string | null;
}

export interface QrOrderPageData {
  error?: "branch_not_found" | "table_not_found";
  /** `tenant_id` (Migrasi 020) dipakai murni sebagai nama topik broadcast
   * realtime `products-<tenant_id>` — bukan untuk query apa pun di klien. */
  branch?: { name: string; slug: string; address: string | null; tenant_id: string };
  table?: { id: string; table_number: string; capacity: number };
  products?: QrOrderPageProduct[];
}

/** Payload broadcast (Migrasi 020, topik `products-<tenant_id>`) yang
 * dikirim POS/KDS setiap kali toggle Sold Out/Menu 86 berhasil disimpan —
 * dipakai SelfOrderClient untuk memblokir pemesanan item tsb secara
 * instan tanpa reload, dan POS/KDS lain untuk sinkron status kartu menu. */
export interface MenuAvailabilityBroadcast {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url: string | null;
  is_available: boolean;
}

/** Item keranjang di halaman pemesanan mandiri (sebelum dikirim ke server). */
export interface QrCartItem {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  variant_notes?: string;
}

/** Hasil RPC get_qr_order_status() — dipakai halaman pelacakan status. */
export interface QrOrderStatusData {
  error?: "not_found";
  order_number?: string;
  table_number?: string;
  status?: string;
  payment_method?: QrPaymentMethod;
  payment_status?: QrPaymentStatus;
  total_amount?: number;
  created_at?: string;
  items?: { product_name: string; qty: number; variant_notes: string | null; subtotal: number }[];
}

/* =========================================================
 * F&B MASTER DATA — Phase 2A
 * (migration_014_loyalty_fnb_core_expenses_deduction.sql)
 * Ingredient / Variant / Modifier / Recipe engine. Ingredient stock
 * source of truth is branch_ingredients_stock, NEVER products.stock_qty.
 * ========================================================= */

export interface Unit {
  code: string;
  name: string;
  is_active: boolean;
}

export interface UnitConversion {
  id: string;
  tenant_id: string | null;
  from_unit: string;
  to_unit: string;
  factor: number;
  created_at: string;
}

export type IngredientStatus = "active" | "inactive";

export interface Ingredient {
  id: string;
  tenant_id: string;
  name: string;
  category: string | null;
  purchase_unit: string;
  inventory_unit: string;
  purchase_to_inventory_ratio: number | null;
  low_stock_threshold: number;
  status: IngredientStatus;
  is_86: boolean;
  created_at: string;
  updated_at: string;
}

/** Stok bahan per cabang — SATU-SATUNYA sumber kebenaran stok ingredient. */
export interface BranchIngredientStock {
  id: string;
  tenant_id: string;
  branch_id: string;
  ingredient_id: string;
  stock_qty: number;
  low_stock_threshold: number | null;
  cost_price: number;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  tenant_id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price: number;
  cost_price: number | null;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ModifierGroup {
  id: string;
  tenant_id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Modifier {
  id: string;
  modifier_group_id: string;
  name: string;
  price_adjustment: number;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductModifierGroup {
  id: string;
  product_id: string;
  modifier_group_id: string;
  display_order: number;
}

export interface ModifierIngredientImpact {
  id: string;
  modifier_id: string;
  ingredient_id: string;
  quantity_delta: number;
  unit: string;
}

export interface Recipe {
  id: string;
  tenant_id: string;
  product_id: string;
  variant_id: string | null;
  name: string | null;
  version: number;
  is_active: boolean;
  yield_quantity: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  wastage_percentage: number | null;
  notes: string | null;
}

/** Baris hasil RPC deduct_recipe_stock(p_order_id) — dipakai app/api/orders/deduct-stock. */
export interface DeductRecipeStockResult {
  order_item_id: string;
  deducted: boolean;
  reason: string | null;
}

export interface RecipeConsumptionLog {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  source_type: "order_item" | "transaction_item";
  source_id: string;
  recipe_id: string | null;
  recipe_version: number | null;
  ingredient_id: string | null;
  quantity: number;
  unit: string;
  cost_snapshot: number;
  created_at: string;
}
