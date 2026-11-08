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
    // satu baris tidak boleh terbelah di batas halaman; header diulang di tiap halaman
    rowPageBreak: "avoid",
    showHead: "everyPage",
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

/**
 * Potong teks sesuai LEBAR TERUKUR (bukan perkiraan jumlah karakter) supaya
 * tidak pernah menabrak kolom di sebelahnya. Font & ukuran harus sudah
 * diset sebelum fungsi ini dipanggil.
 */
export function fitText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}..`) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}..`;
}

/** Bungkus label jadi paling banyak `maxLines` baris sesuai lebar terukur. */
export function wrapLabel(doc: jsPDF, text: string, maxW: number, maxLines = 2): string[] {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitText(doc, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxW);
  return kept;
}

/**
 * Diagram batang sederhana (tanpa dependensi chart) dengan sumbu nilai
 * (maks / 0 / min) dan label sumbu-X yang dijarangkan menurut lebar
 * terukur, jadi tidak pernah bertumpuk walau datanya 60 hari.
 */
export function barChart(c: PdfCtx, data: { label: string; value: number }[], height = 110) {
  if (data.length === 0) return;
  ensureSpace(c, height + 44);
  const { doc, margin } = c;
  const axisW = 34;
  const left = margin + axisW;
  const w = contentW(c) - axisW;
  const top = c.y + 6;
  const base = top + height;
  const max = Math.max(0, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const range = max - min || 1;
  const slot = w / data.length;
  const barW = Math.max(1.5, Math.min(28, slot * 0.7));
  const yAt = (v: number) => base - ((v - min) / range) * height;
  const zeroY = yAt(0);

  // garis bantu + label sumbu nilai
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(120);
  doc.setDrawColor(229, 231, 235);
  const ticks = Array.from(new Set([max, 0, min]));
  ticks.forEach((v) => {
    const y = yAt(v);
    doc.line(left, y, left + w, y);
    doc.text(rpShort(v), left - 4, y + 2, { align: "right" });
  });

  data.forEach((d, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const h = (Math.abs(d.value) / range) * height;
    const yTop = d.value >= 0 ? zeroY - h : zeroY;
    doc.setFillColor(...(d.value >= 0 ? BRAND : ([239, 68, 68] as [number, number, number])));
    doc.rect(x, yTop, barW, Math.max(h, 0.5), "F");
  });

  // label sumbu-X: hanya tiap `step` batang supaya lebar label tidak saling tumpuk
  doc.setFontSize(7);
  doc.setTextColor(100);
  const widest = Math.max(...data.map((d) => doc.getTextWidth(d.label)), 1) + 6;
  const step = Math.max(1, Math.ceil(widest / slot));
  data.forEach((d, i) => {
    if (i % step !== 0) return;
    doc.text(d.label, left + i * slot + slot / 2, base + 10, { align: "center" });
  });
  doc.setTextColor(0);
  c.y = base + 24;
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

/**
 * Judul grafik. `keep` = tinggi minimum yang harus tersedia di halaman ini
 * (judul + grafiknya); kalau tidak cukup, judul ikut pindah ke halaman baru
 * supaya judul tidak terpisah dari grafiknya.
 */
export function chartTitle(c: PdfCtx, text: string, sub?: string, keep = 120) {
  ensureSpace(c, keep);
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(10);
  c.doc.setTextColor(...DARK);
  c.doc.text(text, c.margin, c.y + 8);
  if (sub) {
    const titleW = c.doc.getTextWidth(text); // ukur selagi font judul (bold 10) masih aktif
    c.doc.setFont("helvetica", "normal");
    c.doc.setFontSize(7.5);
    c.doc.setTextColor(120);
    const room = contentW(c) - titleW - 8;
    if (room > 40) c.doc.text(fitText(c.doc, sub, room), c.margin + titleW + 8, c.y + 8);
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
  ensureSpace(c, height + 50);
  const { doc, margin } = c;
  const w = contentW(c);
  const left = margin + 34;
  const plotW = w - 34 - 8;
  const top = c.y + 4;
  const base = top + height;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const range = max - min || 1;
  const xAt = (i: number) => left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yAt = (v: number) => base - ((v - min) / range) * height;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(120);
  doc.setDrawColor(229, 231, 235);
  for (let g = 0; g <= 4; g++) {
    const v = min + (range * g) / 4;
    const y = yAt(v);
    doc.line(left, y, left + plotW, y);
    doc.text(rpShort(v), left - 4, y + 2, { align: "right" });
  }

  // label sumbu-X dijarangkan menurut lebar terukur
  const widest = Math.max(...labels.map((l) => doc.getTextWidth(l)), 1) + 8;
  const slot = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const step = Math.max(1, Math.ceil(widest / slot));
  labels.forEach((l, i) => {
    if (i % step === 0) doc.text(l, xAt(i), base + 10, { align: "center" });
  });

  for (const s of series) {
    doc.setDrawColor(...s.color);
    doc.setLineWidth(1.4);
    for (let i = 1; i < s.values.length; i++) doc.line(xAt(i - 1), yAt(s.values[i - 1]), xAt(i), yAt(s.values[i]));
    if (labels.length <= 40) {
      doc.setFillColor(...s.color);
      s.values.forEach((v, i) => doc.circle(xAt(i), yAt(v), 1.8, "F"));
    }
  }
  doc.setLineWidth(0.2);

  // legenda (pindah baris kalau melebihi lebar)
  let lx = left;
  let ly = base + 24;
  doc.setFontSize(7.5);
  for (const s of series) {
    const itemW = 11 + doc.getTextWidth(s.name) + 14;
    if (lx + itemW > margin + w) {
      lx = left;
      ly += 11;
    }
    doc.setFillColor(...s.color);
    doc.rect(lx, ly - 6, 8, 6, "F");
    doc.setTextColor(60);
    doc.text(s.name, lx + 11, ly);
    lx += itemW;
  }
  doc.setTextColor(0);
  c.y = ly + 16;
}

/**
 * Batang horizontal berlabel (peringkat). Mendukung nilai negatif.
 * Lebar kolom label & catatan dihitung dari teks yang sebenarnya, label
 * panjang dibungkus (maks 2 baris) alih-alih dipotong jadi nama yang sama.
 */
export function hBarChart(
  c: PdfCtx,
  rows: { label: string; value: number; note?: string; color?: [number, number, number]; muted?: boolean }[],
  opts: { rowH?: number; labelW?: number; color?: [number, number, number] } = {}
) {
  if (rows.length === 0) return;
  const { doc, margin } = c;
  const w = contentW(c);
  const baseRowH = opts.rowH ?? 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const notes = rows.map((r) => r.note ?? rpShort(r.value));
  const noteW = Math.min(w * 0.25, Math.max(60, ...notes.map((n) => doc.getTextWidth(n))) + 10);
  const widestLabel = Math.max(0, ...rows.map((r) => doc.getTextWidth(r.label))) + 10;
  const labelW = Math.min(w * 0.38, Math.max(opts.labelW ?? 100, Math.min(widestLabel, w * 0.38)));
  const plotL = margin + labelW;
  const plotW = w - labelW - noteW;

  // tinggi tiap baris menyesuaikan jumlah baris label (1 atau 2)
  const labelLines = rows.map((r) => (r.label ? wrapLabel(doc, r.label, labelW - 8, 2) : []));
  const heights = labelLines.map((l) => Math.max(baseRowH, l.length * 8.5 + 6));
  const total = heights.reduce((a, b) => a + b, 0);
  ensureSpace(c, total + 12);

  const max = Math.max(0, ...rows.map((r) => r.value));
  const min = Math.min(0, ...rows.map((r) => r.value));
  const range = max - min || 1;
  const zeroX = plotL + ((0 - min) / range) * plotW;

  let y = c.y;
  rows.forEach((r, i) => {
    const rowH = heights[i];
    const midY = y + rowH / 2;
    if (r.muted) {
      doc.setFontSize(6.8);
      doc.setTextColor(130);
    } else {
      doc.setFontSize(7.5);
      doc.setTextColor(60);
    }
    const lines = labelLines[i];
    const textTop = midY - (lines.length * 8.5) / 2 + 6.2;
    lines.forEach((ln, k) => doc.text(ln, margin, textTop + k * 8.5));

    const bw = (Math.abs(r.value) / range) * plotW;
    const x = r.value >= 0 ? zeroX : zeroX - bw;
    doc.setFillColor(...(r.value < 0 ? ([239, 68, 68] as [number, number, number]) : r.color ?? opts.color ?? BRAND));
    doc.rect(x, y + 2, Math.max(bw, 0.8), rowH - 5, "F");

    doc.setFontSize(7.5);
    doc.setTextColor(30);
    doc.text(fitText(doc, notes[i], noteW - 6), plotL + plotW + 6, midY + 2.6);
    y += rowH;
  });
  doc.setDrawColor(209, 213, 219);
  doc.line(zeroX, c.y, zeroX, y);
  doc.setTextColor(0);
  c.y = y + 8;
}

/** Satu batang 100% terbagi per bagian (komposisi), lengkap dengan legenda berpersen. */
export function stackedBar(c: PdfCtx, parts: { label: string; value: number }[]) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return;
  const { doc, margin } = c;
  const w = contentW(c);

  // hitung dulu jumlah baris legenda supaya tinggi total diketahui sebelum menggambar
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const texts = parts.map((p) => `${p.label} ${((Math.max(0, p.value) / total) * 100).toFixed(0)}% (${rpShort(p.value)})`);
  let legendLines = 1;
  let probe = 0;
  texts.forEach((t) => {
    const tw = doc.getTextWidth(t) + 20;
    if (probe + tw > w && probe > 0) {
      legendLines += 1;
      probe = 0;
    }
    probe += tw;
  });
  ensureSpace(c, 16 + 14 + legendLines * 12 + 12);

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
    const tw = doc.getTextWidth(texts[i]) + 20;
    if (lx + tw > margin + w && lx > margin) {
      lx = margin;
      ly += 12;
    }
    doc.setFillColor(...PALETTE[i % PALETTE.length]);
    doc.rect(lx, ly - 6, 8, 6, "F");
    doc.setTextColor(60);
    doc.text(texts[i], lx + 11, ly);
    lx += tw;
  });
  doc.setTextColor(0);
  c.y = ly + 14;
}
