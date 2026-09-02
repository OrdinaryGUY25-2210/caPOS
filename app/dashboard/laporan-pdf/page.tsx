"use client";

import { useEffect, useState } from "react";
import { FileText, Download, Loader2, CalendarRange } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, HISTORY_DAYS_LIMIT, type Tier } from "@/lib/tier";

type RangeKey = "today" | "7" | "month" | "custom";

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function rangeToDates(range: RangeKey, customStart: string, customEnd: string) {
  const now = new Date();
  let start: Date;
  let end: Date = new Date(now);

  if (range === "today") {
    start = new Date(now);
  } else if (range === "7") {
    start = new Date(now);
    start.setDate(start.getDate() - 6);
  } else if (range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = customStart ? new Date(customStart) : new Date(now);
    end = customEnd ? new Date(customEnd) : new Date(now);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function LaporanPdfPage() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tier, setTier] = useState<Tier>("free");
  const [cafeName, setCafeName] = useState("Kafe Anda");
  const [range, setRange] = useState<RangeKey>("7");
  const [customStart, setCustomStart] = useState(toISODate(new Date()));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      setTenantId(profile.tenant_id);

      const supabase = createClient();
      const [{ data: sub }, { data: tenant }] = await Promise.all([
        supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
        supabase.from("tenants").select("name").eq("id", profile.tenant_id).single(),
      ]);

      const currentTier = profile.role === "super_admin" ? "supreme" : getTier(sub);
      setTier(currentTier);
      if (tenant?.name) setCafeName(tenant.name);

      const historyLimit = HISTORY_DAYS_LIMIT[currentTier];
      if (historyLimit) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - historyLimit);
        setMinDate(toISODate(cutoff));
      }

      setLoading(false);
    })();
  }, []);

  async function generatePdf() {
    if (!tenantId) return;
    setGenerating(true);
    try {
      const supabase = createClient();
      const { start, end } = rangeToDates(range, customStart, customEnd);

      const [{ data: txRows }, { data: itemRows }] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, total_amount, payment_method, created_at, cashier_id, profiles(full_name)")
          .eq("tenant_id", tenantId)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .limit(10000),
        supabase
          .from("transaction_items")
          .select("qty, subtotal, product_id, products(name, cost_price), transactions!inner(created_at, tenant_id)")
          .eq("transactions.tenant_id", tenantId)
          .gte("transactions.created_at", start.toISOString())
          .lte("transactions.created_at", end.toISOString())
          .limit(10000),
      ]);

      const transactions = txRows ?? [];
      const items = itemRows ?? [];

      // --- Ringkasan ---
      const totalOmzet = transactions.reduce((s: number, t: any) => s + Number(t.total_amount), 0);
      const totalOrders = transactions.length;
      const avgPerOrder = totalOrders > 0 ? Math.round(totalOmzet / totalOrders) : 0;
      const totalHpp = items.reduce((s: number, it: any) => s + Number(it.qty) * Number(it.products?.cost_price ?? 0), 0);
      const grossProfit = totalOmzet - totalHpp;
      const marginPct = totalOmzet > 0 ? Math.round((grossProfit / totalOmzet) * 100) : 0;

      // --- Omzet harian ---
      const dailyMap = new Map<string, { orders: number; revenue: number }>();
      for (const t of transactions as any[]) {
        const day = new Date(t.created_at).toISOString().slice(0, 10);
        const e = dailyMap.get(day) ?? { orders: 0, revenue: 0 };
        e.orders += 1;
        e.revenue += Number(t.total_amount);
        dailyMap.set(day, e);
      }
      const dailyRows = Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, v]) => [day, String(v.orders), formatRupiah(v.revenue)]);

      // --- Menu terlaris ---
      const productMap = new Map<string, { qty: number; revenue: number }>();
      for (const it of items as any[]) {
        const name = it.products?.name ?? "Produk";
        const e = productMap.get(name) ?? { qty: 0, revenue: 0 };
        e.qty += Number(it.qty);
        e.revenue += Number(it.subtotal);
        productMap.set(name, e);
      }
      const topProducts = Array.from(productMap.entries())
        .sort(([, a], [, b]) => b.qty - a.qty)
        .slice(0, 10)
        .map(([name, v]) => [name, String(v.qty), formatRupiah(v.revenue)]);

      // --- Metode pembayaran ---
      const paymentMap = new Map<string, { count: number; revenue: number }>();
      for (const t of transactions as any[]) {
        const method = (t.payment_method ?? "cash").toUpperCase();
        const e = paymentMap.get(method) ?? { count: 0, revenue: 0 };
        e.count += 1;
        e.revenue += Number(t.total_amount);
        paymentMap.set(method, e);
      }
      const paymentRows = Array.from(paymentMap.entries()).map(([method, v]) => [
        method, String(v.count), formatRupiah(v.revenue),
      ]);

      // --- Kinerja kasir ---
      const cashierMap = new Map<string, { orders: number; revenue: number }>();
      for (const t of transactions as any[]) {
        const name = t.profiles?.full_name ?? "Kasir";
        const e = cashierMap.get(name) ?? { orders: 0, revenue: 0 };
        e.orders += 1;
        e.revenue += Number(t.total_amount);
        cashierMap.set(name, e);
      }
      const cashierRows = Array.from(cashierMap.entries())
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .map(([name, v]) => [name, String(v.orders), formatRupiah(v.revenue)]);

      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;
      let y = 50;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(cafeName, margin, y);
      y += 20;
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text("Laporan Penjualan Otomatis — caPOS", margin, y);
      y += 16;
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(
        `Periode: ${toISODate(start)} s/d ${toISODate(end)}  ·  Dibuat: ${new Date().toLocaleString("id-ID")}`,
        margin, y
      );
      doc.setTextColor(0);
      y += 24;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 9 },
        head: [["Total Omzet", "Total Transaksi", "Rata-rata/Transaksi", "Estimasi Laba Kotor", "Margin"]],
        body: [[
          formatRupiah(totalOmzet), String(totalOrders), formatRupiah(avgPerOrder),
          formatRupiah(grossProfit), `${marginPct}%`,
        ]],
        headStyles: { fillColor: [16, 185, 129] },
      });
      y = (doc as any).lastAutoTable.finalY + 24;

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Omzet Harian", margin, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        head: [["Tanggal", "Jumlah Transaksi", "Omzet"]],
        body: dailyRows.length ? dailyRows : [["-", "-", "-"]],
        headStyles: { fillColor: [16, 185, 129] },
      });
      y = (doc as any).lastAutoTable.finalY + 24;

      if (y > 650) { doc.addPage(); y = 50; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Menu Terlaris", margin, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        head: [["Menu", "Terjual (pcs)", "Omzet"]],
        body: topProducts.length ? topProducts : [["-", "-", "-"]],
        headStyles: { fillColor: [16, 185, 129] },
      });
      y = (doc as any).lastAutoTable.finalY + 24;

      if (y > 650) { doc.addPage(); y = 50; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Metode Pembayaran", margin, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        head: [["Metode", "Jumlah Transaksi", "Total"]],
        body: paymentRows.length ? paymentRows : [["-", "-", "-"]],
        headStyles: { fillColor: [16, 185, 129] },
      });
      y = (doc as any).lastAutoTable.finalY + 24;

      if (y > 650) { doc.addPage(); y = 50; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Kinerja Kasir", margin, y);
      y += 6;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        head: [["Kasir", "Jumlah Transaksi", "Omzet"]],
        body: cashierRows.length ? cashierRows : [["-", "-", "-"]],
        headStyles: { fillColor: [16, 185, 129] },
      });

      const pageCount = doc.internal.pages.length - 1;
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `Dibuat otomatis oleh caPOS — halaman ${i}/${pageCount}`,
          pageWidth / 2, doc.internal.pageSize.getHeight() - 20,
          { align: "center" }
        );
      }

      doc.save(`laporan-capos-${toISODate(start)}-sd-${toISODate(end)}.pdf`);
    } catch (err: any) {
      alert("Gagal membuat PDF: " + (err?.message ?? "Terjadi kesalahan"));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Laporan PDF Otomatis</h1>
        <p className="text-sm text-neutral-500">
          Satu klik: rekap omzet, laba kotor (HPP), menu terlaris, metode pembayaran, dan kinerja kasir langsung jadi file PDF rapi.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-2 block">Pilih Periode</label>
          <div className="flex flex-wrap gap-1 bg-neutral-100 rounded-lg p-1 w-fit">
            {([
              ["today", "Hari Ini"],
              ["7", "7 Hari"],
              ["month", "Bulan Ini"],
              ["custom", "Custom"],
            ] as [RangeKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={cx(
                  "px-3 py-1.5 rounded-md text-sm font-medium",
                  range === key ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarRange size={16} className="text-neutral-400" />
              <input
                type="date"
                value={customStart}
                min={minDate ?? undefined}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input-field w-auto"
              />
              <span className="text-neutral-400 text-sm">s/d</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={toISODate(new Date())}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input-field w-auto"
              />
            </div>
          </div>
        )}

        {minDate && (
          <p className="text-xs text-neutral-400">
            Paket Free Trial hanya bisa membuat laporan mulai {minDate}. Upgrade untuk riwayat lebih panjang.
          </p>
        )}

        <button
          onClick={generatePdf}
          disabled={generating}
          className="btn-primary flex items-center gap-2"
        >
          {generating ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
          {generating ? "Membuat PDF..." : "Buat & Unduh Laporan PDF"}
        </button>
      </div>

      <div className="card p-4 flex items-start gap-3 bg-neutral-50">
        <FileText className="text-neutral-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-neutral-500">
          Laporan berisi: ringkasan omzet & estimasi laba kotor (berdasarkan HPP di halaman Stok & HPP),
          rincian omzet harian, menu terlaris, metode pembayaran, dan kinerja tiap kasir pada periode yang dipilih.
          Kolom laba kotor akan menampilkan 0 kalau HPP menu belum diisi di halaman Stok & HPP.
        </p>
      </div>
    </div>
  );
}
