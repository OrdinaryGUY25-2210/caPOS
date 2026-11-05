/**
 * lib/export/excel.ts — export Excel lengkap (satu workbook, banyak sheet).
 *
 * Dipakai untuk mode "Semua Data" sebagai pelengkap PDF: PDF memuat ringkasan
 * + sampel baris, Excel memuat seluruh baris numerik yang bisa diolah lagi.
 */

import * as XLSX from "xlsx";
import type { ReportData } from "@/lib/export/types";

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function columnWidths(rows: (string | number)[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of rows.slice(0, 200)) {
    row.forEach((cell, idx) => {
      const len = String(cell ?? "").length;
      widths[idx] = Math.max(widths[idx] ?? 10, Math.min(len + 2, 40));
    });
  }
  return widths.map((w) => ({ wch: w }));
}

export function buildWorkbook(data: ReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const infoRows: (string | number)[][] = [
    ["caPOS — Export Data Lengkap"],
    ["Kafe", data.scope.cafeName],
    ["Cabang", data.scope.branchId ? data.scope.branchName : "Semua Cabang (Konsolidasi)"],
    ["Periode", `${data.scope.startLabel} s/d ${data.scope.endLabel}`],
    ["Dibuat", new Date(data.scope.generatedAt).toLocaleString("id-ID")],
    ["Paket", data.scope.tier],
    [],
    ["Metrik", "Nilai"],
    ["Omzet", data.metrics.omzet],
    ["Subtotal", data.metrics.subtotal],
    ["Diskon", data.metrics.diskon],
    ["HPP", data.metrics.hpp],
    ["Laba Kotor", data.metrics.labaKotor],
    ["Susut Stok", data.metrics.susutStok],
    ["Komisi Channel", data.metrics.komisiChannel],
    ["Biaya Operasional", data.metrics.opex],
    ["Laba Bersih", data.metrics.labaBersih],
    ["Margin Kotor (%)", Number(data.metrics.marginKotorPct.toFixed(2))],
    ["Jumlah Transaksi", data.metrics.totalTransaksi],
    ["Item Terjual", data.metrics.itemTerjual],
    ["Status HPP", data.metrics.hppAktual ? "Aktual" : "Estimasi"],
    [],
    ["Catatan"],
    ...data.warnings.map((w) => [w]),
  ];
  const info = XLSX.utils.aoa_to_sheet(infoRows);
  info["!cols"] = [{ wch: 26 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, info, sanitizeSheetName("Info", used));

  for (const section of data.sections) {
    const rows = section.rows.length > 100000 ? section.rows.slice(0, 100000) : section.rows;
    const aoa = [section.head, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = columnWidths(aoa);
    ws["!freeze"] = { xSplit: "0", ySplit: "1" } as any;
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(section.title, used));
  }

  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function localStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function excelFilename(data: ReportData): string {
  const branch = (data.scope.branchId ? data.scope.branchName : "semua-cabang")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "semua-cabang";
  const stamp = localStamp(new Date(data.scope.generatedAt));
  return `capos-semua-data-${branch}-${stamp}.xlsx`;
}
