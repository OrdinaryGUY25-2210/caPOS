"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  FileSpreadsheet,
  Download,
  Loader2,
  CalendarRange,
  Lock,
  TrendingUp,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, HISTORY_DAYS_LIMIT, canUseFullExport, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton } from "@/components/Skeleton";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { fetchReportData } from "@/lib/export/data";
import { renderReportPdf, downloadPdf } from "@/lib/export/pdf";
import { buildWorkbook, downloadWorkbook, excelFilename } from "@/lib/export/excel";
import type { ExportMode } from "@/lib/export/types";

type RangeKey = "today" | "7" | "month" | "custom";

const MODES: {
  key: ExportMode;
  title: string;
  desc: string;
  icon: typeof FileText;
  tone: string;
}[] = [
  {
    key: "ringkasan",
    title: "Ringkasan",
    desc: "Omzet, HPP, laba, omzet harian, menu terlaris, pembayaran, dan kasir.",
    icon: FileText,
    tone: "border-primary bg-primary/5",
  },
  {
    key: "profit",
    title: "Hanya Keuntungan",
    desc: "Laba rugi lengkap, margin per kategori, kontribusi laba menu, dan tren laba.",
    icon: TrendingUp,
    tone: "border-emerald-500 bg-emerald-50",
  },
  {
    key: "full",
    title: "Semua Data",
    desc: "Seluruh data caPOS: penjualan, produk, stok, purchasing, pelanggan, tim, analitik.",
    icon: Layers,
    tone: "border-sky-500 bg-sky-50",
  },
];

function toISODate(d: Date) {
  // Tanggal lokal, bukan UTC — lihat catatan di app/dashboard/page.tsx.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const { selectedBranchId, selectedBranch, canSwitchBranch } = useBranch();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ message: string; pct: number } | null>(null);
  const [status, setStatus] = useState<{ type: "ok" | "warn"; text: string } | null>(null);
  const [tier, setTier] = useState<Tier>("free");
  const [role, setRole] = useState<string>("cashier");
  const [cafeName, setCafeName] = useState("Kafe Anda");
  const [mode, setMode] = useState<ExportMode>("ringkasan");
  const [range, setRange] = useState<RangeKey>("7");
  const [customStart, setCustomStart] = useState(toISODate(new Date()));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const branchName = useMemo(() => {
    if (selectedBranchId !== ALL_BRANCHES) return selectedBranch?.name ?? "Cabang";
    return "Semua Cabang";
  }, [selectedBranchId, selectedBranch]);

  const canExportAllData = canUseFullExport(tier, role);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      setTenantId(profile.tenant_id);
      setRole(profile.role ?? "cashier");

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

  async function generate() {
    if (!tenantId || generating) return;
    if (mode === "full" && !canExportAllData) {
      setStatus({ type: "warn", text: "Mode Semua Data hanya tersedia untuk Owner/Manager dengan paket Pro atau Supreme." });
      return;
    }

    setGenerating(true);
    setStatus(null);
    setProgress({ message: "Menyiapkan laporan…", pct: 2 });

    try {
      const supabase = createClient();
      const { start, end } = rangeToDates(range, customStart, customEnd);

      if (end < start) {
        setGenerating(false);
        setProgress(null);
        setStatus({ type: "warn", text: "Tanggal akhir harus sama atau lebih baru dari tanggal mulai." });
        return;
      }

      const limitDays = HISTORY_DAYS_LIMIT[tier];
      let effectiveStart = start;
      let clamped = false;
      if (limitDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - limitDays);
        cutoff.setHours(0, 0, 0, 0);
        if (end < cutoff) {
          setGenerating(false);
          setProgress(null);
          setStatus({
            type: "warn",
            text: `Paket ${tier} hanya menyimpan ${limitDays} hari terakhir. Pilih periode yang berakhir setelah ${toISODate(cutoff)}.`,
          });
          return;
        }
        if (start < cutoff) {
          effectiveStart = cutoff;
          clamped = true;
        }
      }

      const data = await fetchReportData(supabase, {
        tenantId,
        branchId: selectedBranchId === ALL_BRANCHES ? null : selectedBranchId,
        branchName,
        cafeName,
        startISO: effectiveStart.toISOString(),
        endISO: end.toISOString(),
        startLabel: toISODate(effectiveStart),
        endLabel: toISODate(end),
        tier,
        role,
        mode,
        onProgress: (message, pct) => setProgress({ message, pct: Math.min(pct, 98) }),
      });

      setProgress({ message: "Merender PDF…", pct: 92 });
      const { doc, filename } = await renderReportPdf(data);
      downloadPdf(doc, filename);

      if (mode === "full") {
        setProgress({ message: "Menyiapkan Excel lengkap…", pct: 96 });
        const wb = buildWorkbook(data);
        downloadWorkbook(wb, excelFilename(data));
      }

      try {
        await supabase.from("export_logs").insert({
          tenant_id: tenantId,
          branch_id: selectedBranchId === ALL_BRANCHES ? null : selectedBranchId,
          user_id: (await getCurrentProfile()).profile?.id ?? null,
          mode,
          period_start: toISODate(effectiveStart),
          period_end: toISODate(end),
          row_count: data.raw.transactions.length,
          status: "SUCCESS",
        });
      } catch {
        // Tabel export_logs mungkin belum dimigrasikan — export tetap jalan.
      }

      setProgress({ message: "Selesai", pct: 100 });
      const parts = [mode === "full" ? "PDF + Excel" : "PDF", `${data.raw.transactions.length} transaksi`];
      if (clamped) parts.push(`periode dipotong ke ${limitDays} hari sesuai paket ${tier}`);
      if (data.warnings.length) parts.push(`${data.warnings.length} catatan`);
      setStatus({
        type: clamped || data.warnings.length ? "warn" : "ok",
        text: `Berhasil membuat ${parts.join(" · ")}.`,
      });
      setTimeout(() => setProgress(null), 1500);
    } catch (err: any) {
      setProgress(null);
      setStatus({ type: "warn", text: `Gagal membuat laporan: ${err?.message ?? "kesalahan tidak diketahui"}` });
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
        <h1 className="text-xl font-bold text-neutral-900">Laporan &amp; Export PDF</h1>
        {isDemo && <DemoBadge />}
        <p className="text-sm text-neutral-500">
          Pilih jenis laporan, cabang, dan periode. Ringkasan dan Hanya Keuntungan menghasilkan PDF;
          Semua Data menghasilkan PDF ringkas plus Excel lengkap.
          {canSwitchBranch && ` Cabang aktif: ${branchName}.`}
        </p>
      </div>

      {/* Mode */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          const locked = m.key === "full" && !canExportAllData;
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                if (locked) return;
                setMode(m.key);
                setStatus(null);
              }}
              disabled={locked}
              className={cx(
                "text-left rounded-xl border p-4 transition",
                active ? `${m.tone} shadow-sm` : "border-neutral-200 bg-white hover:border-neutral-300",
                locked && "opacity-60 cursor-not-allowed"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-neutral-900">
                  <Icon size={16} className="text-primary-dark" />
                  {m.title}
                </div>
                {locked ? <Lock size={14} className="text-neutral-400" /> : active ? <CheckCircle2 size={16} className="text-primary-dark" /> : null}
              </div>
              <p className="text-xs text-neutral-500 mt-2 leading-relaxed">{m.desc}</p>
              {locked && <p className="text-[11px] text-amber-600 mt-2">Perlu paket Pro/Supreme + role Owner/Manager.</p>}
            </button>
          );
        })}
      </div>

      {/* Filter */}
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
            Paket {tier === "free" ? "Free Trial" : tier === "pro" ? "Pro" : "Supreme"} hanya bisa membuat laporan mulai {minDate}.
            Periode lebih panjang otomatis dipotong.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={generate} disabled={generating} className="btn-primary flex items-center gap-2">
            {generating ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            {generating ? "Membuat laporan…" : mode === "full" ? "Unduh PDF + Excel" : "Buat & Unduh PDF"}
          </button>
          {mode === "full" && (
            <span className="text-xs text-neutral-500 flex items-center gap-1">
              <FileSpreadsheet size={14} /> Excel berisi seluruh baris; PDF memuat ringkasan + sampel.
            </span>
          )}
        </div>

        {progress && (
          <div className="space-y-1">
            <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="text-xs text-neutral-500">{progress.message}</p>
          </div>
        )}

        {status && (
          <div
            className={cx(
              "flex items-start gap-2 text-xs rounded-lg p-3",
              status.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            )}
          >
            {status.type === "ok" ? <CheckCircle2 size={14} className="mt-0.5" /> : <AlertTriangle size={14} className="mt-0.5" />}
            <span>{status.text}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="card p-4 flex items-start gap-3 bg-neutral-50">
        <FileText className="text-neutral-400 shrink-0 mt-0.5" size={18} />
        <div className="text-xs text-neutral-500 space-y-1">
          <p>
            <strong>Ringkasan</strong> memuat omzet, HPP, laba kotor/bersih, <strong>rincian kerugian</strong>
            (stok opname, waste produk, waste bahan), omzet harian, menu terlaris, pembayaran, dan kasir.
          </p>
          <p>
            <strong>Hanya Keuntungan</strong> memuat laporan laba rugi, margin per kategori, kontribusi laba
            per menu, tren laba harian, detail kerugian, dan perbandingan cabang.
          </p>
          <p>
            <strong>Semua Data</strong> memuat seluruh domain caPOS: omzet, kerugian, penjualan, produk,
            resep, stok, purchasing, pelanggan, tim, dan analitik. Data sensitif (PIN, kunci pembayaran,
            respons mentah gateway) tidak pernah disertakan; telepon/email pelanggan dimask.
          </p>
          <p className="text-neutral-400">
            HPP memakai snapshot transaksi → HPP cabang → HPP produk. Bila sebagian item belum punya
            snapshot, laporan menandainya sebagai estimasi.
          </p>
        </div>
      </div>
    </div>
  );
}
