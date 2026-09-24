"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { getOrderTypeLabel, computeReceiptTotals, type ReceiptOrderType } from "@/lib/receipt";
import type { CartItem } from "@/lib/types";

export interface ReceiptData {
  // --- Identitas kafe ---
  cafeName: string;
  cafeAddress?: string | null;
  /** Nomor telepon/WA kafe — ditampilkan di header di bawah alamat. */
  cafePhone?: string | null;
  /** URL logo kafe (Supabase Storage, opsional — lihat Pengaturan Kafe). */
  cafeLogoUrl?: string | null;

  // --- Info transaksi ---
  invoiceNumber: string;
  cashierName: string;
  createdAt: string;
  /** Nomor/nama meja — kosongkan untuk order tanpa meja (takeaway/delivery). */
  tableNumber?: string | number | null;
  orderType?: ReceiptOrderType | null;
  /** Override label tipe pesanan siap-pakai (mis. "Dine In · Meja 4"). Kalau kosong, dibangun otomatis dari orderType + tableNumber. */
  orderTypeLabel?: string | null;

  // --- Item ---
  items: CartItem[];
  /** Subtotal eksplisit (opsional) — kalau tidak dikirim, dihitung otomatis dari items. */
  subtotal?: number;

  // --- Diskon / pajak / service ---
  discount: number;
  /** Label diskon, mis. "Diskon Member", "Voucher HEMAT10". Default "Diskon". */
  discountLabel?: string;
  servicePct?: number;
  serviceAmount?: number;
  taxPct?: number;
  taxAmount?: number;

  // --- Total & pembayaran ---
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  changeDue?: number;

  // --- Footer ---
  showWifi: boolean;
  wifiSsid?: string;
  wifiPassword?: string;
  footerNote?: string;

  width: "58mm" | "80mm";
}

function ItemConfigLine({ item }: { item: CartItem }) {
  const parts = [item.variantName, ...(item.modifiers ?? []).map((m) => m.name)].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="pl-2 text-[10px] text-neutral-700 break-words">↳ {parts.join(", ")}</p>;
}

export default function Receipt({ data }: { data: ReceiptData }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const { subtotal, discount, serviceAmount, taxAmount, total } = computeReceiptTotals({
    items: data.items,
    discount: data.discount,
    serviceAmount: data.serviceAmount,
    taxAmount: data.taxAmount,
    total: data.total,
  });
  // Kalau caller mengirim subtotal eksplisit (mis. sudah dibulatkan di server), pakai itu.
  const displaySubtotal = data.subtotal ?? subtotal;

  const orderTypeLabel =
    data.orderTypeLabel ??
    [getOrderTypeLabel(data.orderType), data.tableNumber ? `Meja ${data.tableNumber}` : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <div
      id="receipt-print"
      className="bg-white font-mono text-[11px] leading-tight p-3 mx-auto text-black"
      style={{ width: data.width === "58mm" ? "58mm" : "80mm" }}
    >
      {/* --- Header: logo, nama, alamat, kontak --- */}
      <div className="text-center mb-2">
        {data.cafeLogoUrl && !logoFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.cafeLogoUrl}
            alt=""
            className="w-14 h-14 object-contain mx-auto mb-1"
            onError={() => setLogoFailed(true)}
          />
        )}
        <p className="font-bold text-sm break-words">{data.cafeName}</p>
        {data.cafeAddress && <p className="break-words">{data.cafeAddress}</p>}
        {data.cafePhone && <p>{data.cafePhone}</p>}
      </div>
      <div className="border-t border-dashed border-black my-1" />

      {/* --- Info transaksi: no, kasir, waktu, meja/tipe order --- */}
      <p>No: {data.invoiceNumber}</p>
      <p>Kasir: {data.cashierName}</p>
      <p>{new Date(data.createdAt).toLocaleString("id-ID")}</p>
      {orderTypeLabel && <p>{orderTypeLabel}</p>}
      <div className="border-t border-dashed border-black my-1" />

      {/* --- Daftar produk --- */}
      {data.items.length === 0 ? (
        <p className="text-center text-neutral-500 py-2">Tidak ada item</p>
      ) : (
        data.items.map((item) => {
          const unitPrice = item.unitPrice ?? item.price;
          return (
            <div key={item.cartItemId ?? item.id} className="mb-1">
              <p className="break-words">{item.name}</p>
              <ItemConfigLine item={item} />
              <div className="flex justify-between gap-2">
                <span>
                  {item.qty} x {formatRupiah(unitPrice)}
                </span>
                <span className="whitespace-nowrap">{formatRupiah(unitPrice * item.qty)}</span>
              </div>
            </div>
          );
        })
      )}

      <div className="border-t border-dashed border-black my-1" />

      {/* --- Ringkasan: subtotal, diskon, service, pajak, total --- */}
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatRupiah(displaySubtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between">
          <span>{data.discountLabel ?? "Diskon"}</span>
          <span>-{formatRupiah(discount)}</span>
        </div>
      )}
      {serviceAmount > 0 && (
        <div className="flex justify-between">
          <span>Service{data.servicePct ? ` (${data.servicePct}%)` : ""}</span>
          <span>{formatRupiah(serviceAmount)}</span>
        </div>
      )}
      {taxAmount > 0 && (
        <div className="flex justify-between">
          <span>Pajak{data.taxPct ? ` (${data.taxPct}%)` : ""}</span>
          <span>{formatRupiah(taxAmount)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-sm mt-1">
        <span>TOTAL</span>
        <span>{formatRupiah(total)}</span>
      </div>

      {/* --- Pembayaran --- */}
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
      <p className="text-center break-words">{data.footerNote ?? "Terima kasih atas kunjungan Anda!"}</p>

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
