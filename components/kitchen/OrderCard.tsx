"use client";

import { useEffect, useState } from "react";
import { Clock, Utensils, ShoppingBag, Bike, Printer, XCircle } from "lucide-react";
import type { OrderWithItems, OrderStatus } from "@/lib/types";
import { cx, formatItemConfigLine } from "@/lib/utils";

const ORDER_TYPE_ICON: Record<string, typeof Utensils> = {
  dine_in: Utensils,
  takeaway: ShoppingBag,
  delivery: Bike,
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

// Timestamp yang jadi acuan "mulai menghitung" durasi penyiapan tergantung
// status saat ini — supaya timer di card mencerminkan tahap yang sedang
// berjalan, bukan total sejak order dibuat.
function stageStartedAt(order: OrderWithItems): string {
  switch (order.status) {
    case "NEW":
      return order.created_at;
    case "ACCEPTED":
      return order.accepted_at ?? order.created_at;
    case "PREPARING":
      return order.preparing_at ?? order.created_at;
    case "READY":
      return order.ready_at ?? order.created_at;
    case "SERVED":
      return order.served_at ?? order.created_at;
    default:
      return order.created_at;
  }
}

function useElapsed(startIso: string) {
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startIso]);
  return seconds;
}

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Warna kartu berubah sesuai lama waktu berjalan di tahap saat ini —
// indikator visual cepat buat dapur: hijau = baru, kuning = mulai lama,
// merah = sudah lewat ambang wajar dan perlu diprioritaskan.
function urgencyClass(seconds: number, status: OrderStatus) {
  if (status === "SERVED" || status === "COMPLETED" || status === "CANCELLED") {
    return "border-neutral-200 bg-white";
  }
  if (seconds >= 900) return "border-urgent bg-red-50"; // >= 15 menit
  if (seconds >= 480) return "border-amber-400 bg-amber-50"; // >= 8 menit
  return "border-primary/30 bg-white";
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Baru Masuk",
  ACCEPTED: "Diterima",
  PREPARING: "Sedang Disiapkan",
  READY: "Siap Disajikan",
  SERVED: "Sudah Disajikan",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const NEXT_ACTION: Partial<Record<OrderStatus, { label: string; next: OrderStatus; className: string }>> = {
  NEW: { label: "TERIMA", next: "ACCEPTED", className: "bg-primary hover:bg-primary-dark" },
  ACCEPTED: { label: "MULAI PENYIAPAN", next: "PREPARING", className: "bg-amber-500 hover:bg-amber-600" },
  PREPARING: { label: "SIAP DISAJIKAN", next: "READY", className: "bg-emerald-600 hover:bg-emerald-700" },
  READY: { label: "SUDAH DISAJIKAN", next: "SERVED", className: "bg-neutral-800 hover:bg-neutral-900" },
};

export default function OrderCard({
  order,
  cashierName,
  onAdvanceStatus,
  onCancel,
  onReprint,
  canReprint,
}: {
  order: OrderWithItems;
  cashierName: string;
  onAdvanceStatus: (orderId: string, nextStatus: OrderStatus) => void;
  onCancel: (orderId: string) => void;
  onReprint: (order: OrderWithItems) => void;
  canReprint: boolean;
}) {
  const elapsed = useElapsed(stageStartedAt(order));
  const TypeIcon = ORDER_TYPE_ICON[order.order_type] ?? Utensils;
  const action = NEXT_ACTION[order.status];
  const isActive = !["SERVED", "COMPLETED", "CANCELLED"].includes(order.status);

  return (
    <div className={cx("rounded-2xl border-2 p-4 shadow-sm flex flex-col gap-3 transition-colors", urgencyClass(elapsed, order.status))}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-lg text-neutral-900">{order.order_number}</p>
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 mt-0.5">
            <TypeIcon size={13} />
            <span>{ORDER_TYPE_LABEL[order.order_type]}</span>
            {order.table_number && <span>· Meja {order.table_number}</span>}
            {order.customer_name && <span>· {order.customer_name}</span>}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">Kasir: {cashierName}</p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span
            className={cx(
              "flex items-center gap-1 text-xs font-mono font-semibold px-2 py-1 rounded-full",
              elapsed >= 900 && isActive ? "bg-urgent text-white" : elapsed >= 480 && isActive ? "bg-amber-500 text-white" : "bg-neutral-100 text-neutral-600"
            )}
          >
            <Clock size={12} />
            {formatDuration(elapsed)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">{STATUS_LABEL[order.status]}</span>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-b border-dashed border-neutral-200 py-2">
        {order.order_items.map((item) => {
          const configLine = formatItemConfigLine(item);
          return (
            <div key={item.id} className="text-sm">
              <span className="font-semibold text-neutral-900">{item.qty}x {item.product_name}</span>
              {configLine && (
                <p className="text-xs text-primary-dark pl-4">↳ {configLine}</p>
              )}
            </div>
          );
        })}
      </div>

      {order.notes && <p className="text-xs text-neutral-500 italic">Catatan: {order.notes}</p>}

      <div className="flex items-center gap-2">
        {action && (
          <button
            onClick={() => onAdvanceStatus(order.id, action.next)}
            className={cx("flex-1 text-white text-sm font-bold py-2.5 rounded-xl transition-colors", action.className)}
          >
            {action.label}
          </button>
        )}

        {canReprint && (
          <button
            onClick={() => onReprint(order)}
            title="Cetak Ulang Tiket"
            className="shrink-0 w-10 h-10 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-500 hover:bg-neutral-100"
          >
            <Printer size={16} />
          </button>
        )}

        {isActive && order.status !== "SERVED" && (
          <button
            onClick={() => onCancel(order.id)}
            title="Batalkan Pesanan"
            className="shrink-0 w-10 h-10 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-400 hover:text-urgent hover:bg-red-50"
          >
            <XCircle size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
