"use client";

import { formatRupiah } from "@/lib/utils";
import type { CartItem } from "@/lib/types";

export interface ReceiptData {
  cafeName: string;
  cafeAddress?: string;
  /** URL logo kafe (Supabase Storage, opsional — lihat Pengaturan Kafe). */
  cafeLogoUrl?: string | null;
  invoiceNumber: string;
  cashierName: string;
  items: CartItem[];
  total: number;
  discount: number;
  paymentMethod: string;
  createdAt: string;
  showWifi: boolean;
  wifiSsid?: string;
  wifiPassword?: string;
  /** Teks custom di atas nama kafe — diatur di /dashboard/settings/receipt (migration_018). */
  headerText?: string | null;
  /** Teks custom di footer, sebelum baris "powered by caPOS" — diatur di /dashboard/settings/receipt. */
  footerText?: string | null;
  width: "58mm" | "80mm";
  /** Uang diterima & kembalian (khusus metode "cash") — Requirement 2. */
  cashReceived?: number;
  changeDue?: number;
}

export default function Receipt({ data }: { data: ReceiptData }) {
  const subtotal = data.items.reduce((sum, i) => sum + (i.unitPrice ?? i.price) * i.qty, 0);

  return (
    <div
      id="receipt-print"
      className="bg-white font-mono text-[11px] leading-tight p-3 mx-auto"
      style={{ width: data.width === "58mm" ? "58mm" : "80mm" }}
    >
      {data.headerText && <p className="text-center text-[10px] mb-1 whitespace-pre-wrap">{data.headerText}</p>}
      <div className="text-center mb-2">
        {data.cafeLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.cafeLogoUrl} alt="" className="w-14 h-14 object-contain mx-auto mb-1" />
        )}
        <p className="font-bold text-sm">{data.cafeName}</p>
        {data.cafeAddress && <p>{data.cafeAddress}</p>}
      </div>
      <div className="border-t border-dashed border-black my-1" />
      <p>No: {data.invoiceNumber}</p>
      <p>Kasir: {data.cashierName}</p>
      <p>{new Date(data.createdAt).toLocaleString("id-ID")}</p>
      <div className="border-t border-dashed border-black my-1" />

      {data.items.map((item) => {
        const unitPrice = item.unitPrice ?? item.price;
        const configParts = [item.variantName, ...(item.modifiers ?? []).map((m) => m.name)].filter(Boolean);
        return (
          <div key={item.cartItemId ?? item.id} className="mb-1">
            <p>{item.name}</p>
            {configParts.length > 0 && <p className="pl-2 text-[10px]">↳ {configParts.join(", ")}</p>}
            <div className="flex justify-between">
              <span>{item.qty} x {formatRupiah(unitPrice)}</span>
              <span>{formatRupiah(unitPrice * item.qty)}</span>
            </div>
          </div>
        );
      })}

      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatRupiah(subtotal)}</span>
      </div>
      {data.discount > 0 && (
        <div className="flex justify-between">
          <span>Diskon Member</span>
          <span>-{formatRupiah(data.discount)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-sm mt-1">
        <span>TOTAL</span>
        <span>{formatRupiah(data.total)}</span>
      </div>
      <p className="mt-1">Bayar: {data.paymentMethod.toUpperCase()}</p>
      {typeof data.cashReceived === "number" && (
        <div className="flex justify-between">
          <span>Uang Diterima</span>
          <span>{formatRupiah(data.cashReceived)}</span>
        </div>
      )}
      {typeof data.changeDue === "number" && (
        <div className="flex justify-between font-bold">
          <span>Kembalian</span>
          <span>{formatRupiah(data.changeDue)}</span>
        </div>
      )}

      <div className="border-t border-dashed border-black my-1" />
      <p className="text-center">Terima kasih atas kunjungan Anda!</p>
      {data.footerText && <p className="text-center whitespace-pre-wrap mt-1">{data.footerText}</p>}

      {data.showWifi && data.wifiSsid && (
        <>
          <div className="border-t border-dashed border-black my-1" />
          <p className="text-center">WiFi Kafe</p>
          <p className="text-center">SSID: {data.wifiSsid}</p>
          <p className="text-center">Pass: {data.wifiPassword}</p>
        </>
      )}

      <p className="text-center mt-2 text-[9px]">powered by caPOS — Studio D13</p>
    </div>
  );
}
