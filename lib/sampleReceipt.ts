import type { ReceiptData } from "@/components/Receipt";
import type { CartItem } from "@/lib/types";

/**
 * Data belanja kafe contoh untuk fitur "Tes Cetak Struk" di
 * /dashboard/settings/hardware — dipakai supaya test print benar-benar
 * mencetak struk yang terlihat seperti transaksi asli (bukan halaman
 * kosong/teks generik), sekaligus jadi cara owner mengecek hasil setelan
 * kwitansi (header/footer/lebar kertas) SEBELUM ada transaksi sungguhan.
 */
const SAMPLE_ITEMS: CartItem[] = [
  {
    id: "sample-item-1",
    tenant_id: "sample",
    name: "Kopi Susu Gula Aren",
    price: 18000,
    unitPrice: 18000,
    category: "Minuman",
    image_url: null,
    is_available: true,
    created_at: new Date().toISOString(),
    qty: 2,
  },
  {
    id: "sample-item-2",
    tenant_id: "sample",
    name: "Croissant Coklat",
    price: 22000,
    unitPrice: 22000,
    category: "Makanan",
    image_url: null,
    is_available: true,
    created_at: new Date().toISOString(),
    qty: 1,
  },
  {
    id: "sample-item-3",
    tenant_id: "sample",
    name: "Es Kopi Tubruk",
    price: 15000,
    unitPrice: 15000,
    category: "Minuman",
    image_url: null,
    is_available: true,
    created_at: new Date().toISOString(),
    qty: 1,
    variantName: "Large",
    modifiers: [{ modifier_id: "sample-mod-1", name: "Less Ice", price_adjustment: 0 }],
  },
];

export function buildSampleReceiptData(overrides: Partial<ReceiptData> = {}): ReceiptData {
  const subtotal = SAMPLE_ITEMS.reduce((sum, item) => sum + (item.unitPrice ?? item.price) * item.qty, 0);
  const discount = 2000;
  const cashReceived = 60000;

  return {
    cafeName: "Kafe Contoh",
    cafeAddress: "Jl. Merdeka No. 1, Palu",
    invoiceNumber: "TES-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-001",
    cashierName: "Tes Printer",
    items: SAMPLE_ITEMS,
    total: subtotal - discount,
    discount,
    paymentMethod: "tunai",
    createdAt: new Date().toISOString(),
    showWifi: false,
    width: "80mm",
    cashReceived,
    changeDue: cashReceived - (subtotal - discount),
    ...overrides,
  };
}
