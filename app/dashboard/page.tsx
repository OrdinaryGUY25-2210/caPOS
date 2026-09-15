"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Download, Printer, TrendingUp, TrendingDown, Minus, Sparkles, HeartPulse, Wheat } from "lucide-react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, hasSalesHealth, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton, SkeletonStatGrid } from "@/components/Skeleton";

const PIE_COLORS = ["#10B981", "#059669", "#34D399", "#6EE7B7", "#94A3B8"];
const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

interface OmzetPoint { day: string; date: string; omzet: number; orders: number }
interface PeakPoint { hour: string; orders: number }
interface BestSellerPoint { name: string; value: number }

export default function ReportsPage() {
  const { selectedBranchId, selectedBranch, canSwitchBranch } = useBranch();
  const [chartModel, setChartModel] = useState<"bar" | "line">("bar");
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<Tier>("free");
  const [cafeName, setCafeName] = useState("Kafe Anda");

  const [omzetData, setOmzetData] = useState<OmzetPoint[]>([]);
  const [peakHours, setPeakHours] = useState<PeakPoint[]>([]);
  const [bestSellers, setBestSellers] = useState<BestSellerPoint[]>([]);
  const [healthTrendPct, setHealthTrendPct] = useState<number | null>(null);
  // Phase 2A.2 §9 — "how is my business doing right now" operational snapshot.
  // Both counts are derived from existing tables only (Case A/C — no schema
  // change): orders.status for active orders, and the exact same
  // branch_ingredients_stock/ingredients low-stock rule already canonical in
  // app/dashboard/ingredients/page.tsx's branchStockFor(), replicated here so
  // the definition of "low stock" never disagrees between the two pages.
  const [activeOrdersCount, setActiveOrdersCount] = useState<number | null>(null);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);

  const isPremium = tier === "supreme";
  // Sesuai keputusan: Excel Lengkap + PDF sekarang juga untuk Pro (bukan
  // cuma Supreme) — supaya cocok dengan janji di kartu paket Pro. Jam
  // Ramai (Peak Hours) tetap eksklusif Supreme, TIDAK diubah.
  const canExportExcel = tier === "pro" || tier === "supreme";
  const showHealth = hasSalesHealth(tier);
  const totalOmzet = omzetData.reduce((s, d) => s + d.omzet, 0);
  const totalOrders = omzetData.reduce((s, d) => s + d.orders, 0);
  const hasData = totalOrders > 0;

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const [{ data: sub }, { data: tenant }] = await Promise.all([
        supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
        supabase.from("tenants").select("name").eq("id", profile.tenant_id).single(),
      ]);

      const currentTier: Tier = profile.role === "super_admin" ? "supreme" : getTier(sub);
      setTier(currentTier);
      if (tenant?.name) setCafeName(tenant.name);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const { data: dailyRows } = await (() => {
        let q = supabase
          .from("daily_sales_analytics")
          .select("sale_date, total_orders, total_revenue")
          .eq("tenant_id", profile.tenant_id)
          .gte("sale_date", sevenDaysAgo.toISOString().slice(0, 10));
        if (selectedBranchId !== ALL_BRANCHES) q = q.eq("branch_id", selectedBranchId);
        return q;
      })();

      const filledDays: OmzetPoint[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        // Kalau "Semua Cabang" dipilih, daily_sales_analytics mengembalikan
        // SATU baris PER CABANG untuk tanggal yang sama (view di-group by
        // tenant_id, branch_id, sale_date sejak migration_011) — jadi harus
        // dijumlahkan di sini, bukan cuma ambil baris pertama yang cocok.
        const matches = (dailyRows ?? []).filter((r: any) => r.sale_date === dateStr);
        filledDays.push({
          day: DAY_LABELS[d.getDay()],
          date: dateStr,
          omzet: matches.reduce((s: number, r: any) => s + Number(r.total_revenue), 0),
          orders: matches.reduce((s: number, r: any) => s + Number(r.total_orders), 0),
        });
      }
      setOmzetData(filledDays);

      const last3 = filledDays.slice(-3).reduce((s, d) => s + d.omzet, 0);
      const prev3 = filledDays.slice(-6, -3).reduce((s, d) => s + d.omzet, 0);
      setHealthTrendPct(prev3 > 0 ? Math.round(((last3 - prev3) / prev3) * 100) : null);

      if (currentTier === "supreme") {
        let peakQuery = supabase
          .from("peak_hours_analytics")
          .select("hour_of_day, total_orders")
          .eq("tenant_id", profile.tenant_id);
        if (selectedBranchId !== ALL_BRANCHES) peakQuery = peakQuery.eq("branch_id", selectedBranchId);
        const { data: peakRows } = await peakQuery;

        setPeakHours(
          Array.from({ length: 24 }, (_, h) => h)
            .filter((h) => h % 2 === 0)
            .map((h) => ({
              hour: `${String(h).padStart(2, "0")}:00`,
              // Sama seperti omzet harian — jumlahkan lintas cabang kalau
              // "Semua Cabang" dipilih (baris view sudah di-group per cabang).
              orders: (peakRows ?? [])
                .filter((r: any) => r.hour_of_day === h)
                .reduce((s: number, r: any) => s + Number(r.total_orders), 0),
            }))
        );

        let bestQuery = supabase
          .from("best_seller_analytics")
          .select("product_name, branch_id, total_qty")
          .eq("tenant_id", profile.tenant_id);
        if (selectedBranchId !== ALL_BRANCHES) bestQuery = bestQuery.eq("branch_id", selectedBranchId);
        const { data: bestRows } = await bestQuery;

        const bestMap = new Map<string, number>();
        for (const r of (bestRows as { product_name: string; total_qty: number }[]) ?? []) {
          bestMap.set(r.product_name, (bestMap.get(r.product_name) ?? 0) + Number(r.total_qty));
        }
        setBestSellers(
          Array.from(bestMap.entries())
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
        );
      }

      // Active orders right now (not yet SERVED/COMPLETED/CANCELLED).
      let activeOrdersQuery = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id)
        .not("status", "in", "(SERVED,COMPLETED,CANCELLED)");
      if (selectedBranchId !== ALL_BRANCHES) activeOrdersQuery = activeOrdersQuery.eq("branch_id", selectedBranchId);
      const { count: activeCount } = await activeOrdersQuery;
      setActiveOrdersCount(activeCount ?? 0);

      // Low-stock ingredients right now — same rule as the Ingredients page's
      // branchStockFor(): consolidated view sums stock across branches against
      // the ingredient's own threshold; a single branch uses that branch's
      // stock_qty against its own threshold override (falling back to the
      // ingredient's threshold).
      const [{ data: ingRows }, { data: stockRows }] = await Promise.all([
        supabase.from("ingredients").select("id, low_stock_threshold").eq("tenant_id", profile.tenant_id),
        supabase
          .from("branch_ingredients_stock")
          .select("branch_id, ingredient_id, stock_qty, low_stock_threshold")
          .eq("tenant_id", profile.tenant_id),
      ]);
      const isConsolidated = selectedBranchId === ALL_BRANCHES;
      const stockByIngredient = new Map<string, { branch_id: string; stock_qty: number; low_stock_threshold: number | null }[]>();
      for (const row of (stockRows as any[]) ?? []) {
        const list = stockByIngredient.get(row.ingredient_id) ?? [];
        list.push(row);
        stockByIngredient.set(row.ingredient_id, list);
      }
      let lowCount = 0;
      for (const ing of (ingRows as { id: string; low_stock_threshold: number }[]) ?? []) {
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
      setLowStockCount(lowCount);

      setLoading(false);
    })();
  }, [selectedBranchId]);

  function exportCSV() {
    const header = "Tanggal,Hari,Omzet (Rp),Jumlah Transaksi\n";
    const rows = omzetData.map((d) => `${d.date},${d.day},${d.omzet},${d.orders}`).join("\n");
    const totalRow = `\nTotal,,${totalOmzet},${totalOrders}`;
    const csv = "\uFEFF" + header + rows + totalRow;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-omzet-capos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    const summaryRows = [
      [`Laporan Omzet — ${cafeName}`],
      [`Diekspor: ${new Date().toLocaleString("id-ID")}`],
      [],
      ["Total Omzet (7 hari)", totalOmzet],
      ["Total Transaksi", totalOrders],
      ["Rata-rata / Transaksi", totalOrders > 0 ? Math.round(totalOmzet / totalOrders) : 0],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Ringkasan");

    const omzetSheet = XLSX.utils.json_to_sheet(
      omzetData.map((d) => ({ Tanggal: d.date, Hari: d.day, "Omzet (Rp)": d.omzet, "Jumlah Transaksi": d.orders }))
    );
    omzetSheet["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, omzetSheet, "Omzet Harian");

    if (isPremium) {
      const peakSheet = XLSX.utils.json_to_sheet(peakHours.map((d) => ({ Jam: d.hour, "Jumlah Order": d.orders })));
      peakSheet["!cols"] = [{ wch: 10 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, peakSheet, "Jam Ramai");
    }

    if (canExportExcel) {
      const bestSellerSheet = XLSX.utils.json_to_sheet(bestSellers.map((d) => ({ Menu: d.name, "Terjual (pcs)": d.value })));
      bestSellerSheet["!cols"] = [{ wch: 24 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, bestSellerSheet, "Menu Terlaris");
    }

    XLSX.writeFile(wb, `laporan-capos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
        <SkeletonStatGrid count={5} />
        <div className="card p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-neutral-900">Laporan & Omzet</h1>
            <span className={isPremium ? "badge-active" : "badge-warning"}>
              {isPremium ? "Laporan Lengkap" : "Laporan Dasar"}
            </span>
          </div>
          <p className="text-sm text-neutral-500">
            Ringkasan performa penjualan kafe Anda — 7 hari terakhir
            {canSwitchBranch && (selectedBranchId === ALL_BRANCHES ? " (Semua Cabang)" : selectedBranch ? ` — ${selectedBranch.name}` : "")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExportExcel ? (
            <>
              <button onClick={exportExcel} className="btn-outline flex items-center gap-1.5 text-sm" title="Excel lengkap: Ringkasan, Omzet Harian, Menu Terlaris (+ Jam Ramai untuk Supreme)">
                <Download size={14} /> Excel Lengkap
              </button>
              <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 text-sm">
                <Printer size={14} /> PDF
              </button>
            </>
          ) : (
            <>
              <button onClick={exportCSV} className="btn-outline flex items-center gap-1.5 text-sm" title="CSV sederhana: rekap omzet harian">
                <Download size={14} /> Export CSV
              </button>
              <Link href="/dashboard/subscription" className="text-xs text-primary hover:underline whitespace-nowrap">
                Upgrade untuk Excel Lengkap
              </Link>
            </>
          )}
        </div>
      </div>

      {!hasData && (
        <div className="card p-5 bg-primary-light/40 border-primary/20 text-sm text-neutral-700">
          Belum ada transaksi tercatat 7 hari terakhir. Grafik & angka di bawah akan otomatis
          terisi begitu ada transaksi masuk dari halaman <Link href="/pos" className="text-primary-dark font-medium hover:underline">Kasir</Link>.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Total Omzet (7 hari)</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(totalOmzet)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Total Transaksi</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{totalOrders}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Rata-rata / Transaksi</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">
            {totalOrders > 0 ? formatRupiah(Math.round(totalOmzet / totalOrders)) : "Rp0"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/kitchen" className="card p-5 flex items-center justify-between hover:border-primary/40 transition-colors">
          <div>
            <p className="text-sm text-neutral-500">Order Aktif Sekarang</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">{activeOrdersCount ?? "–"}</p>
            <p className="text-xs text-neutral-500 mt-0.5">Belum served/selesai · lihat KDS</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-primary-light flex items-center justify-center shrink-0">
            <Sparkles className="text-primary-dark" size={20} />
          </div>
        </Link>
        <Link href="/dashboard/ingredients" className="card p-5 flex items-center justify-between hover:border-primary/40 transition-colors">
          <div>
            <p className="text-sm text-neutral-500">Bahan Baku Stok Menipis</p>
            <p className={"text-2xl font-bold mt-1 " + ((lowStockCount ?? 0) > 0 ? "text-urgent" : "text-neutral-900")}>
              {lowStockCount ?? "–"}
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">Di bawah batas minimum · lihat Bahan Baku</p>
          </div>
          <div className={"w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 " + ((lowStockCount ?? 0) > 0 ? "bg-urgent-light" : "bg-neutral-100")}>
            <Wheat className={(lowStockCount ?? 0) > 0 ? "text-urgent" : "text-neutral-400"} size={20} />
          </div>
        </Link>
      </div>

      {showHealth && (
        <div className="card p-5 flex items-center gap-4">
          <div className={
            "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 " +
            (healthTrendPct === null ? "bg-neutral-100" : healthTrendPct >= 0 ? "bg-primary-light" : "bg-urgent-light")
          }>
            <HeartPulse className={healthTrendPct === null ? "text-neutral-400" : healthTrendPct >= 0 ? "text-primary-dark" : "text-urgent"} size={22} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-neutral-900 text-sm">Kesehatan Penjualan</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {healthTrendPct === null
                ? "Butuh minimal 6 hari data untuk dianalisis."
                : healthTrendPct >= 10
                ? `Sehat — omzet 3 hari terakhir naik ${healthTrendPct}% dibanding 3 hari sebelumnya.`
                : healthTrendPct >= -10
                ? "Stabil — omzet 3 hari terakhir relatif setara 3 hari sebelumnya."
                : `Perlu perhatian — omzet 3 hari terakhir turun ${Math.abs(healthTrendPct)}% dibanding 3 hari sebelumnya.`}
            </p>
          </div>
          {healthTrendPct !== null && (
            <span className={
              "flex items-center gap-1 text-sm font-bold shrink-0 " +
              (healthTrendPct >= 10 ? "text-primary" : healthTrendPct >= -10 ? "text-neutral-500" : "text-urgent")
            }>
              {healthTrendPct >= 10 ? <TrendingUp size={16} /> : healthTrendPct >= -10 ? <Minus size={16} /> : <TrendingDown size={16} />}
              {healthTrendPct > 0 ? "+" : ""}{healthTrendPct}%
            </span>
          )}
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-neutral-900">Grafik Omzet Harian</h2>
          <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
            <button
              onClick={() => setChartModel("bar")}
              className={chartModel === "bar" ? "px-3 py-1 rounded-md bg-white shadow-sm text-sm font-medium" : "px-3 py-1 text-sm text-neutral-500"}
            >
              Bar
            </button>
            <button
              onClick={() => setChartModel("line")}
              className={chartModel === "line" ? "px-3 py-1 rounded-md bg-white shadow-sm text-sm font-medium" : "px-3 py-1 text-sm text-neutral-500"}
            >
              Garis
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          {chartModel === "bar" ? (
            <BarChart data={omzetData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => formatRupiah(v)} />
              <Bar dataKey="omzet" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={omzetData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => formatRupiah(v)} />
              <Line type="monotone" dataKey="omzet" stroke="#10B981" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {isPremium ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <h2 className="font-semibold text-neutral-900 mb-4">Jam Ramai (Peak Hours)</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={peakHours}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="hour" stroke="#64748B" fontSize={11} />
                <YAxis stroke="#64748B" fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="orders" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-neutral-900 mb-4">Menu Terlaris</h2>
            {bestSellers.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={bestSellers} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {bestSellers.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-neutral-400 text-sm py-16">Belum ada data penjualan menu.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
            <Sparkles className="text-primary-dark" size={22} />
          </div>
          <div>
            <p className="font-semibold text-neutral-900">Jam Ramai, Menu Terlaris & Export Lengkap ada di Supreme</p>
            <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto">
              Upgrade ke paket Supreme (Tahunan) untuk buka analisis jam ramai, menu terlaris,
              serta export laporan multi-sheet ke Excel dan PDF.
            </p>
          </div>
          <Link href="/dashboard/subscription" className="btn-primary inline-block">
            Lihat Paket Supreme
          </Link>
        </div>
      )}
    </div>
  );
}
