import type { Product } from "@/lib/types";

export interface StockAwareProduct extends Product {
  track_stock?: boolean;
  stock_qty?: number;
  low_stock_threshold?: number;
}

export type OrderType = "dine-in" | "takeaway" | "delivery";

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  "dine-in": "Dine In",
  takeaway: "Take Away",
  delivery: "Delivery",
};

export interface CartModifier {
  modifier_id: string;
  name: string;
  price_adjustment: number;
}

export interface CartLine extends StockAwareProduct {
  cartItemId: string;
  variantId: string | null;
  variantName: string | null;
  modifiers: CartModifier[];
  unitPrice: number;
  qty: number;
  notes: string;
}

export interface SelectedCustomer {
  id: string;
  customer_name: string;
  loyaltyBalance?: number;
}

/**
 * Kalkulasi total tunggal, dipakai baik oleh <Cart> (display) maupun
 * page.tsx (checkout). PENTING: `servicePct`/`taxPct` default 0 — kalau
 * tenant mengaktifkannya, RPC checkout_transaction() saat ini TIDAK ikut
 * memotong/menambah service & pajak di server, jadi angka on-screen bisa
 * berbeda dari transactions.total_amount. Catatan yang sama sudah ada
 * untuk pointsDiscount. Untuk produksi yang butuh service/pajak presisi,
 * revisi RPC-nya agar menerima kedua parameter ini.
 */
export function computeCartTotals({
  subtotal,
  discountPct,
  voucherDiscount,
  pointsDiscount,
  servicePct = 0,
  taxPct = 0,
}: {
  subtotal: number;
  discountPct: number;
  voucherDiscount: number;
  pointsDiscount: number;
  servicePct?: number;
  taxPct?: number;
}) {
  const memberDiscount = Math.round((subtotal * discountPct) / 100);
  const afterDiscount = Math.max(0, subtotal - memberDiscount - voucherDiscount - pointsDiscount);
  const serviceCharge = Math.round((afterDiscount * servicePct) / 100);
  const taxAmount = Math.round(((afterDiscount + serviceCharge) * taxPct) / 100);
  const total = Math.max(0, afterDiscount + serviceCharge + taxAmount);
  return { memberDiscount, afterDiscount, serviceCharge, taxAmount, total };
}