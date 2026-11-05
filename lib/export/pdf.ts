/**
 * lib/export/pdf.ts — renderer PDF 3 mode (Ringkasan / Hanya Keuntungan / Semua Data).
 *
 * Memakai jsPDF + jspdf-autotable yang sudah menjadi dependensi aplikasi.
 * Semua angka uang diformat di sini; data mentah tetap numerik untuk Excel.
 */

import type { ReportData, ReportSection } from "@/lib/export/types";
import { formatRupiah } from "@/lib/utils";

const BRAND: [number, number, number] = [13, 148, 136];
const DARK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

const MODE_TITLE: Record<ReportData["mode"], string> = {
  ringkasan: "Laporan Ringkasan Operasional",
  profit: "Laporan Laba & Keuntungan",
  full: "Laporan Lengkap caPOS",
};

const PDF_ROW_LIMIT_FULL = 100;
const PDF_ROW_LIMIT_DEFAULT = 300;

function safeText(value: string | number, max = 70): string {
  const s = String(value ?? "-");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function isMoney(header: string): boolean {
  return /\(Rp\)/i.test(header);
}

function isPercent(header: string): boolean {
  return /\(%\)/i.test(header);
}

function formatCell(value: string | number, header: string): string {
  if (typeof value === "number") {
    if (isPercent(header)) return `${value.toFixed(2)}%`;
    if (isMoney(header)) return formatRupiah(value);
    return value.toLocaleString("id-ID");
  }
  return safeText(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "semua-cabang";
}

export async function renderReportPdf(data: ReportData): Promise<{ doc: any; filename: string }> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;

  // ------------------------------------------------------------- cover head
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 8, "F");
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.scope.cafeName || "Kafe Anda", margin, 52);

  doc.setFontSize(13);
  doc.text(MODE_TITLE[data.mode], margin, 74);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Periode: ${data.scope.startLabel} s/d ${data.scope.endLabel}`, margin, 92);
  doc.text(
    `Cabang: ${data.scope.branchId ? data.scope.branchName : "Semua Cabang (Konsolidasi)"}`,
    margin,
    104
  );
  doc.text(
    `Dibuat: ${new Date(data.scope.generatedAt).toLocaleString("id-ID")}  ·  Paket: ${data.scope.tier}`,
    margin,
    116
  );
  doc.setTextColor(...DARK);

  // ------------------------------------------------------------- KPI cards
  const kpis: [string, number][] = [
    ["Omzet", data.metrics.omzet],
    ["Kerugian", data.metrics.susutStok],
    ["Laba Kotor", data.metrics.labaKotor],
    ["Laba Bersih", data.metrics.labaBersih],
    ["Transaksi", data.metrics.totalTransaksi],
    ["Margin Kotor", data.metrics.marginKotorPct],
  ];

  autoTable(doc, {
    startY: 132,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 5 },
    head: [kpis.map((k) => String(k[0]))],
    body: [
      kpis.map((k) => {
        const value = k[1] as number;
        if (k[0] === "Margin Kotor") return `${value.toFixed(2)}%`;
        if (k[0] === "Transaksi") return value.toLocaleString("id-ID");
        return formatRupiah(value);
      }),
    ],
    headStyles: { fillColor: BRAND, fontSize: 8, halign: "center" },
    bodyStyles: { halign: "center", fontStyle: "bold" },
  });

  let y = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    data.metrics.hppAktual
      ? "Status HPP: AKTUAL — seluruh item punya snapshot biaya."
      : `Status HPP: ESTIMASI — ${data.metrics.hppEstimasiItem} item memakai fallback biaya.`,
    margin,
    y
  );
  doc.setTextColor(...DARK);

  // ------------------------------------------------------------- sections
  const rowLimit = data.mode === "full" ? PDF_ROW_LIMIT_FULL : PDF_ROW_LIMIT_DEFAULT;

  for (const sectionDef of data.sections) {
    if (!sectionDef.rows.length) continue;
    const rows = sectionDef.rows.slice(0, rowLimit).map((row) =>
      row.map((cell, idx) => formatCell(cell, sectionDef.head[idx] ?? ""))
    );

    const estimatedHeight = 22 + rows.length * 12;
    if (y + Math.min(estimatedHeight, 120) > pageHeight - 60) {
      doc.addPage();
      y = 50;
    } else {
      y += 14;
    }

    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.text(sectionDef.title, margin, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 44 },
      theme: "striped",
      styles: { fontSize: 7.2, cellPadding: 2.6, overflow: "linebreak" },
      head: [sectionDef.head],
      body: rows,
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 7.4, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      didDrawPage: () => {
        // footer ditambahkan di akhir agar nomor halaman final diketahui
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    if (sectionDef.rows.length > rowLimit) {
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(
        `Menampilkan ${rowLimit} dari ${sectionDef.rows.length} baris. Data lengkap tersedia pada export Excel.`,
        margin,
        y + 6
      );
      doc.setTextColor(...DARK);
      y += 12;
    }
  }

  // ------------------------------------------------------------- warnings
  if (data.warnings.length) {
    if (y > pageHeight - 120) {
      doc.addPage();
      y = 50;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Catatan & Peringatan", margin, y + 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(...MUTED);
    data.warnings.slice(0, 12).forEach((w, i) => {
      doc.text(`• ${safeText(w, 110)}`, margin, y + 32 + i * 11);
    });
    doc.setTextColor(...DARK);
  }

  // ------------------------------------------------------------- footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `caPOS — ${MODE_TITLE[data.mode]}  ·  ${data.scope.startLabel} s/d ${data.scope.endLabel}`,
      margin,
      pageHeight - 22
    );
    doc.text(`Halaman ${i}/${pageCount}`, pageWidth - margin, pageHeight - 22, { align: "right" });
  }

  const generated = new Date(data.scope.generatedAt);
  const stamp = `${generated.getFullYear()}${String(generated.getMonth() + 1).padStart(2, "0")}${String(
    generated.getDate()
  ).padStart(2, "0")}`;
  const modeSlug = data.mode === "profit" ? "laba" : data.mode === "full" ? "semua-data" : "ringkasan";
  const filename = `capos-${modeSlug}-${slugify(data.scope.branchId ? data.scope.branchName : "semua-cabang")}-${stamp}.pdf`;

  return { doc, filename };
}

export function downloadPdf(doc: any, filename: string) {
  doc.save(filename);
}
