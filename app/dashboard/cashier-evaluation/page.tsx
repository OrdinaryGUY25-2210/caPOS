"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Trophy, Clock } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { Skeleton } from "@/components/Skeleton";

type Period = "7" | "30" | "month";

interface CashierStat {
  cashierId: string;
  name: string;
  totalOrders: number;
  totalRevenue: number;
  avgPerOrder: number;
  shiftCount: number;
}

export default function CashierEvaluationPage() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30");
  const [stats, setStats] = useState<CashierStat[]>([]);

  async function loadData(p: Period) {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const supabase = createClient();

    let start: Date;
    const now = new Date();
    if (p === "7") {
      start = new Date(now);
      start.setDate(start.getDate() - 6);
    } else if (p === "30") {
      start = new Date(now);
      start.setDate(start.getDate() - 29);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    start.setHours(0, 0, 0, 0);

    const [{ data: txRows }, { data: shiftRows }] = await Promise.all([
      supabase
        .from("transactions")
        .select("cashier_id, total_amount, profiles(full_name)")
        .eq("tenant_id", profile.tenant_id)
        .gte("created_at", start.toISOString())
        .limit(5000),
      supabase
        .from("shifts")
        .select("cashier_id, opened_at")
        .eq("tenant_id", profile.tenant_id)
        .gte("opened_at", start.toISOString())
        .limit(2000),
    ]);

    const map = new Map<string, CashierStat>();

    for (const t of txRows ?? []) {
      const id = (t as any).cashier_id;
      if (!id) continue;
      const name = (t as any).profiles?.full_name ?? "Kasir";
      const existing = map.get(id) ?? {
        cashierId: id, name, totalOrders: 0, totalRevenue: 0, avgPerOrder: 0, shiftCount: 0,
      };
      existing.totalOrders += 1;
      existing.totalRevenue += Number((t as any).total_amount);
      map.set(id, existing);
    }

    const shiftCounts = new Map<string, Set<string>>();
    for (const s of shiftRows ?? []) {
      const id = (s as any).cashier_id;
      if (!id) continue;
      const day = new Date((s as any).opened_at).toISOString().slice(0, 10);
      if (!shiftCounts.has(id)) shiftCounts.set(id, new Set());
      shiftCounts.get(id)!.add(day);
    }

    for (const [id, set] of shiftCounts) {
      const existing = map.get(id);
      if (existing) existing.shiftCount = set.size;
    }

    const list = Array.from(map.values()).map((s) => ({
      ...s,
      avgPerOrder: s.totalOrders > 0 ? Math.round(s.totalRevenue / s.totalOrders) : 0,
    }));
    list.sort((a, b) => b.totalRevenue - a.totalRevenue);

    setStats(list);
    setLoading(false);
  }

  useEffect(() => {
    loadData(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const teamAvgRevenue = useMemo(() => {
    if (stats.length === 0) return 0;
    return stats.reduce((s, c) => s + c.totalRevenue, 0) / stats.length;
  }, [stats]);

  function performanceLabel(revenue: number) {
    if (teamAvgRevenue === 0) return { text: "Belum ada data pembanding", cls: "text-neutral-400" };
    const ratio = revenue / teamAvgRevenue;
    if (ratio >= 1.15) return { text: "Di atas rata-rata tim", cls: "text-primary-dark" };
    if (ratio >= 0.85) return { text: "Sesuai rata-rata tim", cls: "text-neutral-500" };
    return { text: "Di bawah rata-rata tim", cls: "text-urgent" };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Evaluasi Kasir</h1>
          <p className="text-sm text-neutral-500">
            Peringkat kinerja kasir dihitung otomatis dari transaksi & shift tercatat.
          </p>
        </div>
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
          {(["7", "30", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cx(
                "px-3 py-1.5 rounded-md text-sm font-medium",
                period === p ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
              )}
            >
              {p === "7" ? "7 Hari" : p === "30" ? "30 Hari" : "Bulan Ini"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 flex flex-wrap items-center gap-4 justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                <div className="space-y-2 min-w-0">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="space-y-1.5">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-4 w-14" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : stats.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400 text-sm">
          Belum ada transaksi kasir pada periode ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {stats.map((c, i) => {
            const perf = performanceLabel(c.totalRevenue);
            return (
              <div key={c.cashierId} className="card p-5 flex flex-wrap items-center gap-4 justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cx(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0",
                      i === 0 ? "bg-warning-light text-warning" : "bg-neutral-100 text-neutral-500"
                    )}
                  >
                    {i === 0 ? <Trophy size={18} /> : `#${i + 1}`}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900 truncate">{c.name}</p>
                    <p className={cx("text-xs font-medium", perf.cls)}>{perf.text}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <p className="text-neutral-400 text-xs">Total Omzet</p>
                    <p className="font-bold text-neutral-900">{formatRupiah(c.totalRevenue)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400 text-xs">Transaksi</p>
                    <p className="font-bold text-neutral-900">{c.totalOrders}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400 text-xs">Rata-rata/Transaksi</p>
                    <p className="font-bold text-neutral-900">{formatRupiah(c.avgPerOrder)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400 text-xs flex items-center gap-1"><Clock size={11} /> Hari Kerja</p>
                    <p className="font-bold text-neutral-900">{c.shiftCount}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card p-4 flex items-start gap-3 bg-neutral-50">
        <ClipboardCheck className="text-neutral-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-neutral-500">
          Skor dihitung dari total omzet dibanding rata-rata omzet seluruh kasir pada periode yang sama —
          bukan penilaian subjektif. Gunakan bersama observasi langsung untuk keputusan yang lebih adil.
        </p>
      </div>
    </div>
  );
}
