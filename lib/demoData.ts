/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Data CONTOH terpusat untuk "mode contoh" — dipakai halaman-halaman dashboard
 * saat tenant belum punya transaksi sama sekali (lihat `lib/demoMode.ts`).
 *
 * Aturan penting:
 *  - SEMUA id berawalan `demo-` dan `tenant_id`/`branch_id` bernilai "demo",
 *    supaya tidak pernah bertabrakan dengan data asli.
 *  - Bentuk objek sengaja mengikuti tipe asli (lihat lib/types.ts). Sebagian
 *    nilai (mis. tanggal reservasi) dihasilkan lewat fungsi agar relatif ke
 *    "hari ini".
 *  - Ini murni untuk TAMPILAN; halaman tetap harus mencegah operasi tulis
 *    terhadap baris contoh.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (hour: number, minute = 0, day = 14) =>
  `2026-10-${pad(day)}T${pad(hour)}:${pad(minute)}:00.000Z`;

// ======================= Katalog Produk =======================
export const DEMO_PRODUCTS: any[] = [
  { id: "demo-p1", tenant_id: "demo", name: "Es Kopi Susu", price: 22000, category: "Kopi", image_url: null, is_available: true, created_at: iso(8) },
  { id: "demo-p2", tenant_id: "demo", name: "Cappuccino", price: 26000, category: "Kopi", image_url: null, is_available: true, created_at: iso(8, 5) },
  { id: "demo-p3", tenant_id: "demo", name: "Americano", price: 20000, category: "Kopi", image_url: null, is_available: true, created_at: iso(8, 10) },
  { id: "demo-p4", tenant_id: "demo", name: "Matcha Latte", price: 28000, category: "Non-Kopi", image_url: null, is_available: true, created_at: iso(8, 15) },
  { id: "demo-p5", tenant_id: "demo", name: "Teh Lemon", price: 18000, category: "Teh", image_url: null, is_available: true, created_at: iso(8, 20) },
  { id: "demo-p6", tenant_id: "demo", name: "Croissant", price: 18000, category: "Makanan", image_url: null, is_available: true, created_at: iso(8, 25) },
  { id: "demo-p7", tenant_id: "demo", name: "Kentang Goreng", price: 20000, category: "Makanan", image_url: null, is_available: true, created_at: iso(8, 30) },
  { id: "demo-p8", tenant_id: "demo", name: "Air Mineral", price: 8000, category: "Minuman", image_url: null, is_available: true, created_at: iso(8, 35) },
];

export const DEMO_PRODUCTS_WITH_STOCK: any[] = [
  { ...DEMO_PRODUCTS[0], cost_price: 9000, track_stock: true, stock_qty: 24, low_stock_threshold: 10 },
  { ...DEMO_PRODUCTS[1], cost_price: 11000, track_stock: true, stock_qty: 18, low_stock_threshold: 10 },
  { ...DEMO_PRODUCTS[2], cost_price: 7000, track_stock: true, stock_qty: 40, low_stock_threshold: 12 },
  { ...DEMO_PRODUCTS[3], cost_price: 14000, track_stock: true, stock_qty: 9, low_stock_threshold: 10 },
  { ...DEMO_PRODUCTS[4], cost_price: 6000, track_stock: true, stock_qty: 33, low_stock_threshold: 10 },
  { ...DEMO_PRODUCTS[5], cost_price: 9000, track_stock: true, stock_qty: 12, low_stock_threshold: 6 },
  { ...DEMO_PRODUCTS[6], cost_price: 10000, track_stock: true, stock_qty: 15, low_stock_threshold: 8 },
  { ...DEMO_PRODUCTS[7], cost_price: 3000, track_stock: true, stock_qty: 60, low_stock_threshold: 20 },
];

export const DEMO_VARIANTS: any[] = [
  { id: "demo-v1", tenant_id: "demo", product_id: "demo-p1", name: "Regular", sku: "EKS-R", price: 22000, cost_price: 9000, is_available: true, display_order: 1, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-v2", tenant_id: "demo", product_id: "demo-p1", name: "Large", sku: "EKS-L", price: 26000, cost_price: 11000, is_available: true, display_order: 2, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-v3", tenant_id: "demo", product_id: "demo-p2", name: "Regular", sku: "CAP-R", price: 26000, cost_price: 11000, is_available: true, display_order: 1, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-v4", tenant_id: "demo", product_id: "demo-p2", name: "Large", sku: "CAP-L", price: 30000, cost_price: 13000, is_available: true, display_order: 2, created_at: iso(8), updated_at: iso(8) },
];

export const DEMO_RECIPES: any[] = [
  { id: "demo-r1", tenant_id: "demo", product_id: "demo-p1", variant_id: null, name: "Es Kopi Susu", version: 1, is_active: true, yield_quantity: 1, created_by: null, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-r2", tenant_id: "demo", product_id: "demo-p2", variant_id: null, name: "Cappuccino", version: 1, is_active: true, yield_quantity: 1, created_by: null, created_at: iso(8), updated_at: iso(8) },
];

export const DEMO_RECIPE_ITEMS: any[] = [
  { id: "demo-ri1", recipe_id: "demo-r1", ingredient_id: "demo-i1", quantity: 18, unit: "g", wastage_percentage: 5, notes: null },
  { id: "demo-ri2", recipe_id: "demo-r1", ingredient_id: "demo-i2", quantity: 120, unit: "ml", wastage_percentage: null, notes: null },
  { id: "demo-ri3", recipe_id: "demo-r1", ingredient_id: "demo-i3", quantity: 20, unit: "ml", wastage_percentage: null, notes: null },
  { id: "demo-ri4", recipe_id: "demo-r2", ingredient_id: "demo-i1", quantity: 18, unit: "g", wastage_percentage: 5, notes: null },
  { id: "demo-ri5", recipe_id: "demo-r2", ingredient_id: "demo-i2", quantity: 150, unit: "ml", wastage_percentage: null, notes: null },
];

export const DEMO_MODIFIER_GROUPS: any[] = [
  { id: "demo-mg1", tenant_id: "demo", name: "Level Gula", is_required: true, min_select: 1, max_select: 1, display_order: 1, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-mg2", tenant_id: "demo", name: "Extra Topping", is_required: false, min_select: 0, max_select: 3, display_order: 2, created_at: iso(8), updated_at: iso(8) },
];

export const DEMO_MODIFIERS: any[] = [
  { id: "demo-m1", modifier_group_id: "demo-mg1", name: "Normal", price_adjustment: 0, is_available: true, display_order: 1, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-m2", modifier_group_id: "demo-mg1", name: "Less Sugar", price_adjustment: 0, is_available: true, display_order: 2, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-m3", modifier_group_id: "demo-mg1", name: "No Sugar", price_adjustment: 0, is_available: true, display_order: 3, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-m4", modifier_group_id: "demo-mg2", name: "Extra Shot", price_adjustment: 5000, is_available: true, display_order: 1, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-m5", modifier_group_id: "demo-mg2", name: "Extra Boba", price_adjustment: 6000, is_available: true, display_order: 2, created_at: iso(8), updated_at: iso(8) },
];

export const DEMO_MODIFIER_IMPACTS: any[] = [
  { id: "demo-mi1", modifier_id: "demo-m4", ingredient_id: "demo-i1", quantity_delta: 9, unit: "g" },
];

export const DEMO_PRODUCT_MODIFIER_GROUPS: any[] = [
  { id: "demo-pmg1", product_id: "demo-p1", modifier_group_id: "demo-mg1", display_order: 1 },
  { id: "demo-pmg2", product_id: "demo-p1", modifier_group_id: "demo-mg2", display_order: 2 },
  { id: "demo-pmg3", product_id: "demo-p2", modifier_group_id: "demo-mg1", display_order: 1 },
];

// ======================= Inventori / Bahan Baku =======================
export const DEMO_INGREDIENTS: any[] = [
  { id: "demo-i1", tenant_id: "demo", name: "Biji Kopi Espresso", category: "Kopi", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 500, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i2", tenant_id: "demo", name: "Susu UHT Full Cream", category: "Dairy", purchase_unit: "liter", inventory_unit: "ml", purchase_to_inventory_ratio: 1000, low_stock_threshold: 2000, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i3", tenant_id: "demo", name: "Gula Sirup", category: "Pemanis", purchase_unit: "liter", inventory_unit: "ml", purchase_to_inventory_ratio: 1000, low_stock_threshold: 1500, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i4", tenant_id: "demo", name: "Matcha Powder", category: "Non-Kopi", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 300, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i5", tenant_id: "demo", name: "Tepung Terigu", category: "Bahan Kering", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 1000, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i6", tenant_id: "demo", name: "Mentega", category: "Dairy", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 500, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i7", tenant_id: "demo", name: "Kentang Beku", category: "Frozen", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 800, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
  { id: "demo-i8", tenant_id: "demo", name: "Lemon", category: "Buah", purchase_unit: "kg", inventory_unit: "g", purchase_to_inventory_ratio: 1000, low_stock_threshold: 300, status: "active", is_86: false, created_at: iso(8), updated_at: iso(8) },
];

export const DEMO_BRANCH_INGREDIENT_STOCK: any[] = [
  { id: "demo-bs1", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i1", stock_qty: 1800, low_stock_threshold: 500, cost_price: 0.12, updated_at: iso(8) },
  { id: "demo-bs2", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i2", stock_qty: 6500, low_stock_threshold: 2000, cost_price: 0.02, updated_at: iso(8) },
  { id: "demo-bs3", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i3", stock_qty: 1200, low_stock_threshold: 1500, cost_price: 0.015, updated_at: iso(8) },
  { id: "demo-bs4", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i4", stock_qty: 250, low_stock_threshold: 300, cost_price: 0.35, updated_at: iso(8) },
  { id: "demo-bs5", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i5", stock_qty: 4200, low_stock_threshold: 1000, cost_price: 0.012, updated_at: iso(8) },
  { id: "demo-bs6", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i6", stock_qty: 900, low_stock_threshold: 500, cost_price: 0.09, updated_at: iso(8) },
  { id: "demo-bs7", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i7", stock_qty: 3000, low_stock_threshold: 800, cost_price: 0.03, updated_at: iso(8) },
  { id: "demo-bs8", tenant_id: "demo", branch_id: "demo-branch", ingredient_id: "demo-i8", stock_qty: 700, low_stock_threshold: 300, cost_price: 0.025, updated_at: iso(8) },
];

export const DEMO_STOCK_MOVEMENTS: any[] = [
  { id: "demo-sm1", type: "restock", qty_change: 24, note: "Restock pagi", created_at: iso(9), product_name: "Es Kopi Susu" },
  { id: "demo-sm2", type: "sale", qty_change: -6, note: "Penjualan", created_at: iso(11, 20), product_name: "Cappuccino" },
  { id: "demo-sm3", type: "sale", qty_change: -3, note: "Penjualan", created_at: iso(12, 10), product_name: "Matcha Latte" },
  { id: "demo-sm4", type: "adjustment", qty_change: -2, note: "Koreksi stok opname", created_at: iso(13, 5), product_name: "Croissant" },
];

export const DEMO_OPNAME_ROWS: any[] = [
  { ingredient: { ...DEMO_INGREDIENTS[0], cost_price: 0.12 }, systemQty: 1800, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
  { ingredient: { ...DEMO_INGREDIENTS[1], cost_price: 0.02 }, systemQty: 6500, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
  { ingredient: { ...DEMO_INGREDIENTS[2], cost_price: 0.015 }, systemQty: 1200, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
  { ingredient: { ...DEMO_INGREDIENTS[3], cost_price: 0.35 }, systemQty: 250, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
  { ingredient: { ...DEMO_INGREDIENTS[4], cost_price: 0.012 }, systemQty: 4200, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
  { ingredient: { ...DEMO_INGREDIENTS[6], cost_price: 0.03 }, systemQty: 3000, physicalInput: "", reason: "", note: "", saving: false, savedAt: null },
];

export const DEMO_OPNAME_LOGS: any[] = [
  { id: "demo-ol1", created_at: iso(9), system_qty: 2000, physical_qty: 1800, difference_qty: -200, loss_value: 24000, reason: "SUSUT", note: "Susut saat penyimpanan", unit: "g", ingredient_name: "Biji Kopi Espresso", branch_name: "Cabang Utama", created_by_name: "Budi" },
  { id: "demo-ol2", created_at: iso(9, 5), system_qty: 7000, physical_qty: 6500, difference_qty: -500, loss_value: 10000, reason: "TUMPAH", note: "Tumpah saat persiapan", unit: "ml", ingredient_name: "Susu UHT Full Cream", branch_name: "Cabang Utama", created_by_name: "Budi" },
  { id: "demo-ol3", created_at: iso(9, 10), system_qty: 300, physical_qty: 250, difference_qty: -50, loss_value: 17500, reason: "EXPIRED", note: "Mendekati kadaluarsa", unit: "g", ingredient_name: "Matcha Powder", branch_name: "Cabang Utama", created_by_name: "Sari" },
];

// ======================= Purchasing =======================
export const DEMO_SUPPLIERS: any[] = [
  { id: "demo-s1", supplier_code: "SUP-001", company_name: "PT Kopi Nusantara", contact_person: "Andi", phone_number: "081234567001", whatsapp_number: "6281234567001", email: "sales@kopinusa.co.id", address: "Jl. Industri No. 12", city: "Bandung", province: "Jawa Barat", postal_code: "40123", payment_terms: "NET 30", categories: ["Bahan Kering"], is_active: true, created_at: iso(8) },
  { id: "demo-s2", supplier_code: "SUP-002", company_name: "CV Susu Segar", contact_person: "Rina", phone_number: "081234567002", whatsapp_number: "6281234567002", email: "order@sususegar.id", address: "Jl. Peternakan No. 5", city: "Bandung", province: "Jawa Barat", postal_code: "40234", payment_terms: "COD", categories: ["Dairy"], is_active: true, created_at: iso(8) },
  { id: "demo-s3", supplier_code: "SUP-003", company_name: "Toko Bahan Kue Makmur", contact_person: "Tono", phone_number: "081234567003", whatsapp_number: "6281234567003", email: null, address: "Pasar Baru Blok C", city: "Bandung", province: "Jawa Barat", postal_code: "40111", payment_terms: "NET 14", categories: ["Bahan Kering", "Frozen"], is_active: true, created_at: iso(8) },
  { id: "demo-s4", supplier_code: "SUP-004", company_name: "Buah Segar Bandung", contact_person: "Dewi", phone_number: "081234567004", whatsapp_number: "6281234567004", email: "dewi@buahsegar.id", address: "Jl. Pasar Induk", city: "Bandung", province: "Jawa Barat", postal_code: "40614", payment_terms: "COD", categories: ["Buah"], is_active: true, created_at: iso(8) },
];

export const DEMO_PURCHASE_ORDERS: any[] = [
  { id: "demo-po1", po_number: "PO-2026-001", status: "SENT", po_date: "2026-10-10", created_at: iso(9, 0, 10), total_amount: 1200000, notes: "Pengiriman pagi", suppliers: { company_name: "PT Kopi Nusantara" }, po_items: [{ id: "demo-poi1", product_name: "Biji Kopi Espresso (kg)", qty_ordered: 10, unit: "kg", unit_price: 120000 }] },
  { id: "demo-po2", po_number: "PO-2026-002", status: "DRAFT", po_date: "2026-10-12", created_at: iso(10, 30, 12), total_amount: 450000, notes: null, suppliers: { company_name: "CV Susu Segar" }, po_items: [{ id: "demo-poi2", product_name: "Susu UHT Full Cream (liter)", qty_ordered: 30, unit: "liter", unit_price: 15000 }] },
  { id: "demo-po3", po_number: "PO-2026-003", status: "PARTIAL_RECEIVED", po_date: "2026-10-08", created_at: iso(14, 0, 8), total_amount: 680000, notes: "Sisa dikirim Senin", suppliers: { company_name: "Toko Bahan Kue Makmur" }, po_items: [{ id: "demo-poi3", product_name: "Tepung Terigu (kg)", qty_ordered: 40, unit: "kg", unit_price: 12000 }, { id: "demo-poi4", product_name: "Mentega (kg)", qty_ordered: 8, unit: "kg", unit_price: 25000 }] },
];

export const DEMO_GOODS_RECEIPTS: any[] = [
  { id: "demo-grn1", grn_number: "GRN-2026-001", created_at: iso(11, 0, 11), notes: "Barang lengkap", purchase_orders: { po_number: "PO-2026-000" }, grn_items: [{ id: "demo-gi1", product_name: "Biji Kopi Espresso (kg)", qty_received: 10, unit: "kg", unit_price: 120000, actual_cost: 120000 }] },
  { id: "demo-grn2", grn_number: "GRN-2026-002", created_at: iso(13, 30, 9), notes: "Sebagian", purchase_orders: { po_number: "PO-2026-003" }, grn_items: [{ id: "demo-gi2", product_name: "Tepung Terigu (kg)", qty_received: 30, unit: "kg", unit_price: 12000, actual_cost: 12000 }] },
];

// ======================= Operasional & Channel =======================
export const DEMO_TABLES: any[] = [
  { id: "demo-t1", tenant_id: "demo", branch_id: "demo-branch", table_number: "01", capacity: 2, qr_token: "demo-qr-01", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
  { id: "demo-t2", tenant_id: "demo", branch_id: "demo-branch", table_number: "02", capacity: 2, qr_token: "demo-qr-02", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
  { id: "demo-t3", tenant_id: "demo", branch_id: "demo-branch", table_number: "03", capacity: 4, qr_token: "demo-qr-03", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
  { id: "demo-t4", tenant_id: "demo", branch_id: "demo-branch", table_number: "04", capacity: 4, qr_token: "demo-qr-04", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
  { id: "demo-t5", tenant_id: "demo", branch_id: "demo-branch", table_number: "05", capacity: 6, qr_token: "demo-qr-05", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
  { id: "demo-t6", tenant_id: "demo", branch_id: "demo-branch", table_number: "06", capacity: 6, qr_token: "demo-qr-06", is_active: true, created_at: iso(8), needs_cleaning: false, cleaning_started_at: null },
];

export const DEMO_QRIS_ROWS: any[] = [
  { id: "demo-qr1", order_id: "demo-order-1", gross_amount: 66000, status: "paid", created_at: iso(11, 5), branch_name: "Cabang Utama" },
  { id: "demo-qr2", order_id: "demo-order-2", gross_amount: 44000, status: "paid", created_at: iso(11, 40), branch_name: "Cabang Utama" },
  { id: "demo-qr3", order_id: "demo-order-3", gross_amount: 88000, status: "pending", created_at: iso(12, 15), branch_name: "Cabang Utama" },
  { id: "demo-qr4", order_id: "demo-order-4", gross_amount: 52000, status: "expired", created_at: iso(12, 50), branch_name: "Cabang Utama" },
  { id: "demo-qr5", order_id: "demo-order-5", gross_amount: 30000, status: "paid", created_at: iso(13, 20), branch_name: "Cabang Utama" },
];

export function makeDemoReservations(base: Date = new Date()): any[] {
  const at = (h: number, m: number) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  return [
    { id: "demo-res1", tenant_id: "demo", branch_id: "demo-branch", table_id: "demo-t3", customer_name: "Keluarga Wijaya", customer_phone: "081200000001", party_size: 4, reservation_at: at(12, 0), duration_minutes: 90, reminder_window_minutes: 30, deposit_amount: 50000, deposit_status: "PAID", status: "CONFIRMED", notes: "Minta dekat jendela", order_id: null, created_by: null, created_at: at(9, 0), table_number: "03" },
    { id: "demo-res2", tenant_id: "demo", branch_id: "demo-branch", table_id: "demo-t1", customer_name: "Andi", customer_phone: "081200000002", party_size: 2, reservation_at: at(14, 30), duration_minutes: 60, reminder_window_minutes: 30, deposit_amount: 0, deposit_status: "NONE", status: "CONFIRMED", notes: null, order_id: null, created_by: null, created_at: at(10, 0), table_number: "01" },
    { id: "demo-res3", tenant_id: "demo", branch_id: "demo-branch", table_id: "demo-t5", customer_name: "Rapat Tim Marketing", customer_phone: "081200000003", party_size: 6, reservation_at: at(19, 0), duration_minutes: 120, reminder_window_minutes: 60, deposit_amount: 100000, deposit_status: "PENDING", status: "PENDING", notes: "Butuh proyektor", order_id: null, created_by: null, created_at: at(11, 0), table_number: "05" },
    { id: "demo-res4", tenant_id: "demo", branch_id: "demo-branch", table_id: null, customer_name: "Sinta", customer_phone: "081200000004", party_size: 3, reservation_at: at(20, 0), duration_minutes: 90, reminder_window_minutes: 30, deposit_amount: 0, deposit_status: "NONE", status: "PENDING", notes: null, order_id: null, created_by: null, created_at: at(13, 0), table_number: null },
  ];
}

export const DEMO_ONLINE_ORDERS: any[] = [
  { id: "demo-oo1", tenant_id: "demo", order_number: "GO-1001", channel: "gofood", status: "PREPARING", customer_name: "Pelanggan GoFood", created_at: iso(11, 15) },
  { id: "demo-oo2", tenant_id: "demo", order_number: "GR-1002", channel: "grabfood", status: "NEW", customer_name: "Pelanggan GrabFood", created_at: iso(11, 45) },
  { id: "demo-oo3", tenant_id: "demo", order_number: "SF-1003", channel: "shopeefood", status: "READY", customer_name: "Pelanggan ShopeeFood", created_at: iso(12, 5) },
  { id: "demo-oo4", tenant_id: "demo", order_number: "GO-1004", channel: "gofood", status: "SERVED", customer_name: "Pelanggan GoFood", created_at: iso(12, 30) },
  { id: "demo-oo5", tenant_id: "demo", order_number: "GR-1005", channel: "grabfood", status: "COMPLETED", customer_name: "Pelanggan GrabFood", created_at: iso(13, 0) },
  { id: "demo-oo6", tenant_id: "demo", order_number: "SF-1006", channel: "shopeefood", status: "CANCELLED", customer_name: "Pelanggan ShopeeFood", created_at: iso(13, 30) },
];

export const DEMO_COMMISSION: any[] = [
  { tenant_id: "demo", branch_id: "demo-branch", channel: "gofood", sale_date: "2026-10-14", total_orders: 12, gross_revenue: 480000, total_commission: 96000, net_revenue: 384000 },
  { tenant_id: "demo", branch_id: "demo-branch", channel: "grabfood", sale_date: "2026-10-14", total_orders: 9, gross_revenue: 360000, total_commission: 72000, net_revenue: 288000 },
  { tenant_id: "demo", branch_id: "demo-branch", channel: "shopeefood", sale_date: "2026-10-14", total_orders: 5, gross_revenue: 200000, total_commission: 40000, net_revenue: 160000 },
  { tenant_id: "demo", branch_id: "demo-branch", channel: "gofood", sale_date: "2026-10-13", total_orders: 10, gross_revenue: 400000, total_commission: 80000, net_revenue: 320000 },
  { tenant_id: "demo", branch_id: "demo-branch", channel: "grabfood", sale_date: "2026-10-13", total_orders: 7, gross_revenue: 280000, total_commission: 56000, net_revenue: 224000 },
];

// ======================= Analitik =======================
export const DEMO_GROWTH_SUMMARY: any = {
  total_customers: 128,
  repeat_customers: 47,
  repeat_visit_rate: 36.7,
  avg_ltv: 284000,
  inactive_customers_count: 23,
};

export const DEMO_CUSTOMER_STATS: any[] = [
  { tenant_id: "demo", member_id: "demo-mem1", customer_name: "Andi Pratama", customer_phone: "081200000011", visit_count: 22, lifetime_value: 1450000, first_visit_at: iso(10, 0, 1), last_visit_at: iso(12, 0, 13), days_since_last_visit: 1, is_repeat_customer: true },
  { tenant_id: "demo", member_id: "demo-mem2", customer_name: "Siti Rahma", customer_phone: "081200000012", visit_count: 18, lifetime_value: 1180000, first_visit_at: iso(10, 0, 3), last_visit_at: iso(11, 0, 12), days_since_last_visit: 2, is_repeat_customer: true },
  { tenant_id: "demo", member_id: "demo-mem3", customer_name: "Budi Santoso", customer_phone: "081200000013", visit_count: 15, lifetime_value: 960000, first_visit_at: iso(10, 0, 5), last_visit_at: iso(12, 30, 10), days_since_last_visit: 4, is_repeat_customer: true },
  { tenant_id: "demo", member_id: "demo-mem4", customer_name: "Dewi Lestari", customer_phone: "081200000014", visit_count: 12, lifetime_value: 720000, first_visit_at: iso(10, 0, 8), last_visit_at: iso(13, 0, 6), days_since_last_visit: 8, is_repeat_customer: true },
  { tenant_id: "demo", member_id: "demo-mem5", customer_name: "Rizky Nugroho", customer_phone: "081200000015", visit_count: 9, lifetime_value: 540000, first_visit_at: iso(10, 0, 10), last_visit_at: iso(13, 0, 2), days_since_last_visit: 12, is_repeat_customer: true },
];

export const DEMO_INACTIVE_CUSTOMERS: any[] = [
  { tenant_id: "demo", member_id: "demo-mem9", customer_name: "Hendra Wijaya", customer_phone: "081200000021", visit_count: 4, lifetime_value: 320000, first_visit_at: iso(10, 0, 2), last_visit_at: iso(10, 0, 20), days_since_last_visit: 45, is_repeat_customer: false },
  { tenant_id: "demo", member_id: "demo-mem10", customer_name: "Maya Anggraini", customer_phone: "081200000022", visit_count: 3, lifetime_value: 210000, first_visit_at: iso(10, 0, 6), last_visit_at: iso(10, 0, 25), days_since_last_visit: 38, is_repeat_customer: false },
  { tenant_id: "demo", member_id: "demo-mem11", customer_name: "Fajar Ramadhan", customer_phone: "081200000023", visit_count: 2, lifetime_value: 150000, first_visit_at: iso(10, 0, 9), last_visit_at: iso(10, 0, 28), days_since_last_visit: 31, is_repeat_customer: false },
];

export const DEMO_MENU_ENGINEERING_ROWS: any[] = [
  { product_id: "demo-p1", product_name: "Es Kopi Susu", category: "Kopi", price: 22000, cost_price: 9000, margin_amount: 13000, margin_pct: 59.1, qty_sold: 220, revenue: 4840000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "STAR", recommendation: "Menu favorit & margin tinggi. Pertahankan kualitas dan jadikan unggulan." },
  { product_id: "demo-p2", product_name: "Cappuccino", category: "Kopi", price: 26000, cost_price: 11000, margin_amount: 15000, margin_pct: 57.7, qty_sold: 140, revenue: 3640000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "STAR", recommendation: "Penjualan kuat dan margin baik. Jaga konsistensi." },
  { product_id: "demo-p3", product_name: "Americano", category: "Kopi", price: 20000, cost_price: 7000, margin_amount: 13000, margin_pct: 65, qty_sold: 90, revenue: 1800000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "PUZZLE", recommendation: "Margin tinggi tapi penjualan rendah. Promosikan lebih gencar." },
  { product_id: "demo-p4", product_name: "Matcha Latte", category: "Non-Kopi", price: 28000, cost_price: 14000, margin_amount: 14000, margin_pct: 50, qty_sold: 130, revenue: 3640000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "STAR", recommendation: "Performa baik di kedua sisi. Pertahankan." },
  { product_id: "demo-p5", product_name: "Teh Lemon", category: "Teh", price: 18000, cost_price: 6000, margin_amount: 12000, margin_pct: 66.7, qty_sold: 60, revenue: 1080000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "PUZZLE", recommendation: "Margin tinggi, volume rendah. Coba bundling." },
  { product_id: "demo-p6", product_name: "Croissant", category: "Makanan", price: 18000, cost_price: 9000, margin_amount: 9000, margin_pct: 50, qty_sold: 150, revenue: 2700000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "PLOWHORSE", recommendation: "Laris tapi margin tipis. Telaah biaya bahan." },
  { product_id: "demo-p7", product_name: "Kentang Goreng", category: "Makanan", price: 20000, cost_price: 10000, margin_amount: 10000, margin_pct: 50, qty_sold: 160, revenue: 3200000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "PLOWHORSE", recommendation: "Populer, margin sedang. Pertimbangkan kenaikan harga kecil." },
  { product_id: "demo-p8", product_name: "Air Mineral", category: "Minuman", price: 8000, cost_price: 3000, margin_amount: 5000, margin_pct: 62.5, qty_sold: 40, revenue: 320000, avg_qty_sold: 120, avg_margin_amount: 10000, classification: "DOG", recommendation: "Penjualan rendah & margin nominal kecil. Jaga sebagai pelengkap." },
];

export const DEMO_PRODUCT_PROFITABILITY: any[] = [
  { id: "demo-pp1", product_name: "Es Kopi Susu", category_name: "Kopi", total_qty_sold: 220, total_revenue: 4840000, total_cogs: 1980000, gross_profit: 2860000, profit_margin_pct: 59.1, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp2", product_name: "Cappuccino", category_name: "Kopi", total_qty_sold: 140, total_revenue: 3640000, total_cogs: 1540000, gross_profit: 2100000, profit_margin_pct: 57.7, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp3", product_name: "Matcha Latte", category_name: "Non-Kopi", total_qty_sold: 130, total_revenue: 3640000, total_cogs: 1820000, gross_profit: 1820000, profit_margin_pct: 50, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp4", product_name: "Kentang Goreng", category_name: "Makanan", total_qty_sold: 160, total_revenue: 3200000, total_cogs: 1600000, gross_profit: 1600000, profit_margin_pct: 50, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp5", product_name: "Croissant", category_name: "Makanan", total_qty_sold: 150, total_revenue: 2700000, total_cogs: 1350000, gross_profit: 1350000, profit_margin_pct: 50, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp6", product_name: "Americano", category_name: "Kopi", total_qty_sold: 90, total_revenue: 1800000, total_cogs: 630000, gross_profit: 1170000, profit_margin_pct: 65, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp7", product_name: "Teh Lemon", category_name: "Teh", total_qty_sold: 60, total_revenue: 1080000, total_cogs: 360000, gross_profit: 720000, profit_margin_pct: 66.7, tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-pp8", product_name: "Air Mineral", category_name: "Minuman", total_qty_sold: 40, total_revenue: 320000, total_cogs: 120000, gross_profit: 200000, profit_margin_pct: 62.5, tenant_id: "demo", branch_id: "demo-branch" },
];

const PEAK_SHAPE = [5, 3, 2, 2, 2, 4, 8, 14, 18, 16, 20, 26, 34, 30, 22, 18, 24, 30, 38, 44, 40, 30, 18, 9];
export const DEMO_PEAK_HOURS: any[] = PEAK_SHAPE.map((count, hour) => ({
  hour_of_day: hour,
  transaction_count: count,
  total_revenue: count * 42000,
  tenant_id: "demo",
  branch_id: "demo-branch",
}));

export const DEMO_WASTE_LOGS: any[] = [
  { id: "demo-w1", product_name: "Susu UHT Full Cream", waste_type: "EXPIRED", qty_wasted: 5, cost_price: 15000, total_loss_amount: 75000, notes: "Lewat tanggal", created_at: iso(9), tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-w2", product_name: "Croissant", waste_type: "DAMAGED", qty_wasted: 3, cost_price: 9000, total_loss_amount: 27000, notes: "Rusak saat pengiriman", created_at: iso(10, 30), tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-w3", product_name: "Biji Kopi Espresso", waste_type: "SPOILED", qty_wasted: 200, cost_price: 120, total_loss_amount: 24000, notes: "Lembab", created_at: iso(11), tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-w4", product_name: "Lemon", waste_type: "EXPIRED", qty_wasted: 400, cost_price: 25, total_loss_amount: 10000, notes: "Kering", created_at: iso(12, 15), tenant_id: "demo", branch_id: "demo-branch" },
  { id: "demo-w5", product_name: "Matcha Powder", waste_type: "SPOILED", qty_wasted: 50, cost_price: 350, total_loss_amount: 17500, notes: null, created_at: iso(13), tenant_id: "demo", branch_id: "demo-branch" },
];

// ======================= Ringkasan / Dashboard =======================
export const DEMO_DASH_OMZET: any[] = [
  { day: "Sen", date: "2026-10-08", omzet: 2450000, orders: 68 },
  { day: "Sel", date: "2026-10-09", omzet: 2680000, orders: 74 },
  { day: "Rab", date: "2026-10-10", omzet: 3120000, orders: 88 },
  { day: "Kam", date: "2026-10-11", omzet: 2980000, orders: 82 },
  { day: "Jum", date: "2026-10-12", omzet: 3560000, orders: 101 },
  { day: "Sab", date: "2026-10-13", omzet: 4240000, orders: 126 },
  { day: "Min", date: "2026-10-14", omzet: 3890000, orders: 112 },
];

export const DEMO_DASH_PEAK: any[] = [
  { hour: "08", orders: 14 },
  { hour: "10", orders: 22 },
  { hour: "12", orders: 34 },
  { hour: "14", orders: 26 },
  { hour: "16", orders: 20 },
  { hour: "18", orders: 30 },
  { hour: "20", orders: 44 },
];

export const DEMO_DASH_BEST: any[] = [
  { name: "Es Kopi Susu", value: 220 },
  { name: "Kentang Goreng", value: 160 },
  { name: "Croissant", value: 150 },
  { name: "Cappuccino", value: 140 },
  { name: "Matcha Latte", value: 130 },
];

export const DEMO_DASH_RECENT: any[] = [
  { id: "demo-dt1", invoice_number: "INV-2026-000128", total_amount: 66000, payment_method: "CASH", created_at: iso(13, 35), branch_name: "Cabang Utama" },
  { id: "demo-dt2", invoice_number: "INV-2026-000127", total_amount: 44000, payment_method: "QRIS", created_at: iso(13, 12), branch_name: "Cabang Utama" },
  { id: "demo-dt3", invoice_number: "INV-2026-000126", total_amount: 88000, payment_method: "QRIS", created_at: iso(12, 50), branch_name: "Cabang Utama" },
  { id: "demo-dt4", invoice_number: "INV-2026-000125", total_amount: 30000, payment_method: "CASH", created_at: iso(12, 20), branch_name: "Cabang Utama" },
  { id: "demo-dt5", invoice_number: "INV-2026-000124", total_amount: 52000, payment_method: "DEBIT", created_at: iso(11, 55), branch_name: "Cabang Utama" },
];

export const DEMO_DASH_TREND = 12.5;

// ======================= Riwayat Transaksi =======================
export const DEMO_TX_ROWS: any[] = [
  { id: "demo-tx1", invoice_number: "INV-2026-000128", total_amount: 66000, payment_method: "CASH", created_at: iso(13, 35), cashier_name: "Rina", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx2", invoice_number: "INV-2026-000127", total_amount: 44000, payment_method: "QRIS", created_at: iso(13, 12), cashier_name: "Rina", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx3", invoice_number: "INV-2026-000126", total_amount: 88000, payment_method: "QRIS", created_at: iso(12, 50), cashier_name: "Budi", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx4", invoice_number: "INV-2026-000125", total_amount: 30000, payment_method: "CASH", created_at: iso(12, 20), cashier_name: "Budi", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx5", invoice_number: "INV-2026-000124", total_amount: 52000, payment_method: "DEBIT", created_at: iso(11, 55), cashier_name: "Sari", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx6", invoice_number: "INV-2026-000123", total_amount: 26000, payment_method: "CASH", created_at: iso(11, 30), cashier_name: "Sari", branch_name: "Cabang Utama", refundStatus: "COMPLETED", refundedAmount: 26000 },
  { id: "demo-tx7", invoice_number: "INV-2026-000122", total_amount: 74000, payment_method: "QRIS", created_at: iso(11, 5), cashier_name: "Rina", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
  { id: "demo-tx8", invoice_number: "INV-2026-000121", total_amount: 38000, payment_method: "CASH", created_at: iso(10, 40), cashier_name: "Budi", branch_name: "Cabang Utama", refundStatus: null, refundedAmount: 0 },
];

// ======================= Log Pembatalan =======================
export const DEMO_LOG_ROWS: any[] = [
  { id: "demo-log1", action: "VOID_ORDER", entity_type: "order", entity_id: "demo-order-9", reason: "Pelanggan membatalkan seluruh pesanan", new_value: { amount: 88000 }, created_at: iso(13, 5), user_name: "Budi", branch_name: "Cabang Utama" },
  { id: "demo-log2", action: "VOID_ITEM", entity_type: "order_item", entity_id: "demo-oi-9", reason: "Salah input pesanan", new_value: { amount: 26000 }, created_at: iso(12, 40), user_name: "Rina", branch_name: "Cabang Utama" },
  { id: "demo-log3", action: "VOID_ORDER", entity_type: "order", entity_id: "demo-order-8", reason: "Pelanggan tidak jadi memesan", new_value: { amount: 44000 }, created_at: iso(11, 25), user_name: "Sari", branch_name: "Cabang Utama" },
  { id: "demo-log4", action: "VOID_ITEM", entity_type: "order_item", entity_id: "demo-oi-7", reason: "Menu kosong / habis", new_value: { amount: 18000 }, created_at: iso(10, 50), user_name: "Budi", branch_name: "Cabang Utama" },
];

// ======================= Target Bulanan =======================
const DAY_SHAPE = [820000, 910000, 760000, 1040000, 880000, 1180000, 1320000, 990000, 860000, 1120000, 1250000, 940000, 1080000, 1210000, 1010000];
export const DEMO_TARGET = 25000000;
export const DEMO_DAY_POINTS: any[] = DAY_SHAPE.map((omzet, i) => ({ day: i + 1, omzet }));
export const DEMO_TARGET_HISTORY: any[] = [
  { year: 2026, month: 10, target: 25000000, actual: 14730000 },
  { year: 2026, month: 9, target: 24000000, actual: 25100000 },
  { year: 2026, month: 8, target: 22000000, actual: 21850000 },
  { year: 2026, month: 7, target: 20000000, actual: 21400000 },
  { year: 2026, month: 6, target: 18000000, actual: 17900000 },
  { year: 2026, month: 5, target: 18000000, actual: 19200000 },
];

// ======================= Laporan PDF (baris mentah) =======================
export const DEMO_REPORT_TX: any[] = [
  { id: "demo-rtx1", total_amount: 66000, payment_method: "CASH", created_at: iso(13, 35), cashier_id: "demo-c1", profiles: { full_name: "Rina" } },
  { id: "demo-rtx2", total_amount: 44000, payment_method: "QRIS", created_at: iso(13, 12), cashier_id: "demo-c1", profiles: { full_name: "Rina" } },
  { id: "demo-rtx3", total_amount: 88000, payment_method: "QRIS", created_at: iso(12, 50), cashier_id: "demo-c2", profiles: { full_name: "Budi" } },
  { id: "demo-rtx4", total_amount: 30000, payment_method: "CASH", created_at: iso(12, 20), cashier_id: "demo-c2", profiles: { full_name: "Budi" } },
  { id: "demo-rtx5", total_amount: 52000, payment_method: "DEBIT", created_at: iso(11, 55), cashier_id: "demo-c3", profiles: { full_name: "Sari" } },
  { id: "demo-rtx6", total_amount: 26000, payment_method: "CASH", created_at: iso(11, 30), cashier_id: "demo-c3", profiles: { full_name: "Sari" } },
];

export const DEMO_REPORT_ITEMS: any[] = [
  { qty: 2, subtotal: 44000, product_id: "demo-p1", products: { name: "Es Kopi Susu", cost_price: 9000 } },
  { qty: 3, subtotal: 60000, product_id: "demo-p7", products: { name: "Kentang Goreng", cost_price: 10000 } },
  { qty: 1, subtotal: 26000, product_id: "demo-p2", products: { name: "Cappuccino", cost_price: 11000 } },
  { qty: 2, subtotal: 36000, product_id: "demo-p6", products: { name: "Croissant", cost_price: 9000 } },
  { qty: 3, subtotal: 84000, product_id: "demo-p4", products: { name: "Matcha Latte", cost_price: 14000 } },
  { qty: 4, subtotal: 72000, product_id: "demo-p5", products: { name: "Teh Lemon", cost_price: 6000 } },
];

export const DEMO_REPORT_OPNAME: any[] = [{ loss_value: 153500 }];
