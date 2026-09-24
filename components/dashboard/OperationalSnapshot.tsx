"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Wheat, Armchair, Hourglass, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ALL_BRANCHES } from "@/lib/branchContext";

interface Props {
  tenantId: string;
  selectedBranchId: string | typeof ALL_BRANCHES;
}

interface Counts {
  activeTables: number | null;
  kitchenOrders: number | null;
  pendingOrders: number | null;
  lowStock: number | null;
  reservationsToday: number | null;
}

const CARDS = [
  { key: "activeTables" as const, label: "Meja Terisi", href: "/dashboard/reservations", icon: Armchair, urgent: false },
  { key: "kitchenOrders" as const, label: "Order di Dapur", href: "/kitchen", icon: Sparkles, urgent: false },
  { key: "pendingOrders" as const, label: "Menunggu Konfirmasi", href: "/kitchen", icon: Hourglass, urgent: false },
  { key: "lowStock" as const, label: "Bahan Baku Menipis", href: "/dashboard/ingredients", icon: Wheat, urgent: true },
  { key: "reservationsToday" as const, label: "Reservasi Hari Ini", href: "/dashboard/reservations", icon: CalendarClock, urgent: false },
];

/**
 * Dashboard §9 (Owner Command Center) — bagian "Operasional".
 * Sebelumnya /dashboard cuma menampilkan 2 dari 5 sinyal operasional yang
 * diminta (Order Aktif & Stok Menipis, digabung jadi satu). Komponen ini
 * memisahkan & melengkapi jadi 5 kartu: Meja Terisi, Order di Dapur,
 * Menunggu Konfirmasi, Bahan Baku Menipis, Reservasi Hari Ini — masing-masing
 * link langsung ke halaman kerjanya.
 *
 * "Order di Dapur" = status NEW/ACCEPTED/PREPARING/READY (belum served).
 * "Menunggu Konfirmasi" = subset-nya yang statusnya masih NEW (baru masuk,
 * kasir/dapur belum accept) — sinyal paling mendesak buat owner.
 */
export default function OperationalSnapshot({ tenantId, selectedBranchId }: Props) {
  const [counts, setCounts] = useState<Counts>({
    activeTables: null,
    kitchenOrders: null,
    pendingOrders: null,
    lowStock: null,
    reservationsToday: null,
  });

  useEffect(() => {
    if (!tenantId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, selectedBranchId]);

  async function load() {
    const supabase = createClient();
    const isConsolidated = selectedBranchId === ALL_BRANCHES;

    // Meja terisi — dari view table_live_status (sama yang dipakai TableStatusBoard).
    let tablesQuery = supabase
      .from("table_live_status")
      .select("table_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["OCCUPIED", "BILL_PRINTED"]);
    if (!isConsolidated) tablesQuery = tablesQuery.eq("branch_id", selectedBranchId);

    // Order di dapur (belum served/selesai/batal).
    let kitchenQuery = supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["NEW", "ACCEPTED", "PREPARING", "READY"]);
    if (!isConsolidated) kitchenQuery = kitchenQuery.eq("branch_id", selectedBranchId);

    // Order baru masuk, belum di-accept sama sekali.
    let pendingQuery = supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "NEW");
    if (!isConsolidated) pendingQuery = pendingQuery.eq("branch_id", selectedBranchId);

    // Reservasi hari ini yang masih relevan (belum selesai/batal/no-show).
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    let reservationQuery = supabase
      .from("reservation_calendar")
      .select("id", { count: "exact", head: true })
      .gte("reservation_at", dayStart.toISOString())
      .lte("reservation_at", dayEnd.toISOString())
      .in("status", ["pending", "confirmed"]);
    if (!isConsolidated) reservationQuery = reservationQuery.eq("branch_id", selectedBranchId);

    const [tablesRes, kitchenRes, pendingRes, reservationRes, ingRows, stockRows] = await Promise.all([
      tablesQuery,
      kitchenQuery,
      pendingQuery,
      reservationQuery,
      supabase.from("ingredients").select("id, low_stock_threshold").eq("tenant_id", tenantId),
      supabase.from("branch_ingredients_stock").select("branch_id, ingredient_id, stock_qty, low_stock_threshold").eq("tenant_id", tenantId),
    ]);

    // Stok menipis — replikasi aturan yang sama persis dengan Halaman Bahan Baku.
    const stockByIngredient = new Map<string, { branch_id: string; stock_qty: number; low_stock_threshold: number | null }[]>();
    for (const row of (stockRows.data as any[]) ?? []) {
      const list = stockByIngredient.get(row.ingredient_id) ?? [];
      list.push(row);
      stockByIngredient.set(row.ingredient_id, list);
    }
    let lowCount = 0;
    for (const ing of (ingRows.data as { id: string; low_stock_threshold: number }[]) ?? []) {
      const rows = stockByIngredient.get(ing.id) ?? [];
      let low: boolean;
      if (isConsolidated) {
        const qty = rows.reduce((s, r) => s + Number(r.stock_qty), 0);
        low = qty <= ing.low_stock_threshold;
      } else {
        const row = rows.find((r) => r.branch_id === selectedBranchId);
        const qty = row ? Number(row.stock_qty) : 0;
        const th = row?.low_stock_threshold ?? ing.low_stock_threshold;
        low = qty <= th;
      }
      if (low) lowCount++;
    }

    setCounts({
      activeTables: tablesRes.count ?? 0,
      kitchenOrders: kitchenRes.count ?? 0,
      pendingOrders: pendingRes.count ?? 0,
      lowStock: lowCount,
      reservationsToday: reservationRes.count ?? 0,
    });
  }

  return (
    <div>
      <p className="font-semibold text-neutral-900 mb-3">Operasional Sekarang</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CARDS.map(({ key, label, href, icon: Icon, urgent }) => {
          const value = counts[key];
          const isAlert = urgent && (value ?? 0) > 0;
          return (
            <Link
              key={key}
              href={href}
              className="card p-4 flex flex-col gap-2 hover:border-primary/40 transition-colors"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isAlert ? "bg-urgent-light" : "bg-primary-light"}`}>
                <Icon className={isAlert ? "text-urgent" : "text-primary-dark"} size={17} />
              </div>
              <div>
                <p className={`text-xl font-bold ${isAlert ? "text-urgent" : "text-neutral-900"}`}>{value ?? "–"}</p>
                <p className="text-xs text-neutral-500 leading-tight mt-0.5">{label}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
