"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import KitchenOrderCard from "./KitchenOrderCard";
import { getKitchenPriority } from "./KitchenTimer";
import type { KitchenStation, OrderStatus, OrderWithItems } from "@/lib/types";

const COLUMNS: { status: OrderStatus; label: string }[] = [
  { status: "NEW", label: "Baru Masuk" },
  { status: "ACCEPTED", label: "Diterima" },
  { status: "PREPARING", label: "Sedang Disiapkan" },
  { status: "READY", label: "Siap Disajikan" },
  { status: "SERVED", label: "Sudah Disajikan" },
];

// Bobot untuk sorting di dalam kolom — urgent di atas, lalu warning,
// baru normal; tie-break pakai created_at terlama dulu.
const PRIORITY_WEIGHT = { urgent: 0, warning: 1, normal: 2 } as const;

export default function KitchenBoard({
  orders,
  stations,
  cashierNames,
  onAdvanceStatus,
  onCancel,
  onReprint,
}: {
  orders: OrderWithItems[];
  stations: KitchenStation[];
  cashierNames: Record<string, string>;
  onAdvanceStatus: (orderId: string, next: OrderStatus) => void;
  onCancel: (orderId: string) => void;
  onReprint: (order: OrderWithItems) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<OrderStatus, OrderWithItems[]> = {
      NEW: [],
      ACCEPTED: [],
      PREPARING: [],
      READY: [],
      SERVED: [],
      COMPLETED: [],
      CANCELLED: [],
    };
    for (const o of orders) map[o.status]?.push(o);
    for (const status of Object.keys(map) as OrderStatus[]) {
      map[status].sort((a, b) => {
        const pa = PRIORITY_WEIGHT[getKitchenPriority(a.created_at)];
        const pb = PRIORITY_WEIGHT[getKitchenPriority(b.created_at)];
        if (pa !== pb) return pa - pb;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    }
    return map;
  }, [orders]);

  return (
    <div className="flex gap-4 min-w-max h-full">
      {COLUMNS.map((col) => {
        const colOrders = grouped[col.status];
        return (
          <section key={col.status} className="w-80 shrink-0 flex flex-col gap-3" aria-label={col.label}>
            <header className="flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-neutral-700 uppercase tracking-wide">{col.label}</h2>
              <span className="text-xs font-mono text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5 tabular-nums">
                {colOrders.length}
              </span>
            </header>
            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {colOrders.map((order) => (
                <KitchenOrderCard
                  key={order.id}
                  order={order}
                  stations={stations}
                  cashierName={cashierNames[order.cashier_id ?? ""] ?? "Kasir"}
                  onAdvanceStatus={onAdvanceStatus}
                  onCancel={onCancel}
                  onReprint={onReprint}
                />
              ))}
              {colOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-neutral-300">
                  <ClipboardList size={20} />
                  <p className="text-xs">Kosong</p>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}