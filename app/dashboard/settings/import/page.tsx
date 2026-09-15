"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  Upload,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Download,
  Coffee,
  Layers,
  SlidersHorizontal,
  Wheat,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { cx } from "@/lib/utils";

/**
 * Phase 2A.2 §9-10 (Revision 01) — Data Import / Migration.
 *
 * SCOPE, DELIBERATELY NARROWED: the brief lists Products/Menu, Variants,
 * Modifiers, Ingredients, and Customers as import targets. This increment
 * implements Products/Menu ONLY, end-to-end and for real (parse → map →
 * validate → transactional-per-row commit → result report). The other four
 * are shown as disabled "Segera Hadir" options rather than being half-built:
 *   - Variants/Modifiers import needs a real design for how an imported row
 *     attaches to a *specific* product (a variant/modifier without a parent
 *     product is meaningless) — not audited yet.
 *   - Ingredients import interacts with recipe/HPP linking, which has real
 *     business-rule implications (a wrong unit or wrong ingredient linked to
 *     a recipe silently breaks HPP/COGS math) that need their own audit.
 *   - Customers import touches `memberships` (unique `member_code`
 *     generation, phone-number-based dedup) — same reasoning.
 * Building fake UI for these that doesn't actually import anything would be
 * exactly the "fake capability" the brief itself says not to build (§9).
 *
 * SAFETY:
 *   - No blind bulk insert. Rows are inserted ONE AT A TIME through the
 *     exact same `products` insert shape used by the existing Menu page
 *     (`tenant_id`, `name`, `price`, `category`, `is_available: true`), so
 *     they go through the same RLS + `enforce_menu_limit()` trigger that
 *     already protects Free-tier tenants — see app/dashboard/menu/page.tsx.
 *   - If the trigger rejects a row for hitting the Free-tier menu limit,
 *     the import STOPS (does not keep silently skipping and inserting the
 *     rest) and shows the upgrade message, exactly like the brief's example
 *     ("plan allows 10 products" — not silently create 50).
 *   - No new database table/column was created for this. Import history is
 *     NOT persisted anywhere (no "import runs" table exists) — each import
 *     is a one-time session; the result screen is the only record, plus the
 *     downloadable CSV error report. If persistent import history is
 *     genuinely wanted later, that's a new table and goes through the same
 *     DB-change gate as everything else in this phase.
 */

type Step = "type" | "upload" | "mapping" | "preview" | "importing" | "result";

type ParsedRow = Record<string, string>;

interface MappedRow {
  rowIndex: number;
  name: string;
  price: number | null;
  category: string;
  errors: string[];
  isDuplicate: boolean;
}

interface ImportResultRow {
  rowIndex: number;
  name: string;
  status: "success" | "skipped_duplicate" | "skipped_invalid" | "failed";
  reason?: string;
}

const DATA_TYPES = [
  { key: "products", label: "Produk / Menu", icon: Coffee, enabled: true },
  { key: "variants", label: "Varian Produk", icon: Layers, enabled: false },
  { key: "modifiers", label: "Modifier", icon: SlidersHorizontal, enabled: false },
  { key: "ingredients", label: "Bahan Baku", icon: Wheat, enabled: false },
  { key: "customers", label: "Pelanggan", icon: UserRound, enabled: false },
] as const;

const REQUIRED_FIELDS: { key: "name" | "price" | "category"; label: string; required: boolean }[] = [
  { key: "name", label: "Nama Produk", required: true },
  { key: "price", label: "Harga Jual", required: true },
  { key: "category", label: "Kategori", required: false },
];

function guessColumn(headers: string[], candidates: string[]): string {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return headers[idx];
  }
  return "";
}

export default function DataImportPage() {
  const [step, setStep] = useState<Step>("type");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [mapping, setMapping] = useState<{ name: string; price: string; category: string }>({
    name: "",
    price: "",
    category: "",
  });

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>("free");
  const [existingProductCount, setExistingProductCount] = useState(0);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState<ImportResultRow[]>([]);
  const [limitHit, setLimitHit] = useState(false);

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });

      if (grid.length < 2) {
        setParseError("File tidak berisi data (butuh minimal 1 baris header + 1 baris data).");
        return;
      }

      const rawHeaders = (grid[0] as string[]).map((h) => String(h ?? "").trim());
      const dataRows = grid.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));

      const parsed: ParsedRow[] = dataRows.map((r) => {
        const obj: ParsedRow = {};
        rawHeaders.forEach((h, i) => {
          obj[h] = String(r[i] ?? "").trim();
        });
        return obj;
      });

      setHeaders(rawHeaders);
      setRows(parsed);
      setMapping({
        name: guessColumn(rawHeaders, ["product name", "nama produk", "nama", "name", "produk", "menu"]),
        price: guessColumn(rawHeaders, ["price", "harga", "selling price", "harga jual"]),
        category: guessColumn(rawHeaders, ["category", "kategori"]),
      });

      // Muat konteks tenant (tier + produk yang sudah ada) untuk deteksi
      // duplikat & estimasi sisa kuota Free Trial SEBELUM user sampai ke
      // langkah preview — supaya tidak ada kejutan "gagal" tanpa penjelasan.
      const { profile } = await getCurrentProfile();
      if (profile) {
        setTenantId(profile.tenant_id);
        const supabase = createClient();
        const [{ data: products }, { data: sub }] = await Promise.all([
          supabase.from("products").select("name").eq("tenant_id", profile.tenant_id),
          supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
        ]);
        setExistingProductCount(products?.length ?? 0);
        setExistingNames(new Set((products ?? []).map((p) => p.name.trim().toLowerCase())));
        setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
      }

      setStep("mapping");
    } catch {
      setParseError("Gagal membaca file. Pastikan formatnya CSV atau Excel (.xlsx/.xls) yang valid.");
    }
  }

  const mappedRows: MappedRow[] = useMemo(() => {
    if (!mapping.name) return [];
    const seenInFile = new Set<string>();
    return rows.map((r, i) => {
      const name = mapping.name ? r[mapping.name] ?? "" : "";
      const priceRaw = mapping.price ? r[mapping.price] ?? "" : "";
      const priceNum = priceRaw ? Number(String(priceRaw).replace(/[^\d.-]/g, "")) : NaN;
      const category = mapping.category ? r[mapping.category] ?? "" : "";

      const errors: string[] = [];
      if (!name) errors.push("Nama produk kosong");
      if (!priceRaw || Number.isNaN(priceNum) || priceNum <= 0) errors.push("Harga tidak valid");

      const key = name.trim().toLowerCase();
      const isDuplicate = !!key && (existingNames.has(key) || seenInFile.has(key));
      if (key) seenInFile.add(key);

      return {
        rowIndex: i,
        name: name.trim(),
        price: Number.isNaN(priceNum) ? null : priceNum,
        category: category.trim() || "Lainnya",
        errors,
        isDuplicate,
      };
    });
  }, [rows, mapping, existingNames]);

  const validRows = mappedRows.filter((r) => r.errors.length === 0 && !r.isDuplicate);
  const invalidRows = mappedRows.filter((r) => r.errors.length > 0);
  const duplicateRows = mappedRows.filter((r) => r.errors.length === 0 && r.isDuplicate);

  const remainingSlots =
    tier === "free" ? Math.max(0, FREE_TIER_LIMITS.maxMenu - existingProductCount) : null;

  async function runImport() {
    if (!tenantId) return;
    setStep("importing");
    setImporting(true);
    setLimitHit(false);
    setImportProgress(0);

    const supabase = createClient();
    const outcomes: ImportResultRow[] = mappedRows.map((r) => {
      if (r.errors.length > 0) return { rowIndex: r.rowIndex, name: r.name || "(tanpa nama)", status: "skipped_invalid", reason: r.errors.join(", ") };
      if (r.isDuplicate) return { rowIndex: r.rowIndex, name: r.name, status: "skipped_duplicate", reason: "Nama sama dengan produk yang sudah ada" };
      return { rowIndex: r.rowIndex, name: r.name, status: "failed" as const };
    });

    let stoppedByLimit = false;
    for (const row of validRows) {
      if (stoppedByLimit) {
        const idx = outcomes.findIndex((o) => o.rowIndex === row.rowIndex);
        outcomes[idx] = { rowIndex: row.rowIndex, name: row.name, status: "failed", reason: "Dihentikan — batas paket tercapai" };
        continue;
      }

      const { error } = await supabase.from("products").insert({
        tenant_id: tenantId,
        name: row.name,
        price: row.price,
        category: row.category,
        is_available: true,
      });

      const idx = outcomes.findIndex((o) => o.rowIndex === row.rowIndex);
      if (error) {
        if (error.message.includes("FREE_TIER_MENU_LIMIT")) {
          stoppedByLimit = true;
          setLimitHit(true);
          outcomes[idx] = { rowIndex: row.rowIndex, name: row.name, status: "failed", reason: `Batas paket ${TIER_LABEL.free} (${FREE_TIER_LIMITS.maxMenu} menu) tercapai` };
        } else {
          outcomes[idx] = { rowIndex: row.rowIndex, name: row.name, status: "failed", reason: error.message };
        }
      } else {
        outcomes[idx] = { rowIndex: row.rowIndex, name: row.name, status: "success" };
      }
      setImportProgress((p) => p + 1);
    }

    setResults(outcomes);
    setImporting(false);
    setStep("result");
  }

  function downloadErrorReport() {
    const failed = results.filter((r) => r.status !== "success");
    const csvRows = [
      ["Baris", "Nama", "Status", "Alasan"],
      ...failed.map((r) => [String(r.rowIndex + 2), r.name, r.status, r.reason ?? ""]),
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hasil-import-produk.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetAll() {
    setStep("type");
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setParseError(null);
    setMapping({ name: "", price: "", category: "" });
    setResults([]);
    setImportProgress(0);
    setLimitHit(false);
  }

  const STEP_ORDER: Step[] = ["type", "upload", "mapping", "preview", "importing", "result"];
  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/settings" className="text-sm text-neutral-500 hover:underline flex items-center gap-1 mb-2">
          <ArrowLeft size={14} /> Kembali ke Pengaturan
        </Link>
        <h1 className="text-xl font-bold text-neutral-900">Import / Migrasi Data</h1>
        <p className="text-sm text-neutral-500">
          Pindahkan data dari POS/aplikasi lain ke caPOS lewat file CSV atau Excel.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        {["Jenis Data", "Unggah File", "Pemetaan Kolom", "Preview & Validasi", "Import"].map((label, i) => (
          <div key={label} className={cx("flex items-center gap-1.5", i > 0 && "flex-1")}>
            {i > 0 && <div className={cx("h-px flex-1", i <= stepIndex ? "bg-primary" : "bg-neutral-200")} />}
            <span className={i <= stepIndex ? "text-primary-dark" : ""}>{label}</span>
          </div>
        ))}
      </div>

      {step === "type" && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-neutral-900 text-sm">Pilih jenis data yang ingin diimpor</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {DATA_TYPES.map((dt) => {
              const Icon = dt.icon;
              return (
                <button
                  key={dt.key}
                  type="button"
                  disabled={!dt.enabled}
                  onClick={() => dt.enabled && setStep("upload")}
                  className={cx(
                    "flex items-center gap-3 p-4 rounded-xl border text-left transition-colors",
                    dt.enabled
                      ? "border-neutral-200 hover:border-primary hover:bg-primary-light/30 cursor-pointer"
                      : "border-neutral-100 bg-neutral-50 cursor-not-allowed opacity-60"
                  )}
                >
                  <Icon size={20} className={dt.enabled ? "text-primary-dark" : "text-neutral-400"} />
                  <div>
                    <p className="text-sm font-medium text-neutral-800">{dt.label}</p>
                    {!dt.enabled && <p className="text-xs text-neutral-400">Segera Hadir</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "upload" && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-neutral-900 text-sm">Unggah file Produk / Menu</h2>
          <p className="text-xs text-neutral-500">
            Format CSV atau Excel (.xlsx/.xls). Baris pertama harus berisi nama kolom (header).
          </p>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-primary-light/20 transition-colors"
          >
            <Upload className="mx-auto text-neutral-400 mb-2" size={28} />
            <p className="text-sm text-neutral-600">Klik untuk pilih file, atau seret file ke sini</p>
            {fileName && <p className="text-xs text-primary-dark font-medium mt-2">{fileName}</p>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          {parseError && (
            <p className="text-sm text-urgent flex items-center gap-1.5">
              <XCircle size={14} /> {parseError}
            </p>
          )}
          <button onClick={() => setStep("type")} className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1.5 w-fit">
            <ArrowLeft size={14} /> Kembali
          </button>
        </div>
      )}

      {step === "mapping" && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-neutral-900 text-sm">Pemetaan Kolom</h2>
          <p className="text-xs text-neutral-500">
            {rows.length} baris data terdeteksi. Cocokkan kolom di file Anda dengan field caPOS.
          </p>
          <div className="space-y-3">
            {REQUIRED_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                <label className="text-sm font-medium text-neutral-700">
                  {f.label} {f.required && <span className="text-urgent">*</span>}
                </label>
                <select
                  value={mapping[f.key]}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="input-field"
                >
                  <option value="">— Tidak dipetakan —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep("upload")} className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1.5">
              <ArrowLeft size={14} /> Kembali
            </button>
            <button
              onClick={() => setStep("preview")}
              disabled={!mapping.name || !mapping.price}
              className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
            >
              Lanjut ke Preview <ArrowRight size={14} />
            </button>
          </div>
          {(!mapping.name || !mapping.price) && (
            <p className="text-xs text-warning">Nama Produk dan Harga Jual wajib dipetakan sebelum lanjut.</p>
          )}
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-neutral-900">{mappedRows.length}</p>
              <p className="text-xs text-neutral-500">Total Baris</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-primary-dark">{validRows.length}</p>
              <p className="text-xs text-neutral-500">Valid</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-urgent">{invalidRows.length + duplicateRows.length}</p>
              <p className="text-xs text-neutral-500">Invalid / Duplikat</p>
            </div>
          </div>

          {tier === "free" && (
            <div className="badge-warning w-full justify-start px-3 py-2 rounded-lg">
              <AlertTriangle size={14} />
              Paket {TIER_LABEL.free}: sisa kuota {remainingSlots} dari {FREE_TIER_LIMITS.maxMenu} menu.
              {remainingSlots !== null && validRows.length > remainingSlots && (
                <> File ini berisi {validRows.length} produk valid — hanya {remainingSlots} pertama yang akan berhasil diimpor, sisanya akan ditandai gagal karena batas paket.</>
              )}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Baris</th>
                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Nama</th>
                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Harga</th>
                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Kategori</th>
                    <th className="text-left px-3 py-2 font-medium text-neutral-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.map((r) => (
                    <tr key={r.rowIndex} className="border-t border-neutral-100">
                      <td className="px-3 py-2 text-neutral-400">{r.rowIndex + 2}</td>
                      <td className="px-3 py-2">{r.name || <span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2">{r.price ?? <span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2">{r.category}</td>
                      <td className="px-3 py-2">
                        {r.errors.length > 0 ? (
                          <span className="badge-urgent">{r.errors.join(", ")}</span>
                        ) : r.isDuplicate ? (
                          <span className="badge-warning">Duplikat</span>
                        ) : (
                          <span className="badge-active">Valid</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep("mapping")} className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1.5">
              <ArrowLeft size={14} /> Kembali
            </button>
            <button
              onClick={runImport}
              disabled={validRows.length === 0}
              className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
            >
              Import {validRows.length} Produk Valid <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="card p-8 text-center space-y-3">
          <Loader2 className="mx-auto animate-spin text-primary" size={28} />
          <p className="text-sm font-medium text-neutral-700">
            Mengimpor {importProgress} / {validRows.length} produk...
          </p>
          <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${validRows.length ? (importProgress / validRows.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {step === "result" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <CheckCircle2 className="mx-auto text-primary-dark mb-1" size={20} />
              <p className="text-2xl font-bold text-neutral-900">{results.filter((r) => r.status === "success").length}</p>
              <p className="text-xs text-neutral-500">Berhasil</p>
            </div>
            <div className="card p-4 text-center">
              <AlertTriangle className="mx-auto text-warning mb-1" size={20} />
              <p className="text-2xl font-bold text-neutral-900">
                {results.filter((r) => r.status === "skipped_duplicate" || r.status === "skipped_invalid").length}
              </p>
              <p className="text-xs text-neutral-500">Dilewati</p>
            </div>
            <div className="card p-4 text-center">
              <XCircle className="mx-auto text-urgent mb-1" size={20} />
              <p className="text-2xl font-bold text-neutral-900">{results.filter((r) => r.status === "failed").length}</p>
              <p className="text-xs text-neutral-500">Gagal</p>
            </div>
          </div>

          {limitHit && (
            <div className="badge-warning w-full justify-start px-3 py-2 rounded-lg">
              <AlertTriangle size={14} />
              Import dihentikan karena batas paket {TIER_LABEL.free} ({FREE_TIER_LIMITS.maxMenu} menu) tercapai.{" "}
              <Link href="/dashboard/subscription" className="underline font-medium">
                Upgrade ke Pro
              </Link>{" "}
              untuk melanjutkan sisa produk.
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={downloadErrorReport} className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1.5">
              <Download size={14} /> Unduh Laporan Hasil (CSV)
            </button>
            <Link href="/dashboard/menu" className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
              Lihat Menu <ArrowRight size={14} />
            </Link>
            <button onClick={resetAll} className="text-sm text-neutral-500 hover:underline px-3 py-1.5">
              Import file lain
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
