"use client";

import { formatRupiah } from "@/lib/utils";
import type { CartItem } from "@/lib/types";

export interface ReceiptData {
  cafeName: string;
  cafeAddress?: string;
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
  width: "58mm" | "80mm";
}

export default function Receipt({ data }: { data: ReceiptData }) {
  const subtotal = data.items.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <div
      id="receipt-print"
      className="bg-white font-mono text-[11px] leading-tight p-3 mx-auto"
      style={{ width: data.width === "58mm" ? "58mm" : "80mm" }}
    >
      <div className="text-center mb-2">
        <p className="font-bold text-sm">{data.cafeName}</p>
        {data.cafeAddress && <p>{data.cafeAddress}</p>}
      </div>
      <div className="border-t border-dashed border-black my-1" />
      <p>No: {data.invoiceNumber}</p>
      <p>Kasir: {data.cashierName}</p>
      <p>{new Date(data.createdAt).toLocaleString("id-ID")}</p>
      <div className="border-t border-dashed border-black my-1" />

      {data.items.map((item) => (
        <div key={item.id} className="mb-1">
          <p>{item.name}</p>
          <div className="flex justify-between">
            <span>{item.qty} x {formatRupiah(item.price)}</span>
            <span>{formatRupiah(item.price * item.qty)}</span>
          </div>
        </div>
      ))}

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

      <div className="border-t border-dashed border-black my-1" />
      <p className="text-center">Terima kasih atas kunjungan Anda!</p>

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
