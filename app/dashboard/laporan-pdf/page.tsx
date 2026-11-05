"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Download, Loader2, CalendarRange, Eye, FileSpreadsheet, ShieldCheck, Info } from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, earliestAllowedDate, canExportFullData, canExportPdf, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton } from "@/components/Skeleton";
import PremiumFeatureLock from "@/components/PremiumFeatureLock";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import type { ExportMode, ProfitReport } from "@/lib/types";
import { demoProfitReport, getProfitReport, logExport, toExportError } from "@/lib/exportApi";
import { hppQuality } from "@/lib/metrics";
import { isoDay, slug, ymd } from "@/lib/pdf/common";
import { buildSummaryPdf } from "@/lib/pdf/summaryPdf";
import { buildProfitPdf } from "@/lib/pdf/profitPdf";
import { estimateFullExport, runFullExport } from "@/lib/export/fullExport";

type RangeKey = "today" | "7" | "30" | "month" | "custom";

function rangeToDates(range: RangeKey, customStart: string, customEnd: string) {
  const now = new Date();
  let start: Date;
  let end: Date = new Date(now);
  if (range === "today") start = new Date(now);
  else if (range === "7") { start = new Date(now); start.setDate(start.getDate() - 6); }
  else if (range === "30") { start = new Date(now); start.setDate(start.getDate() - 29); }
  else if (range === "month") start = new Date(now.getFullYear(), now.getMonth(), 1);
  else {
    start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(now);
    end = customEnd ? new Date(`${customEnd}T00:00:00`) : new Date(now);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const MODES: { key: ExportMode; title: string; desc: string }[] = [
  { key: "ringkasan", title: "Ringkasan", desc: "Omzet, HPP, laba, omzet harian, menu terlaris, metode pembayaran (2–4 halaman)." },
  { key: "laba", title: "Hanya Keuntungan", desc: "Laba rugi, margin per kategori, menu penyumbang laba, tren laba, perbandingan cabang." },
  { key: "semua_data", title: "Semua Data", desc: "Seluruh data caPOS: penjualan, kerugian/susut, stok, purchasing, pelanggan, tim, analitik. PDF + Excel." },
];

function Inner() {
  const { selectedBranchId, selectedBranch } = useBranch();
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<Tier>("free");
  const [role, setRole] = useState<string | null>(null);
  const [cafeName, setCafeName] = useState("Kafe Anda");
  const [isDemo, setIsDemo] = useState(false);
  const [mode, setMode] = useState<ExportMode>("ringkasan");
  const [range, setRange] = useState<RangeKey>("7");
  const [customStart, setCustomStart] = useState(isoDay(new Date()));
  const [customEnd, setCustomEnd] = useState(isoDay(new Date()));
  const [unmask, setUnmask] = useState(false);
  const [busy, setBusy] = useState<null | "download" | "preview" | "excel">(null);
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<ReturnType<typeof hppQuality> | null>(null);
  const [est, setEst] = useState<{ total: number; estKB: number; estPages: number; mode: "pdf" | "excel" } | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return setLoading(false);
      const supabase = createClient();
      const [{ data: sub }, { data: tenant }] = await Promise.all([
        supabase.from("subscriptions").select("status, plan, super_trial_ends_at").eq("tenant_id", profile.tenant_id).single(),
        supabase.from("tenants").select("name").eq("id", profile.tenant_id).single(),
      ]);
      setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
      setRole(profile.role);
      if (tenant?.name) setCafeName(tenant.name);
      if (await tenantHasNoActivity()) setIsDemo(true);
      setLoading(false);
    })();
  }, []);

  const branchId = selectedBranchId === ALL_BRANCHES ? null : selectedBranchId;
  const branchLabel = selectedBranchId === ALL_BRANCHES ? "Semua Cabang (Konsolidasi)" : selectedBranch?.name ?? "-";
  const minAllowed = earliestAllowedDate(tier);
  const fullAllowed = canExportFullData(tier, role);

  const { start, end, clamped } = useMemo(() => {
    const r = rangeToDates(range, customStart, customEnd);
    let s = r.start;
    let wasClamped = false;
    if (minAllowed && s < minAllowed) { s = new Date(minAllowed); wasClamped = true; }
    return { start: s, end: r.end, clamped: wasClamped };
  }, [range, customStart, customEnd, minAllowed]);

  const invalidRange = end < start;
  const periodLabel = `${isoDay(start)} s/d ${isoDay(end)}`;

  // Perkiraan ukuran untuk mode "Semua Data"
  useEffect(() => {
    setEst(null);
    if (mode !== "semua_data" || !fullAllowed || isDemo || invalidRange || loading) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const e = await estimateFullExport({ branchId, from: start, to: end });
        if (!cancelled) setEst({ total: e.total, estKB: e.estKB, estPages: e.estPages, mode: e.mode });
      } catch (err) { if (!cancelled) setError(toExportError(err).message); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, fullAllowed, isDemo, invalidRange, loading, branchId, start, end]);

  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function generate(action: "download" | "preview" | "excel") {
    setError(null); setNotice(null);
    if (!canExportPdf(tier)) return setError("Export PDF tidak tersedia di Free Trial. Upgrade ke Pro atau Supreme.");
    if (invalidRange) return setError("Tanggal akhir harus sama atau setelah tanggal awal.");
    setBusy(action); setProgress({ pct: 3, msg: "Menyiapkan..." });
    const meta = { cafeName, branchLabel, periodLabel };
    try {
      if (mode === "semua_data") {
        if (!fullAllowed) throw new Error("Mode Semua Data hanya untuk Owner/Manager paket Pro atau Supreme.");
        if (isDemo) throw new Error("Belum ada data transaksi untuk diekspor. Mode Semua Data aktif setelah ada aktivitas.");
        const res = await runFullExport(
          { branchId, branchLabel, cafeName, from: start, to: end, periodLabel, tier, unmask, onProgress: (pct, msg) => setProgress({ pct, msg }) },
          action === "excel" ? "excel" : "pdf"
        );
        if (action === "preview" && res.kind === "pdf") window.open(URL.createObjectURL(res.blob), "_blank");
        else save(res.blob, res.fileName);
        await logExport({ mode: "semua_data", branchId, from: start, to: end, rowCount: res.totalRows, fileName: res.fileName, unmasked: res.unmasked });
        if (res.truncated) setNotice("Sebagian tabel melebihi batas baris paket Anda dan dipotong. Unduh Excel untuk rincian lengkap per tabel.");
        else if (res.kind === "excel") setNotice("Data lengkap diekspor sebagai satu file Excel: satu sheet per tabel + sheet Manifest.");
      } else {
        setProgress({ pct: 30, msg: "Menghitung laporan..." });
        const report: ProfitReport = isDemo ? demoProfitReport(start, end) : await getProfitReport({ branchId, from: start, to: end });
        setQuality(hppQuality(report.summary.hpp_lines_actual, report.summary.hpp_lines_estimate));
        setProgress({ pct: 70, msg: "Membuat PDF..." });
        const prefix = mode === "laba" ? "laba" : "ringkasan";
        const fileName = `capos-${prefix}-${slug(branchLabel)}-${ymd(end)}.pdf`;
        const doc = mode === "laba" ? await buildProfitPdf(report, { ...meta, fileName }) : await buildSummaryPdf(report, { ...meta, fileName });
        if (action === "preview") window.open(URL.createObjectURL(doc.output("blob")), "_blank");
        else doc.save(fileName);
        if (!isDemo) await logExport({ mode, branchId, from: start, to: end, rowCount: report.summary.transaksi, fileName });
      }
      setProgress({ pct: 100, msg: "Selesai" });
    } catch (e: any) {
      setError(toExportError(e).message);
    } finally {
      setBusy(null);
      setTimeout(() => setProgress(null), 1500);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-56" />
        <div className="card p-5 space-y-4"><Skeleton className="h-9 w-64 rounded-lg" /><Skeleton className="h-10 w-56 rounded-xl" /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-neutral-900">Laporan PDF</h1>
          {isDemo && <DemoBadge />}
        </div>
        <p className="text-sm text-neutral-500">
          Pilih jenis laporan, cabang, dan periode. Dibuat saat Anda menekan tombol unduh (belum ada pengiriman terjadwal).
          Cabang mengikuti pilihan di navbar: <b>{branchLabel}</b>.
        </p>
      </div>

      <div className="card p-5 space-y-5">
        <div className="grid gap-2 md:grid-cols-3">
          {MODES.map((m) => {
            const locked = m.key === "semua_data" && !fullAllowed;
            return (
              <button
                key={m.key}
                disabled={locked}
                onClick={() => setMode(m.key)}
                className={cx(
                  "text-left rounded-xl border p-3 transition",
                  mode === m.key ? "border-primary bg-primary/5" : "border-neutral-200 hover:border-neutral-300",
                  locked && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
                  <span className={cx("inline-block w-3 h-3 rounded-full border", mode === m.key ? "bg-primary border-primary" : "border-neutral-400")} />
                  {m.title}
                </div>
                <p className="text-xs text-neutral-500 mt-1">{locked ? "Hanya Owner/Manager paket Pro atau Supreme." : m.desc}</p>
              </button>
            );
          })}
        </div>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-2 block">Periode</label>
          <div className="flex flex-wrap gap-1 bg-neutral-100 rounded-lg p-1 w-fit">
            {([["today", "Hari Ini"], ["7", "7 Hari"], ["30", "30 Hari"], ["month", "Bulan Ini"], ["custom", "Custom"]] as [RangeKey, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} className={cx("px-3 py-1.5 rounded-md text-sm font-medium", range === key ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500")}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange size={16} className="text-neutral-400" />
            <input type="date" value={customStart} min={minAllowed ? isoDay(minAllowed) : undefined} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className="input-field w-auto" />
            <span className="text-neutral-400 text-sm">s/d</span>
            <input type="date" value={customEnd} min={customStart} max={isoDay(new Date())} onChange={(e) => setCustomEnd(e.target.value)} className="input-field w-auto" />
          </div>
        )}

        <p className="text-xs text-neutral-500">Periode laporan: <b>{periodLabel}</b></p>
        {clamped && (
          <p className="text-xs text-amber-700 flex items-center gap-1.5"><Info size={14} /> Periode dipotong sesuai batas riwayat paket Anda (Pro: 30 hari terakhir).</p>
        )}

        {mode === "semua_data" && fullAllowed && (
          <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1.5">
            <p className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-primary" /> Telepon, email pelanggan, dan rekening pemasok disamarkan. PIN, kunci pembayaran & kredensial tidak pernah diekspor.</p>
            {est ? (
              <p>Perkiraan: {est.total.toLocaleString("id-ID")} baris · ±{est.estPages} halaman · ±{est.estKB.toLocaleString("id-ID")} KB · {est.mode === "pdf" ? "satu file PDF" : "PDF ringkas + satu file Excel"}.</p>
            ) : (<p>Menghitung perkiraan ukuran...</p>)}
            {(role === "owner" || role === "super_admin") && (
              <label className="flex items-center gap-2 pt-1">
                <input type="checkbox" checked={unmask} onChange={(e) => {
                  if (e.target.checked && !window.confirm("Data pelanggan & rekening akan ditampilkan lengkap di file. Pastikan file disimpan aman. Lanjutkan?")) return;
                  setUnmask(e.target.checked);
                }} />
                Tampilkan data pribadi lengkap (tanpa samaran) — tercatat di audit
              </label>
            )}
          </div>
        )}

        {quality && mode !== "semua_data" && (
          <p className={cx("text-xs inline-block rounded-full px-2.5 py-1", quality.level === "aktual" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")} title={quality.note}>
            {quality.label}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => generate("preview")} disabled={!!busy || invalidRange} className="btn-outline flex items-center gap-2">
            {busy === "preview" ? <Loader2 className="animate-spin" size={16} /> : <Eye size={16} />} Preview
          </button>
          <button onClick={() => generate("download")} disabled={!!busy || invalidRange} className="btn-primary flex items-center gap-2">
            {busy === "download" ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            {mode === "semua_data" && est?.mode === "excel" ? "Unduh PDF Ringkas" : "Unduh PDF"}
          </button>
          {mode === "semua_data" && fullAllowed && (
            <button onClick={() => generate("excel")} disabled={!!busy || invalidRange} className="btn-outline flex items-center gap-2">
              {busy === "excel" ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />} Unduh Excel
            </button>
          )}
        </div>

        {progress && (
          <div>
            <div className="h-2 rounded-full bg-neutral-100 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} /></div>
            <p className="text-xs text-neutral-500 mt-1">{progress.msg}</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-amber-700">{notice}</p>}
      </div>

      <div className="card p-4 flex items-start gap-3 bg-neutral-50">
        <FileText className="text-neutral-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-neutral-500">
          Semua angka memakai definisi yang sama dengan halaman Laporan & Omzet. HPP memakai snapshot saat transaksi terjadi;
          transaksi lama (sebelum fitur ini) ditandai estimasi. Laba bersih belum memasukkan biaya operasional bila modul Pengeluaran belum dipakai.
        </p>
      </div>
    </div>
  );
}

export default function LaporanPdfPage() {
  return (
    <PremiumFeatureLock featureName="Laporan PDF" minTier="pro">
      <Inner />
    </PremiumFeatureLock>
  );
}
