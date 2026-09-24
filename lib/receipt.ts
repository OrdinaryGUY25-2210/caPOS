/**
 * lib/receipt.ts — util inti untuk fitur Struk/Printing (item 11).
 *
 * Satu sumber kebenaran untuk:
 *  - trigger cetak thermal 58mm/80mm (fix ukuran kertas via @page)
 *  - label Tipe Pesanan yang konsisten (POS pakai "dine-in", tabel order
 *    lama di DB pakai "dine_in" — helper ini menerima keduanya)
 *  - kalkulasi subtotal/total dari baris item struk
 *
 * `lib/utils.ts` tetap meng-ekspor ulang `printReceipt` dari sini supaya
 * import lama (`@/lib/utils`) di seluruh app tidak perlu diubah.
 */

import type { CartItem } from "./types";

export type ReceiptOrderType = "dine-in" | "takeaway" | "delivery" | "dine_in" | (string & {});

const ORDER_TYPE_LABELS: Record<string, string> = {
  "dine-in": "Dine In",
  dine_in: "Dine In",
  takeaway: "Bawa Pulang",
  delivery: "Delivery",
};

/** Label Indonesia untuk tipe pesanan; fallback ke nilai asli kalau tidak dikenal. */
export function getOrderTypeLabel(orderType?: ReceiptOrderType | null): string | null {
  if (!orderType) return null;
  return ORDER_TYPE_LABELS[orderType] ?? String(orderType);
}

/**
 * Cetak struk thermal (58mm/80mm) — window.print() polos membuat browser
 * memakai ukuran kertas default OS (biasanya A4/Letter Portrait), bukan
 * otomatis ke ukuran roll thermal, sehingga konten struk terpotong di
 * kanan/bawah walau printer POS-58/POS-80 sudah dipilih manual di driver.
 * @page tidak bisa di-scope per elemen lewat class biasa, jadi kita suntik
 * <style> dengan ukuran yang sesuai TEPAT sebelum window.print() dipanggil.
 *
 * Dipakai oleh setiap tempat yang merender <Receipt/> (id="receipt-print"):
 * CheckoutSuccess, Open Bill, riwayat transaksi, dsb.
 */
export function printReceipt(width: "58mm" | "80mm" = "80mm") {
  if (typeof document === "undefined") return; // guard SSR
  const styleId = "dynamic-receipt-page-size";
  let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = styleId;
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `@media print { @page { size: ${width} auto; margin: 0; } }`;
  window.print();
}

export interface ReceiptTotals {
  subtotal: number;
  discount: number;
  serviceAmount: number;
  taxAmount: number;
  total: number;
}

/**
 * Hitung ulang subtotal dari baris item (dipakai sebagai fallback kalau
 * caller tidak mengirim `subtotal` eksplisit — menjaga struk tetap benar
 * walau dipanggil dari tempat yang belum sempat dihitung total per komponen).
 */
export function computeReceiptTotals(params: {
  items: CartItem[];
  discount?: number;
  serviceAmount?: number;
  taxAmount?: number;
  total?: number;
}): ReceiptTotals {
  const subtotal = params.items.reduce(
    (sum, i) => sum + (i.unitPrice ?? i.price) * i.qty,
    0
  );
  const discount = params.discount ?? 0;
  const serviceAmount = params.serviceAmount ?? 0;
  const taxAmount = params.taxAmount ?? 0;
  const total = params.total ?? subtotal - discount + serviceAmount + taxAmount;
  return { subtotal, discount, serviceAmount, taxAmount, total };
}
