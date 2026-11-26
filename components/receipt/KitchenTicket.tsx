"use client";

import type { CartItem } from "@/lib/types";

export interface KitchenTicketData {
  /** Nomor order/invoice — ditulis besar supaya mudah dipanggil/dicocokkan. */
  invoiceNumber: string;
  cashierName: string;
  createdAt: string;
  items: CartItem[];
  /** Nomor/nama meja (opsional). */
  tableNumber?: string | number | null;
  /** Mis. "Dine In", "Bawa Pulang" (opsional). */
  orderTypeLabel?: string | null;
  /** Catatan untuk dapur (opsional). */
  note?: string | null;
  width: "58mm" | "80mm";
  /** Tandai sebagai cetak ulang. */
  reprint?: boolean;
}

/**
 * Tiket untuk dapur/bar — TANPA harga. Fokus: nomor order besar, jumlah +
 * nama menu besar, varian/topping jelas, jam masuk. Dirender dengan
 * id="kitchen-print" dan dicetak lewat printReceipt(width, "kitchen").
 */
export default function KitchenTicket({ data }: { data: KitchenTicketData }) {
  const totalQty = data.items.reduce((s, i) => s + i.qty, 0);
  const meta = [data.orderTypeLabel, data.tableNumber ? `Meja ${data.tableNumber}` : null].filter(Boolean).join(" · ");
  const time = new Date(data.createdAt).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });

  return (
    <div
      id="kitchen-print"
      className="bg-white font-mono text-[12px] leading-tight p-3 mx-auto text-black"
      style={{ width: data.width === "58mm" ? "58mm" : "80mm" }}
    >
      <p className="text-center font-bold text-base tracking-wide">TIKET KITCHEN</p>
      {data.reprint && <p className="text-center font-bold">** CETAK ULANG **</p>}
      <div className="border-t-2 border-dashed border-black my-1" />

      <p className="text-center font-bold text-xl break-words">{data.invoiceNumber}</p>
      {meta && <p className="text-center font-bold text-sm">{meta}</p>}
      <p className="text-center text-[11px]">
        {time} · Kasir: {data.cashierName}
      </p>
      <div className="border-t-2 border-dashed border-black my-1" />

      {data.items.length === 0 ? (
        <p className="text-center py-2">Tidak ada item</p>
      ) : (
        data.items.map((item) => {
          const config = [item.variantName, ...(item.modifiers ?? []).map((m) => m.name)].filter(Boolean);
          return (
            <div key={item.cartItemId ?? item.id} className="mb-2">
              <p className="font-bold text-sm break-words">
                {item.qty}x {item.name}
              </p>
              {config.length > 0 && <p className="pl-4 text-[12px] font-semibold break-words">+ {config.join(", ")}</p>}
            </div>
          );
        })
      )}

      <div className="border-t-2 border-dashed border-black my-1" />
      {data.note && (
        <p className="font-bold break-words mb-1">
          CATATAN: <span className="font-normal">{data.note}</span>
        </p>
      )}
      <p className="text-center font-bold">Total: {totalQty} item</p>
    </div>
  );
}
