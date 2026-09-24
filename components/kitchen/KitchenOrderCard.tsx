"use client";

import {
  AlertTriangle,
  MapPin,
  UtensilsCrossed,
  ShoppingBag,
  Bike,
  Printer,
  X,
  ChevronRight,
} from "lucide-react";
import { cx } from "@/lib/utils";
import KitchenTimer, { getKitchenPriority } from "./KitchenTimer";
import KitchenItem from "./KitchenItem";
import type { KitchenStation, OrderStatus, OrderWithItems } from "@/lib/types";

const STATUS_META: Record<
  OrderStatus,
  { accent: string; next?: OrderStatus; nextLabel?: string; nextTone?: string }
> = {
  NEW: { accent: "bg-blue-500", next: "ACCEPTED", nextLabel: "Terima", nextTone: "bg-primary hover:bg-primary-dark" },
  ACCEPTED: { accent: "bg-indigo-500", next: "PREPARING", nextLabel: "Mulai Siapkan", nextTone: "bg-amber-500 hover:bg-amber-600" },
  PREPARING: { accent: "bg-amber-500", next: "READY", nextLabel: "Tandai Siap", nextTone: "bg-emerald-500 hover:bg-emerald-600" },
  READY: { accent: "bg-emerald-500", next: "SERVED", nextLabel: "Sudah Disajikan", nextTone: "bg-neutral-700 hover:bg-neutral-800" },
  SERVED: { accent: "bg-neutral-400" },
  COMPLETED: { accent: "bg-neutral-400" },
  CANCELLED: { accent: "bg-urgent" },
};

const ORDER_TYPE_META: Record<string, { label: string; Icon: typeof UtensilsCrossed }> = {
  "dine-in": { label: "Dine In", Icon: UtensilsCrossed },
  takeaway: { label: "Take Away", Icon: ShoppingBag },
  delivery: { label: "Delivery", Icon: Bike },
};

export default function KitchenOrderCard({
  order,
  stations,
  cashierName,
  onAdvanceStatus,
  onCancel,
  onReprint,
}: {
  order: OrderWithItems;
  stations: KitchenStation[];
  cashierName: string;
  onAdvanceStatus: (orderId: string, next: OrderStatus) => void;
  onCancel: (orderId: string) => void;
  onReprint: (order: OrderWithItems) => void;
}) {
  const meta = STATUS_META[order.status];
  const priority = getKitchenPriority(order.created_at);
  const orderType = (order as any).order_type as string | undefined;
  const typeMeta = orderType ? ORDER_TYPE_META[orderType] : null;
  const TypeIcon = typeMeta?.Icon ?? UtensilsCrossed;
  const tableNumber = (order as any).table_number as string | undefined;

  const stationNameById = new Map(stations.map((s) => [s.id, s.name]));
  const totalQty = order.order_items.reduce((s, i) => s + i.qty, 0);
  const isDone = order.status === "SERVED" || order.status === "COMPLETED" || order.status === "CANCELLED";

  return (
    <article
      className={cx(
        "bg-white rounded-2xl border shadow-sm overflow-hidden transition-all",
        priority === "urgent" && !isDone && "border-urgent ring-2 ring-red-200",
        priority === "warning" && !isDone && "border-amber-300",
        priority === "normal" && "border-neutral-200",
        isDone && "opacity-60"
      )}
      aria-label={`Pesanan ${order.order_number}`}
    >
      <header className="px-3 py-2 flex items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cx("w-1.5 h-8 rounded-full shrink-0", meta.accent)} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900 truncate font-mono">{order.order_number}</p>
            <p className="text-[10px] text-neutral-500 truncate">
              {cashierName} ·{" "}
              {new Date(order.created_at).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
        <KitchenTimer createdAt={order.created_at} />
      </header>

      <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap border-b border-neutral-100">
        {typeMeta && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-700 bg-neutral-100 rounded-md px-1.5 py-0.5">
            <TypeIcon size={11} /> {typeMeta.label}
          </span>
        )}
        {tableNumber && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
            <MapPin size={11} /> Meja {tableNumber}
          </span>
        )}
        {priority === "urgent" && !isDone && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-urgent rounded-md px-1.5 py-0.5">
            <AlertTriangle size={11} /> Terlambat
          </span>
        )}
        <span className="ml-auto text-[11px] text-neutral-500 tabular-nums">
          {order.order_items.length} item · {totalQty} pcs
        </span>
      </div>

      <div className="px-3 py-2 max-h-72 overflow-y-auto">
        {order.order_items.map((item) => (
          <KitchenItem
            key={item.id}
            item={item}
            stationName={item.station_id ? stationNameById.get(item.station_id) : undefined}
          />
        ))}
      </div>

      <footer className="px-3 py-2 border-t border-neutral-100 bg-neutral-50 flex items-center gap-1.5">
        <button
          onClick={() => onReprint(order)}
          className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 touch-manipulation"
          aria-label="Cetak ulang tiket"
        >
          <Printer size={15} />
        </button>
        {!isDone && (
          <button
            onClick={() => onCancel(order.id)}
            className="p-2 rounded-lg text-neutral-500 hover:bg-red-50 hover:text-urgent touch-manipulation"
            aria-label="Batalkan pesanan"
          >
            <X size={15} />
          </button>
        )}
        {meta.next && !isDone && (
          <button
            onClick={() => onAdvanceStatus(order.id, meta.next!)}
            className={cx(
              "flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl text-sm font-semibold text-white touch-manipulation active:scale-[0.98] transition-transform",
              meta.nextTone
            )}
          >
            {meta.nextLabel} <ChevronRight size={14} />
          </button>
        )}
        {isDone && (
          <span className="flex-1 text-center text-xs text-neutral-400 py-2.5">Pesanan selesai</span>
        )}
      </footer>
    </article>
  );
}