/**
 * Util bersama renderer PDF (jsPDF + jspdf-autotable, sudah ada di package.json).
 * Hanya karakter yang aman untuk font bawaan jsPDF (Helvetica/WinAnsi).
 */
import type { jsPDF } from "jspdf";
import { formatRupiah } from "@/lib/utils";
import type { HppQuality } from "@/lib/metrics";

export type AutoTableFn = (doc: jsPDF, options: any) => void;

export interface PdfCtx {
  doc: jsPDF;
  autoTable: AutoTableFn;
  margin: number;
  y: number;
  cafeName: string;
  branchLabel: string;
  periodLabel: string;
  title: string;
  orientation: "p" | "l";
}

export const BRAND: [number, number, number] = [16, 185, 129];
export const DARK: [number, number, number] = [31, 41, 55];

export async function createPdf(opts: {
  cafeName: string;
  branchLabel: string;
  periodLabel: string;
  title: string;
  orientation?: "p" | "l";
}): Promise<PdfCtx> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const orientation = opts.orientation ?? "p";
  const doc = new JsPDF({ unit: "pt", format: "a4", orientation });
  return {
    doc,
    autoTable: autoTable as unknown as AutoTableFn,
    margin: 40,
    y: 50,
    orientation,
    ...opts,
  };
}

export const pageW = (c: PdfCtx) => c.doc.internal.pageSize.getWidth();
export const pageH = (c: PdfCtx) => c.doc.internal.pageSize.getHeight();
export const contentW = (c: PdfCtx) => pageW(c) - c.margin * 2;

export function rp(n: number) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `-${formatRupiah(Math.abs(v))}` : formatRupiah(v);
}

export function pct(n: number) {
  return `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
}

export function ymd(d: Date) {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function isoDay(d: Date) {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "semua-cabang"
  );
}

export function ensureSpace(c: PdfCtx, needed: number) {
  if (c.y + needed > pageH(c) - 50) {
    c.doc.addPage();
    c.y = 50;
  }
}

/** Kop laporan: nama kafe, judul, cabang, periode, waktu cetak. */
export function drawHeader(c: PdfCtx) {
  const { doc, margin } = c;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text(c.cafeName, margin, c.y);
  c.y += 20;
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(c.title, margin, c.y);
  c.y += 16;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Cabang: ${c.branchLabel}   |   Periode: ${c.periodLabel}   |   Dicetak: ${new Date().toLocaleString("id-ID")}`, margin, c.y);
  doc.setTextColor(0);
  c.y += 22;
}

export function sectionTitle(c: PdfCtx, text: string, needed = 90) {
  ensureSpace(c, needed);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(11);
  c.doc.setTextColor(...DARK);
  c.doc.text(text, c.margin, c.y);
  c.doc.setTextColor(0);
  c.y += 6;
}

/** Judul bagian + beri ruang untuk tabel di bawahnya. */
export const sectionTable = sectionTitle;

export function paragraph(c: PdfCtx, text: string, size = 9, color = 90) {
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(size);
  c.doc.setTextColor(color);
  const lines = c.doc.splitTextToSize(text, contentW(c)) as string[];
  ensureSpace(c, lines.length * (size + 3) + 6);
  c.doc.text(lines, c.margin, c.y + size);
  c.y += lines.length * (size + 3) + 16;
  c.doc.setTextColor(0);
}

export function table(
  c: PdfCtx,
  head: string[],
  body: (string | number)[][],
  opts: { fontSize?: number; padding?: number; columnStyles?: Record<number, any>; foot?: (string | number)[][]; gap?: number } = {}
) {
  c.autoTable(c.doc, {
    startY: c.y,
    margin: { left: c.margin, right: c.margin },
    theme: "grid",
    styles: { fontSize: opts.fontSize ?? 9, cellPadding: opts.padding ?? 4, overflow: "linebreak" },
    head: [head],
    body: body.length ? body : [head.map((_, i) => (i === 0 ? "Tidak ada data" : "-"))],
    foot: opts.foot,
    headStyles: { fillColor: BRAND },
    footStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: "bold" },
    columnStyles: opts.columnStyles,
    didParseCell: (d: any) => {
      if (d.section === "head" && opts.columnStyles?.[d.column.index]?.halign) d.cell.styles.halign = opts.columnStyles[d.column.index].halign;
    },
  });
  c.y = ((c.doc as any).lastAutoTable.finalY as number) + (opts.gap ?? 22);
}

/** Diagram batang sederhana (tanpa dependensi chart). */
export function barChart(c: PdfCtx, data: { label: string; value: number }[], height = 110) {
  if (data.length === 0) return;
  ensureSpace(c, height + 40);
  const { doc, margin } = c;
  const w = contentW(c);
  const top = c.y + 6;
  const base = top + height;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(0, ...data.map((d) => d.value));
  const range = max - min || 1;
  const slot = w / data.length;
  const barW = Math.min(28, slot * 0.7);
  const zeroY = base - ((0 - min) / range) * height;

  doc.setDrawColor(209, 213, 219);
  doc.line(margin, zeroY, margin + w, zeroY);
  doc.setFontSize(7);
  data.forEach((d, i) => {
    const x = margin + i * slot + (slot - barW) / 2;
    const h = (Math.abs(d.value) / range) * height;
    const yTop = d.value >= 0 ? zeroY - h : zeroY;
    doc.setFillColor(...(d.value >= 0 ? BRAND : ([239, 68, 68] as [number, number, number])));
    doc.rect(x, yTop, barW, Math.max(h, 0.5), "F");
    if (data.length <= 16) {
      doc.setTextColor(100);
      doc.text(d.label, x + barW / 2, base + 10, { align: "center" });
    }
  });
  doc.setTextColor(0);
  c.y = base + (data.length <= 16 ? 24 : 14);
}

/** Footer di semua halaman: nomor halaman, nama file, badge kualitas HPP. */
export function drawFooters(c: PdfCtx, fileName: string, quality?: HppQuality) {
  const total = c.doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    c.doc.setPage(i);
    c.doc.setFontSize(8);
    c.doc.setTextColor(140);
    const left = quality ? `${quality.label}` : "";
    c.doc.text(left, c.margin, pageH(c) - 20);
    c.doc.text(`Dibuat oleh caPOS - halaman ${i}/${total}`, pageW(c) / 2, pageH(c) - 20, { align: "center" });
    c.doc.text(fileName, pageW(c) - c.margin, pageH(c) - 20, { align: "right" });
  }
  c.doc.setTextColor(0);
}

export function kpiTable(c: PdfCtx, items: [string, string][], perRow = 4) {
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow).map(([k]) => k));
  // Satu tabel per baris KPI: label di head, nilai di body → rapi di A4 portrait.
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow);
    c.autoTable(c.doc, {
      startY: c.y,
      margin: { left: c.margin, right: c.margin },
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, halign: "center" },
      head: [slice.map(([k]) => k)],
      body: [slice.map(([, v]) => v)],
      headStyles: { fillColor: BRAND },
    });
    c.y = ((c.doc as any).lastAutoTable.finalY as number) + 8;
  }
  c.y += 10;
}

// ---------------------------------------------------------------------------
// Grafik tambahan (tanpa dependensi chart) — dipakai halaman analitik PDF laba
// ---------------------------------------------------------------------------
export const PALETTE: [number, number, number][] = [
  [16, 185, 129], [59, 130, 246], [245, 158, 11], [239, 68, 68], [139, 92, 246], [236, 72, 153], [20, 184, 166], [107, 114, 128],
];

/** Singkat angka rupiah untuk label grafik: 1.250.000 -> "1,25 jt". */
export function rpShort(n: number) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000_000) return `${sign}${(a / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(".", ",")} jt`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000)} rb`;
  return `${sign}${Math.round(a)}`;
}

function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}.` : s;
}

export function chartTitle(c: PdfCtx, text: string, sub?: string) {
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(10);
  c.doc.setTextColor(...DARK);
  c.doc.text(text, c.margin, c.y + 8);
  if (sub) {
    const titleW = c.doc.getTextWidth(text); // ukur selagi font judul (bold 10) masih aktif
    c.doc.setFont("helvetica", "normal");
    c.doc.setFontSize(7.5);
    c.doc.setTextColor(120);
    c.doc.text(sub, c.margin + titleW + 8, c.y + 8);
  }
  c.doc.setTextColor(0);
  c.y += 16;
}

/** Grafik garis multi-seri (mis. Omzet vs HPP vs Laba per hari). */
export function lineChart(
  c: PdfCtx,
  labels: string[],
  series: { name: string; color: [number, number, number]; values: number[] }[],
  height = 100
) {
  if (labels.length === 0) return;
  const { doc, margin } = c;
  const w = contentW(c);
  const left = margin + 34;
  const plotW = w - 34;
  const top = c.y + 4;
  const base = top + height;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const range = max - min || 1;
  const xAt = (i: number) => left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yAt = (v: number) => base - ((v - min) / range) * height;

  doc.setFontSize(6.5);
  doc.setTextColor(120);
  doc.setDrawColor(229, 231, 235);
  for (let g = 0; g <= 4; g++) {
    const v = min + (range * g) / 4;
    const y = yAt(v);
    doc.line(left, y, left + plotW, y);
    doc.text(rpShort(v), left - 4, y + 2, { align: "right" });
  }
  const step = Math.max(1, Math.ceil(labels.length / 10));
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) doc.text(l, xAt(i), base + 10, { align: "center" });
  });
  for (const s of series) {
    doc.setDrawColor(...s.color);
    doc.setLineWidth(1.4);
    for (let i = 1; i < s.values.length; i++) doc.line(xAt(i - 1), yAt(s.values[i - 1]), xAt(i), yAt(s.values[i]));
    doc.setFillColor(...s.color);
    s.values.forEach((v, i) => doc.circle(xAt(i), yAt(v), 1.8, "F"));
  }
  doc.setLineWidth(0.2);
  // legenda
  let lx = left;
  const ly = base + 22;
  doc.setFontSize(7.5);
  for (const s of series) {
    doc.setFillColor(...s.color);
    doc.rect(lx, ly - 6, 8, 6, "F");
    doc.setTextColor(60);
    doc.text(s.name, lx + 11, ly);
    lx += 11 + doc.getTextWidth(s.name) + 14;
  }
  doc.setTextColor(0);
  c.y = base + 34;
}

/** Batang horizontal berlabel (peringkat). Mendukung nilai negatif. */
export function hBarChart(
  c: PdfCtx,
  rows: { label: string; value: number; note?: string; color?: [number, number, number] }[],
  opts: { rowH?: number; labelW?: number; color?: [number, number, number] } = {}
) {
  if (rows.length === 0) return;
  const { doc, margin } = c;
  const rowH = opts.rowH ?? 15;
  const labelW = opts.labelW ?? 120;
  const noteW = 78;
  const w = contentW(c);
  const plotL = margin + labelW;
  const plotW = w - labelW - noteW;
  const max = Math.max(0, ...rows.map((r) => r.value));
  const min = Math.min(0, ...rows.map((r) => r.value));
  const range = max - min || 1;
  const zeroX = plotL + ((0 - min) / range) * plotW;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  rows.forEach((r, i) => {
    const y = c.y + i * rowH;
    doc.setTextColor(60);
    doc.text(clip(r.label, Math.floor(labelW / 4.1)), margin, y + rowH * 0.62);
    const bw = (Math.abs(r.value) / range) * plotW;
    const x = r.value >= 0 ? zeroX : zeroX - bw;
    doc.setFillColor(...(r.value < 0 ? ([239, 68, 68] as [number, number, number]) : r.color ?? opts.color ?? BRAND));
    doc.rect(x, y + 2, Math.max(bw, 0.8), rowH - 5, "F");
    doc.setTextColor(30);
    doc.text(r.note ?? rpShort(r.value), plotL + plotW + 6, y + rowH * 0.62);
  });
  doc.setDrawColor(209, 213, 219);
  doc.line(zeroX, c.y, zeroX, c.y + rows.length * rowH);
  doc.setTextColor(0);
  c.y += rows.length * rowH + 8;
}

/** Satu batang 100% terbagi per bagian (komposisi), lengkap dengan legenda berpersen. */
export function stackedBar(c: PdfCtx, parts: { label: string; value: number }[]) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return;
  const { doc, margin } = c;
  const w = contentW(c);
  let x = margin;
  const y = c.y + 2;
  parts.forEach((p, i) => {
    const pw = (Math.max(0, p.value) / total) * w;
    if (pw <= 0) return;
    doc.setFillColor(...PALETTE[i % PALETTE.length]);
    doc.rect(x, y, pw, 16, "F");
    x += pw;
  });
  let ly = y + 30;
  let lx = margin;
  doc.setFontSize(7.5);
  parts.forEach((p, i) => {
    const text = `${p.label} ${((Math.max(0, p.value) / total) * 100).toFixed(0)}% (${rpShort(p.value)})`;
    const tw = doc.getTextWidth(text) + 20;
    if (lx + tw > margin + w) { lx = margin; ly += 12; }
    doc.setFillColor(...PALETTE[i % PALETTE.length]);
    doc.rect(lx, ly - 6, 8, 6, "F");
    doc.setTextColor(60);
    doc.text(text, lx + 11, ly);
    lx += tw;
  });
  doc.setTextColor(0);
  c.y = ly + 14;
}
