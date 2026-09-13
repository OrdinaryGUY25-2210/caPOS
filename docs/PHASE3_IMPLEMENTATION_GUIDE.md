# caPOS Phase 3: Implementation Guide
## Supplier & Purchasing, Customer CRM & Loyalty, Promotion Engine, Advanced Analytics

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [Database Schema](#database-schema)
3. [Server Actions](#server-actions)
4. [Components](#components)
5. [Integration Guide](#integration-guide)
6. [API Endpoints](#api-endpoints)
7. [Configuration](#configuration)
8. [Best Practices](#best-practices)

---

## 🎯 Overview

Phase 3 menambahkan 4 modul utama ke caPOS:

### 1. **Supplier & Purchasing** (Pengadaan Bahan)
- Manajemen data pemasok (supplier)
- Pembuatan Purchase Order (PO) otomatis
- Goods Receipt Note (GRN) dengan update stok + HPP
- Perhitungan HPP menggunakan Weighted Average Cost (WAC)
- Tracking invoice dan pembayaran

### 2. **Customer CRM & Loyalty** (Manajemen Pelanggan)
- Database pelanggan terintegrasi per cabang/multi-cabang
- Profil pelanggan: history belanja, kunjungan, menu favorit
- Sistem poin loyalitas dengan tier member
- Earn points otomatis dari transaksi
- Redeem points untuk diskon/voucher

### 3. **Promotion Engine** (Mesin Promosi)
- Tipe promosi: Diskon %, Diskon Rp, BOGO, Bundle
- Aturan promosi fleksibel (min pembelian, max diskon, happy hour, kategori spesifik)
- Voucher/kupon dengan tracking redemption
- Validasi promosi real-time saat checkout

### 4. **Advanced F&B Analytics** (Laporan Analisis)
- Profitabilitas per produk (Revenue, HPP, Gross Profit, Margin%)
- Peak Hours Heatmap (transaksi per jam 00-23)
- Waste Loss Report (kerugian dari barang rusak/kadaluarsa)
- View terstruktur untuk laporan mendalam

---

## 🗄️ Database Schema

### Key Tables

#### Suppliers (Pemasok)
```sql
CREATE TABLE suppliers (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  supplier_code TEXT UNIQUE,
  company_name TEXT,
  contact_person TEXT,
  phone_number TEXT,
  whatsapp_number TEXT,
  address TEXT, city TEXT, province TEXT,
  payment_terms TEXT (e.g., "NET 30", "COD"),
  categories TEXT[] (e.g., ["Bahan Kering", "Daging"]),
  bank_account, bank_name, account_holder_name,
  is_active BOOLEAN DEFAULT true
);
```

#### Purchase Orders (PO)
```sql
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY,
  po_number TEXT UNIQUE,
  supplier_id UUID,
  branch_id UUID,
  status CHECK ('DRAFT', 'SENT', 'CONFIRMED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED'),
  subtotal_amount, tax_amount, total_amount NUMERIC,
  expected_delivery_date DATE,
  received_date DATE
);
```

#### PO Items & GRN
```sql
-- po_items: item detail dalam PO
CREATE TABLE po_items (
  id UUID,
  po_id UUID,
  product_id UUID,
  qty_ordered INT,
  qty_received INT,  -- updated saat GRN
  unit_price NUMERIC
);

-- goods_receipts: penerimaan barang fisik
CREATE TABLE goods_receipts (
  id UUID,
  po_id UUID,
  grn_number TEXT UNIQUE,
  receipt_date TIMESTAMPTZ,
  received_by UUID
);

-- grn_items: item penerimaan
CREATE TABLE grn_items (
  id UUID,
  grn_id UUID,
  po_item_id UUID,
  qty_received INT,
  unit_price NUMERIC,
  actual_cost NUMERIC  -- untuk WAC calculation
);
```

#### Customers & Loyalty
```sql
-- customers: master data pelanggan
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  customer_code TEXT UNIQUE,
  customer_name TEXT,
  phone_number, whatsapp_number, email TEXT,
  branch_id UUID,  -- NULL = multi-branch customer
  visit_count INT DEFAULT 0,
  lifetime_spend NUMERIC DEFAULT 0,
  last_visit_date TIMESTAMPTZ,
  tier_id UUID  -- referensi ke customer_tiers
);

-- customer_tiers: Silver, Gold, Platinum, dst
CREATE TABLE customer_tiers (
  id UUID,
  tier_name TEXT UNIQUE,  -- "Silver", "Gold", "Platinum"
  min_spend_monthly NUMERIC,
  min_spend_yearly NUMERIC,
  discount_percentage NUMERIC,
  points_multiplier NUMERIC,
  benefits TEXT[]
);

-- loyalty_config: konfigurasi per tenant
CREATE TABLE loyalty_config (
  id UUID,
  tenant_id UUID UNIQUE,
  points_per_rupiah NUMERIC (default 0.1),  -- Rp 10k = 1 poin
  points_expiry_days INT (default 365),
  min_points_for_redemption INT,
  is_enabled BOOLEAN DEFAULT true
);

-- loyalty_points_log: audit trail poin
CREATE TABLE loyalty_points_log (
  id UUID,
  customer_id UUID,
  transaction_id UUID,
  transaction_type CHECK ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST'),
  points_amount INT,  -- positif: earn, negatif: redeem
  balance_after INT,
  expiry_date DATE
);
```

#### Promotions & Vouchers
```sql
-- promotions: master promosi
CREATE TABLE promotions (
  id UUID,
  promo_name TEXT,
  promo_type CHECK ('PERCENTAGE', 'NOMINAL', 'BOGO', 'BUNDLE'),
  promo_code TEXT,
  is_active BOOLEAN,
  start_date, end_date TIMESTAMPTZ
);

-- promotion_rules: detail aturan promosi
CREATE TABLE promotion_rules (
  id UUID,
  promotion_id UUID,
  rule_type CHECK ('MIN_PURCHASE', 'MAX_DISCOUNT', 'CATEGORY', 'MEMBER_ONLY', 'HAPPY_HOUR'),
  rule_value TEXT
);

-- vouchers: kupon dengan redemption tracking
CREATE TABLE vouchers (
  id UUID,
  voucher_code TEXT UNIQUE,
  promotion_id UUID,
  discount_type CHECK ('PERCENTAGE', 'NOMINAL'),
  discount_value NUMERIC,
  max_discount_amount NUMERIC,
  min_purchase_amount NUMERIC,
  usage_limit INT,
  usage_count INT DEFAULT 0,
  expiry_date TIMESTAMPTZ,
  is_active BOOLEAN
);

-- voucher_redemptions: audit trail penggunaan
CREATE TABLE voucher_redemptions (
  id UUID,
  voucher_id UUID,
  transaction_id UUID,
  discount_given NUMERIC,
  redeemed_at TIMESTAMPTZ
);
```

#### Waste Logs
```sql
-- waste_logs: pencatatan kerugian barang
CREATE TABLE waste_logs (
  id UUID,
  product_id UUID,
  waste_type CHECK ('EXPIRED', 'DAMAGED', 'SPOILED', 'LOSS'),
  qty_wasted INT,
  cost_price NUMERIC,
  total_loss_amount NUMERIC,  -- qty * cost
  recorded_by UUID,
  created_at TIMESTAMPTZ
);
```

---

## 🔧 Server Actions (app/actions-phase3.ts)

### Supplier Management
```typescript
// Create supplier
await createSupplier(formData);

// Get suppliers
const result = await getSuppliers();

// Update supplier
await updateSupplier(supplierId, updates);
```

### Purchase Order
```typescript
// Create PO
const result = await createPurchaseOrder({
  supplier_id: string,
  branch_id?: string,
  expected_delivery_date?: string,
  items: Array<{
    product_id: string,
    qty_ordered: number,
    unit_price: number
  }>
});

// Create GRN (Goods Receipt)
const result = await createGoodsReceipt({
  po_id: string,
  items: Array<{
    po_item_id: string,
    product_id: string,
    qty_received: number,
    unit_price: number
  }>
});
```

**Otomasi GRN:**
- Update `po_items.qty_received`
- Insert ke `branch_ingredients_stock` dengan stok baru
- Hitung Weighted Average Cost (WAC) otomatis
- Update `purchase_orders.status` (PARTIAL_RECEIVED → RECEIVED)
- Log stock movement

### Customer Management
```typescript
// Create customer
await createCustomer(formData);

// Search customers
const result = await searchCustomers(query);

// Get customer profile + loyalty balance
const result = await getCustomerProfile(customerId);
```

### Loyalty Points
```typescript
// Record earn (called saat transaksi selesai)
await recordLoyaltyEarn(transactionId, customerId, transactionAmount);

// Redeem points for discount
await redeemLoyaltyPoints(customerId, pointsToRedeem, discountAmount);
```

### Promotions & Vouchers
```typescript
// Create promotion
await createPromotion({
  promo_name: string,
  promo_type: 'PERCENTAGE' | 'NOMINAL' | 'BOGO' | 'BUNDLE',
  description?: string,
  start_date: string,
  end_date?: string,
  rules?: Array<{ rule_type: string, rule_value: string }>
});

// Create voucher
await createVoucher({
  promotion_id: string,
  voucher_code: string,
  discount_type: 'PERCENTAGE' | 'NOMINAL',
  discount_value: number,
  min_purchase_amount?: number,
  usage_limit?: number,
  expiry_date?: string
});

// Validate & apply voucher
const result = await validateAndApplyVoucher(voucherCode, transactionAmount);
// Returns: { voucher_id, discount, finalAmount }
```

### Analytics
```typescript
// Get product profitability
const result = await getProductProfitability(branchId?, limit?);

// Get peak hours data
const result = await getPeakHoursAnalytics(branchId?);

// Get waste loss report
const result = await getWasteLossReport(branchId?, days?);

// Record waste loss
await recordWasteLoss({
  product_id: string,
  product_name: string,
  waste_type: 'EXPIRED' | 'DAMAGED' | 'SPOILED' | 'LOSS',
  qty_wasted: number,
  cost_price: number,
  notes?: string
});
```

---

## 🧩 Components

### 1. SupplierManagement.tsx
```typescript
<SupplierManagement />
```
**Features:**
- List supplier dengan search & filter
- Form CRUD supplier
- Kategori bahan checklist
- Kontak & bank account fields

**Integration di `/dashboard/purchasing/suppliers`**

### 2. PurchaseOrderDashboard.tsx
```typescript
<PurchaseOrderDashboard />
```
**Features:**
- Buat PO baru dengan line items
- Terima barang (GRN) dengan update stok otomatis
- View status PO (DRAFT → SENT → RECEIVED)
- Table item dengan harga satuan & subtotal

**Integration di `/dashboard/purchasing/purchase-orders`**

### 3. CustomerLoyaltyModal.tsx
```typescript
<CustomerLoyaltyModal 
  isOpen={boolean}
  onClose={() => void}
  onSelectCustomer={(customer) => void}
  transactionAmount={number}
/>
```
**Features:**
- Search pelanggan by nama/kode/nomor
- Lihat profil pelanggan + poin loyalitas
- Estimasi poin dari transaksi saat ini
- Create customer baru inline
- Preview recent transactions

**Integration di POS Checkout Modal**

### 4. PromotionBuilder.tsx
```typescript
<PromotionBuilder isOpen={boolean} onClose={() => void} />
```
**Features:**
- Form builder promosi dengan tipe fleksibel
- Add rules (min purchase, max discount, happy hour)
- Set periode aktif promosi
- Preview diskon yang akan diberikan

**Integration di `/dashboard/promotions`**

### 5. ProductProfitabilityAnalytics.tsx
```typescript
<ProductProfitabilityAnalytics />
```
**Features:**
- Table profitabilitas per produk
- Kolom: Revenue, HPP, Profit, Margin%
- Sort by profit / revenue / margin
- Summary cards (total revenue, COGS, profit, avg margin)

**Integration di `/dashboard/analytics/profitability`**

### 6. PeakHoursAnalytics.tsx
```typescript
<PeakHoursAnalytics />
```
**Features:**
- Heatmap visual jam sibuk (00:00-23:00)
- Bar chart dengan gradient opacity
- Identifikasi peak hours (transaksi + revenue)
- Summary cards: peak hour, total hours aktif

**Integration di `/dashboard/analytics/peak-hours`**

### 7. WasteLossReport.tsx
```typescript
<WasteLossReport />
```
**Features:**
- Form catat kerugian barang
- Tabel waste logs dengan tipe (expired, damaged, spoiled)
- Summary by waste type
- Total loss amount tracking

**Integration di `/dashboard/analytics/waste-loss`**

---

## 🚀 Integration Guide

### Step 1: Database Migration
```bash
# Jalankan phase3_schema.sql di Supabase SQL Editor
# 1. Copy semua isi phase3_schema.sql
# 2. Paste ke Supabase SQL Editor
# 3. Run (execution time ~30 detik)
```

### Step 2: Copy Files
```bash
# Copy server actions
cp app-actions-phase3.ts app/actions/

# Copy components
cp SupplierManagement.tsx components/purchasing/
cp PurchaseOrderDashboard.tsx components/purchasing/
cp CustomerLoyaltyModal.tsx components/crm/
cp PromotionBuilder.tsx components/promotions/
cp AnalyticsComponents.tsx components/analytics/
```

### Step 3: Create Routes

#### `/dashboard/purchasing/suppliers`
```typescript
'use client';
import { SupplierManagement } from '@/components/purchasing/SupplierManagement';

export default function SuppliersPage() {
  return <SupplierManagement />;
}
```

#### `/dashboard/purchasing/purchase-orders`
```typescript
'use client';
import { PurchaseOrderDashboard } from '@/components/purchasing/PurchaseOrderDashboard';

export default function POPage() {
  return <PurchaseOrderDashboard />;
}
```

#### `/dashboard/crm/customers`
```typescript
'use client';
import { CustomerManagement } from '@/components/crm/CustomerManagement';

export default function CustomersPage() {
  return <CustomerManagement />;
}
```

#### `/dashboard/analytics/profitability`
```typescript
'use client';
import { ProductProfitabilityAnalytics } from '@/components/analytics/AnalyticsComponents';

export default function ProfitabilityPage() {
  return <ProductProfitabilityAnalytics />;
}
```

#### `/dashboard/analytics/peak-hours`
```typescript
'use client';
import { PeakHoursAnalytics } from '@/components/analytics/AnalyticsComponents';

export default function PeakHoursPage() {
  return <PeakHoursAnalytics />;
}
```

#### `/dashboard/analytics/waste-loss`
```typescript
'use client';
import { WasteLossReport } from '@/components/analytics/AnalyticsComponents';

export default function WasteLossPage() {
  return <WasteLossReport />;
}
```

### Step 4: POS Integration (Loyalty & Promotions)

**Di `/app/pos/page.tsx`:**
```typescript
'use client';
import { useState } from 'react';
import { CustomerLoyaltyModal } from '@/components/crm/CustomerLoyaltyModal';
import { recordLoyaltyEarn } from '@/app/actions-phase3';

export default function POSPage() {
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactionTotal, setTransactionTotal] = useState(0);

  const handleSelectCustomer = async (customer) => {
    setSelectedCustomer(customer);
    
    // Record loyalty earn saat transaksi selesai
    if (customer && transactionTotal > 0) {
      await recordLoyaltyEarn(transactionId, customer.id, transactionTotal);
    }
  };

  return (
    <>
      {/* ... POS UI ... */}
      
      <button onClick={() => setShowCustomerModal(true)}>
        Tambah Pelanggan / Loyalitas
      </button>

      <CustomerLoyaltyModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSelectCustomer={handleSelectCustomer}
        transactionAmount={transactionTotal}
      />
    </>
  );
}
```

---

## 📡 API Endpoints (Optional: If using separate API)

```
POST /api/v1/suppliers               → Create supplier
GET  /api/v1/suppliers               → List suppliers
PUT  /api/v1/suppliers/:id           → Update supplier

POST /api/v1/purchase-orders         → Create PO
GET  /api/v1/purchase-orders         → List PO
PUT  /api/v1/purchase-orders/:id     → Update PO status

POST /api/v1/goods-receipts          → Create GRN (auto update stok)
GET  /api/v1/goods-receipts          → List GRN

POST /api/v1/customers               → Create customer
GET  /api/v1/customers/search        → Search customer
GET  /api/v1/customers/:id/profile   → Get customer + loyalty

POST /api/v1/loyalty/earn            → Record earn
POST /api/v1/loyalty/redeem          → Record redeem

POST /api/v1/promotions              → Create promotion
GET  /api/v1/promotions              → List promotions

POST /api/v1/vouchers                → Create voucher
POST /api/v1/vouchers/validate       → Validate & apply voucher

GET  /api/v1/analytics/profitability → Product profitability
GET  /api/v1/analytics/peak-hours    → Peak hours data
GET  /api/v1/analytics/waste-loss    → Waste loss report
```

---

## ⚙️ Configuration

### Loyalty Config (Per Tenant)

Set via admin panel atau hardcode saat setup:

```typescript
// Insert ke loyalty_config
INSERT INTO loyalty_config (
  tenant_id,
  points_per_rupiah,      -- 0.1 = Rp 10.000 → 1 poin
  points_expiry_days,     -- 365 hari
  min_points_for_redemption, -- 100 poin minimum
  is_enabled              -- true/false
) VALUES (...);
```

### Tier Configuration

```sql
INSERT INTO customer_tiers (tenant_id, tier_name, min_spend_monthly, discount_percentage)
VALUES
  (tenant_id, 'Silver', 500000, 5),
  (tenant_id, 'Gold', 2000000, 10),
  (tenant_id, 'Platinum', 5000000, 15);
```

### Promotion Rules Format

**MIN_PURCHASE:** `"500000"` (Rp 500k minimum)
**MAX_DISCOUNT:** `"50000"` (Diskon max Rp 50k)
**HAPPY_HOUR:** `"10:00-12:00,14:00-17:00"` (Multi time range)
**CATEGORY:** `"Coffee,Dessert"` (Comma-separated)
**MEMBER_ONLY:** `"true"` (Hanya untuk member)

---

## 💡 Best Practices

### 1. Weighted Average Cost (WAC) untuk HPP
```
Saat GRN diterima:
  WAC = (Current Stock × Current Cost + New Qty × New Price) / (Current Stock + New Qty)
  
Contoh:
  - Stock: 10 kg @ Rp 8.000/kg
  - Terima: 5 kg @ Rp 9.000/kg
  - WAC baru = (10 × 8.000 + 5 × 9.000) / 15 = Rp 8.333/kg
```

### 2. Loyalty Points Expiry
```typescript
// Set saat earn:
const expiry_date = CURRENT_DATE + INTERVAL '365 days';

// Auto-expire via scheduled job (optional):
UPDATE loyalty_points_log 
  SET transaction_type = 'EXPIRE' 
  WHERE expiry_date < CURRENT_DATE AND transaction_type = 'EARN';
```

### 3. Promotion Validation Flow
```
1. User input promo code di checkout
2. Validate: is_active, belum expired, usage limit
3. Check rules: min purchase, time window (happy hour)
4. Calculate discount (% atau nominal)
5. Check max_discount_amount
6. Apply discount ke final total
7. Increment usage_count + create redemption log
```

### 4. Performance Optimization
```sql
-- Untuk analytics yang heavy:
-- CREATE MATERIALIZED VIEW product_profitability_summary
-- REFRESH setiap jam via scheduled job

-- Index untuk profitability query:
CREATE INDEX idx_transactions_created_date 
  ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_transaction_items_product 
  ON transaction_items(product_id);
```

### 5. Security: RLS (Row Level Security)
```sql
-- Semua tabel Phase 3 sudah protected RLS:
-- - Supplier: visible hanya ke tenant owner
-- - Customer: visible per tenant
-- - Loyalty: visible per customer + tenant
-- - Promotion: visible per tenant
```

### 6. Offline Support (Mobile)
```typescript
// Sync GRN & customer data ke local DB:
const db = new Dexie('caposDB');
db.table('grn_offline').add({
  grn_data,
  status: 'pending_sync',
  created_at: new Date()
});

// Saat online, bulk insert + update
```

---

## 📊 Laporan & KPI

### Key Metrics
1. **Product Margin:** Gross Profit / Revenue (target: 60-70%)
2. **Waste Loss Percentage:** Total Waste / Total COGS (target: < 2%)
3. **Peak Hours Revenue:** Revenue during peak hours vs average
4. **Customer Lifetime Value:** Total spend × repeat rate
5. **Loyalty Program ROI:** Points issued vs redemption cost

### Dashboard Recommendations
- Daily: Peak hours, waste loss
- Weekly: Product profitability, customer acquisition
- Monthly: Supplier performance, margin trend, loyalty engagement

---

## 🔗 Dependencies & Compatibility

**Requires:**
- Next.js 14+ (App Router)
- Supabase (PostgreSQL)
- React 18+
- TypeScript

**Backward Compatible:**
- Phase 1 schema (profiles, products, transactions, memberships)
- Phase 2 schema (kitchen stations, orders, KDS)
- Existing POS functionality tetap berfungsi normal

---

## ❓ FAQ

**Q: Bagaimana jika HPP berubah setelah receipt?**
A: Gunakan Weighted Average Cost saat GRN. HPP history dicatat di grn_items.

**Q: Bisa set poin rate berbeda per produk?**
A: Bisa, extend loyalty_config dengan product_id_exceptions JSONB.

**Q: Expired poin otomatis dihapus?**
A: Tidak dihapus, ditandai EXPIRE di log. Tetap visible di audit trail.

**Q: Promosi bisa stack/berlapis?**
A: Single promo per transaksi. Jika ingin multi-layer, buat rule dalam satu promo.

**Q: GRN bisa partial (qty < PO)?**
A: Ya, PO status jadi PARTIAL_RECEIVED. Bisa receipt lagi sebelum RECEIVED.

---

## 📞 Support & Issues

Untuk issues atau questions:
1. Check database constraints & RLS policies
2. Verify tenant_id di setiap query
3. Enable Supabase logging untuk SQL errors
4. Test di development environment dulu

---

**Version:** Phase 3 v1.0
**Last Updated:** September 2026
**Maintained by:** caPOS Development Team
