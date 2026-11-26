"use client";

import { useEffect, useState } from "react";
import type { ReportType } from "@/lib/reportPdf";
import { FileText, Download, Loader2, CalendarRange } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, HISTORY_DAYS_LIMIT, FREE_TIER_LIMITS, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton } from "@/components/Skeleton";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { DEMO_REPORT_TX, DEMO_REPORT_ITEMS, DEMO_REPORT_OPNAME } from "@/lib/demoData";

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
  const { selectedBranchId, canSwitchBranch, branches } = useBranch();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tier, setTier] = useState<Tier>("free");
  const [cafeName, setCafeName] = useState("Kafe Anda");
  const [range, setRange] = useState<RangeKey>("7");
  const [customStart, setCustomStart] = useState(toISODate(new Date()));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [reportType, setReportType] = useState<ReportType>("full");
  // Free Trial: export hanya 1 hari (hari ini). Dipaksa di sini, bukan cuma
  // disembunyikan di UI, supaya state "range" tidak bisa lolos ke query.
  const isFree = tier === "free";
  const effectiveRange: RangeKey = isFree ? "today" : range;

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

      if (await tenantHasNoActivity()) setIsDemo(true);

      setLoading(false);
    })();
  }, []);

  async function generatePdf() {
    if (!tenantId) return;
    setGenerating(true);
    try {
      const { start, end } = rangeToDates(effectiveRange, customStart, customEnd);
      const { generateReportPdf } = await import("@/lib/reportPdf");
      await generateReportPdf({
        supabase: createClient(),
        tenantId,
        cafeName,
        type: reportType,
        start,
        end,
        branchId: selectedBranchId,
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
        showBranchLabel: canSwitchBranch,
        isDemo,
        note: isFree ? `Paket Free Trial: laporan dibatasi ${FREE_TIER_LIMITS.exportDays} hari (hari ini).` : undefined,
      });
    } catch (err: any) {
      alert("Gagal membuat PDF: " + (err?.message ?? "Terjadi kesalahan"));
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-full max-w-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="card p-5 space-y-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-10 w-56 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Laporan PDF Otomatis</h1>
        {isDemo && <DemoBadge />}
        <p className="text-sm text-neutral-500">
          Satu klik jadi PDF rapi, lengkap dengan analitik pertumbuhan dan grafik batang per cabang. Pilih jenis laporan:
          Omzet Saja (ringkas) atau Lengkap (plus HPP, menu terlaris, pembayaran, kasir).
          {canSwitchBranch && ` Sesuai cabang yang dipilih di navbar (${selectedBranchId === ALL_BRANCHES ? "Semua Cabang" : branches.find((b) => b.id === selectedBranchId)?.name ?? "-"}).`}
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-2 block">Jenis Laporan</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ["omzet", "Omzet Saja", "Ringkas: omzet, pertumbuhan, grafik per jam/hari, dan pertumbuhan tiap cabang."],
              ["full", "Lengkap", "Semua isi Omzet Saja + laba kotor (HPP), menu terlaris, metode pembayaran, kinerja kasir."],
            ] as [ReportType, string, string][]).map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => setReportType(key)}
                className={cx(
                  "text-left rounded-xl border p-3",
                  reportType === key ? "border-primary bg-primary-light/40" : "border-neutral-200 hover:bg-neutral-50"
                )}
              >
                <p className="text-sm font-semibold text-neutral-900">{label}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-2 block">Pilih Periode</label>
          <div className="flex flex-wrap gap-1 bg-neutral-100 rounded-lg p-1 w-fit">
            {(([
              ["today", "Hari Ini"],
              ["7", "7 Hari"],
              ["month", "Bulan Ini"],
              ["custom", "Custom"],
            ] as [RangeKey, string][]).filter(([key]) => !isFree || key === "today")).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={cx(
                  "px-3 py-1.5 rounded-md text-sm font-medium",
                  effectiveRange === key ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {effectiveRange === "custom" && (
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

        {isFree ? (
          <p className="text-xs text-warning">
            Paket Free Trial hanya bisa mengunduh laporan {FREE_TIER_LIMITS.exportDays} hari (hari ini). Upgrade ke Pro untuk laporan 7 hari, bulanan, atau rentang tanggal sendiri.
          </p>
        ) : (
          minDate && (
            <p className="text-xs text-neutral-400">
              Laporan bisa dibuat mulai {minDate}. Upgrade untuk riwayat lebih panjang.
            </p>
          )
        )}

        <button
          onClick={generatePdf}
          disabled={generating}
          className="btn-primary flex items-center gap-2"
        >
          {generating ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
          {generating ? "Membuat PDF..." : `Unduh Laporan ${reportType === "full" ? "Lengkap" : "Omzet"} (PDF)`}
        </button>
      </div>

      <div className="card p-4 flex items-start gap-3 bg-neutral-50">
        <FileText className="text-neutral-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-neutral-500">
          Laporan berisi: ringkasan omzet, laba kotor (berdasarkan HPP di halaman Stok & HPP), kerugian dari
          Stok Opname (bahan basi/rusak/selisih), keuntungan bersih, rincian omzet harian, menu terlaris,
          metode pembayaran, dan kinerja tiap kasir pada periode yang dipilih.
          Kolom laba kotor akan menampilkan 0 kalau HPP menu belum diisi di halaman Stok & HPP.
        </p>
      </div>
    </div>
  );
}
