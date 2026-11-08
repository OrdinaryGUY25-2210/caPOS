/**
 * Mode "Hanya Keuntungan".
 *   Halaman 1 : SEMUA perhitungan (laba rugi, margin per kategori, top 10 laba,
 *               perbandingan cabang, catatan metodologi).
 *   Halaman 2+: analitik dalam bentuk grafik (tren, omzet vs HPP, komposisi,
 *               kategori, menu, pembayaran, cabang).
 */
import type { ProfitReport } from "@/lib/types";
import { hppQuality, metricsFromReport } from "@/lib/metrics";
import {
  BRAND, DARK, PALETTE, barChart, chartTitle, contentW, createPdf, drawFooters, drawHeader, ensureSpace, hBarChart,
  kpiTable, lineChart, pageW, paragraph, pct, rp, rpShort, sectionTitle, stackedBar, table, type PdfCtx,
} from "./common";
import type { PdfMeta } from "./summaryPdf";

const MAX_CATEGORY_ROWS = 5; // sisanya digabung "Lainnya" supaya halaman 1 tetap muat
const MAX_BRANCH_ROWS = 5;

/** Tabel di kolom tertentu (untuk tata letak dua kolom di halaman 1). Mengembalikan Y akhir. */
function sideTable(c: PdfCtx, x: number, width: number, head: string[], body: (string | number)[][], rightAlignFrom = 1) {
  const columnStyles: Record<number, any> = {};
  for (let i = rightAlignFrom; i < head.length; i++) columnStyles[i] = { halign: "right" };
  c.autoTable(c.doc, {
    startY: c.y,
    margin: { left: x, right: pageW(c) - (x + width) },
    tableWidth: width,
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 2.2, overflow: "linebreak" },
    rowPageBreak: "avoid",
    head: [head],
    body: body.length ? body : [head.map((_, i) => (i === 0 ? "Tidak ada data" : "-"))],
    headStyles: { fillColor: BRAND },
    columnStyles,
    didParseCell: (d: any) => {
      if (d.section === "head" && d.column.index >= rightAlignFrom) d.cell.styles.halign = "right";
      // baris total / subtotal ditebalkan
      if (d.section === "body" && typeof d.row.raw?.[0] === "string" && /^(=|OMZET)/.test(d.row.raw[0])) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [243, 244, 246];
      }
    },
  });
  return (c.doc as any).lastAutoTable.finalY as number;
}

function plainTitle(c: PdfCtx, x: number, text: string) {
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(10);
  c.doc.setTextColor(...DARK);
  c.doc.text(text, x, c.y + 8);
  c.doc.setTextColor(0);
}

export async function buildProfitPdf(report: ProfitReport, meta: PdfMeta) {
  const c = await createPdf({ ...meta, title: "Laporan Laba Rugi" });
  const m = metricsFromReport(report);
  const s = report.summary;
  const q = hppQuality(s.hpp_lines_actual, s.hpp_lines_estimate);

  // ===================== HALAMAN 1 — SEMUA PERHITUNGAN =====================
  drawHeader(c);

  const gap = m.omzet - (s.subtotal - s.diskon);
  const plRows: (string | number)[][] = [
    ["Penjualan sebelum diskon", rp(s.subtotal)],
    ["(-) Diskon & promo", rp(s.diskon)],
  ];
  if (Math.abs(gap) >= 1) plRows.push([gap > 0 ? "(+) Penyesuaian (pembulatan/pajak)" : "(-) Penyesuaian (poin/pembulatan)", rp(Math.abs(gap))]);
  plRows.push(
    ["OMZET (total dibayar)", rp(m.omzet)],
    ["(-) Refund", rp(m.refund)],
    ["(-) HPP", rp(m.hpp)],
    ["= LABA KOTOR", rp(m.labaKotor)],
    ["(-) Susut stok", rp(m.susutStok)],
    ["(-) Komisi channel", rp(m.komisi)],
    [s.opex_tersedia ? "(-) Biaya operasional" : "(-) Biaya operasional (belum dipakai)", s.opex_tersedia ? rp(m.biayaOperasional) : "-"],
    ["= LABA BERSIH", rp(m.labaBersih)],
    ["Margin kotor / bersih", `${pct(m.marginKotor)} / ${pct(m.marginBersih)}`]
  );

  // kategori: maksimal 5 baris + "Lainnya"
  const cats = [...report.by_category];
  const head = cats.slice(0, MAX_CATEGORY_ROWS);
  const rest = cats.slice(MAX_CATEGORY_ROWS);
  if (rest.length) {
    head.push({
      kategori: `Lainnya (${rest.length})`,
      qty: rest.reduce((a, r) => a + Number(r.qty), 0),
      omzet: rest.reduce((a, r) => a + Number(r.omzet), 0),
      hpp: rest.reduce((a, r) => a + Number(r.hpp), 0),
    });
  }
  const catRows = head.map((k) => {
    const laba = Number(k.omzet) - Number(k.hpp);
    return [k.kategori, rp(k.omzet), rp(laba), pct(Number(k.omzet) > 0 ? (laba / Number(k.omzet)) * 100 : 0)];
  });

  const gutter = 14;
  const leftW = Math.round(contentW(c) * 0.52);
  const rightW = contentW(c) - leftW - gutter;
  const rightX = c.margin + leftW + gutter;

  // Dua tabel berdampingan harus mulai di halaman yang sama dan muat bersama;
  // nama kategori sempit bisa membungkus sampai 3 baris, jadi estimasi tinggi dibuat longgar.
  ensureSpace(c, 36 + Math.max(plRows.length * 14, (catRows.length + 1) * 28));
  plainTitle(c, c.margin, "Laba Rugi Ringkas");
  plainTitle(c, rightX, "Margin per Kategori Menu");
  c.y += 14;
  const yTop = c.y;
  const yLeft = sideTable(c, c.margin, leftW, ["Komponen", "Jumlah"], plRows);
  c.y = yTop;
  const yRight = sideTable(c, rightX, rightW, ["Kategori", "Omzet", "Laba", "Margin"], catRows);
  c.y = Math.max(yLeft, yRight) + 4;
  paragraph(c, `${q.label}: ${q.note}`, 7.5);

  // Top 10 menu penyumbang laba
  sectionTitle(c, "Top 10 Menu Penyumbang Laba", 60);
  c.y += 8;
  table(
    c,
    ["Menu", "Terjual", "Omzet item", "HPP", "Laba", "Margin"],
    report.top_profit_menu.map((t) => [t.menu, String(t.qty), rp(t.omzet), rp(t.hpp), rp(t.laba), pct(Number(t.omzet) > 0 ? (t.laba / Number(t.omzet)) * 100 : 0)]),
    { fontSize: 7.5, padding: 2.2, gap: 18, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } } }
  );

  // Perbandingan cabang (hanya "Semua Cabang")
  if (report.branch_id === null && report.by_branch.length > 1) {
    sectionTitle(c, "Perbandingan antar Cabang", 60);
    c.y += 8;
    const shown = report.by_branch.slice(0, MAX_BRANCH_ROWS);
    const body = shown.map((b) => {
      const lk = Number(b.omzet) - Number(b.refund) - Number(b.hpp);
      return [b.branch_name, String(b.transaksi), rp(b.omzet), rp(b.hpp), rp(lk), rp(lk - Number(b.susut) - Number(b.komisi) - Number(b.opex))];
    });
    if (report.by_branch.length > shown.length) body.push([`+${report.by_branch.length - shown.length} cabang lain (lihat Excel)`, "", "", "", "", ""]);
    table(c, ["Cabang", "Transaksi", "Omzet", "HPP", "Laba Kotor", "Laba Bersih"], body, {
      fontSize: 7.5, padding: 2.2, gap: 14,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
  }

  paragraph(
    c,
    "Metodologi: Omzet = total_amount transaksi. Laba Kotor = Omzet - Refund - HPP. HPP = qty x HPP per unit saat transaksi (snapshot > resep cabang > HPP menu cabang > HPP default; tanpa snapshot = estimasi). " +
      "Laba Bersih = Laba Kotor - Susut (opname + waste) - Komisi channel - Biaya operasional.",
    6.8,
    110
  );

  // ===================== HALAMAN 2+ — ANALITIK GRAFIK =====================
  c.doc.addPage();
  c.y = 50;
  c.doc.setFont("helvetica", "bold");
  c.doc.setFontSize(13);
  c.doc.text("Analitik Keuntungan", c.margin, c.y);
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(8.5);
  c.doc.setTextColor(110);
  c.doc.text(`${meta.cafeName}  |  ${meta.branchLabel}  |  ${meta.periodLabel}`, c.margin, c.y + 14);
  c.doc.setTextColor(0);
  c.y += 28;

  // Ringkasan angka utama di atas grafik, supaya pembaca langsung tahu konteksnya.
  kpiTable(c, [
    ["Omzet", rp(m.omzet)],
    ["Laba Kotor", rp(m.labaKotor)],
    ["Laba Bersih", rp(m.labaBersih)],
    ["Margin Bersih", pct(m.marginBersih)],
  ]);

  const days = report.daily;
  const dayLabels = days.map((d) => d.tanggal.slice(5));

  // 1. Tren laba kotor harian
  if (days.length > 0) {
    chartTitle(c, "Tren Laba Kotor Harian", "Omzet - HPP per hari (merah = rugi)", 150);
    barChart(c, days.map((d) => ({ label: d.tanggal.slice(5), value: Number(d.omzet) - Number(d.hpp) })), 80);

    // 2. Omzet vs HPP vs Laba kotor
    chartTitle(c, "Omzet vs HPP vs Laba Kotor per Hari", undefined, 170);
    lineChart(c, dayLabels, [
      { name: "Omzet", color: PALETTE[1], values: days.map((d) => Number(d.omzet)) },
      { name: "HPP", color: PALETTE[2], values: days.map((d) => Number(d.hpp)) },
      { name: "Laba kotor", color: PALETTE[0], values: days.map((d) => Number(d.omzet) - Number(d.hpp)) },
    ], 90);
  }

  // 3. Dari omzet ke laba bersih
  chartTitle(c, "Dari Omzet ke Laba Bersih", "porsi terhadap omzet", 150);
  const share = (v: number) => `${rpShort(v)} (${m.omzet > 0 ? ((v / m.omzet) * 100).toFixed(0) : 0}%)`;
  hBarChart(c, [
    { label: "Omzet", value: m.omzet, note: share(m.omzet), color: PALETTE[1] },
    { label: "HPP", value: m.hpp, note: share(m.hpp), color: PALETTE[2] },
    { label: "Refund", value: m.refund, note: share(m.refund), color: PALETTE[2] },
    { label: "Susut stok", value: m.susutStok, note: share(m.susutStok), color: PALETTE[2] },
    { label: "Komisi channel", value: m.komisi, note: share(m.komisi), color: PALETTE[2] },
    ...(s.opex_tersedia ? [{ label: "Biaya operasional", value: m.biayaOperasional, note: share(m.biayaOperasional), color: PALETTE[2] }] : []),
    { label: "Laba bersih", value: m.labaBersih, note: share(m.labaBersih), color: PALETTE[0] },
  ], { rowH: 14, labelW: 95 });

  // 4. Laba kotor per kategori
  if (report.by_category.length) {
    chartTitle(c, "Laba per Kategori Menu", "laba item (omzet item - HPP) dan margin", 40 + Math.min(report.by_category.length, 6) * 17);
    hBarChart(
      c,
      [...report.by_category]
        .map((k) => ({ ...k, laba: Number(k.omzet) - Number(k.hpp) }))
        .sort((a, b) => b.laba - a.laba)
        .slice(0, 6)
        .map((k) => ({ label: k.kategori, value: k.laba, note: `${rpShort(k.laba)} (${Number(k.omzet) > 0 ? ((k.laba / Number(k.omzet)) * 100).toFixed(0) : 0}%)` })),
      { color: PALETTE[6] }
    );
  }

  // 5. Top 10 menu penyumbang laba
  if (report.top_profit_menu.length) {
    chartTitle(c, "Top 10 Menu Penyumbang Laba", undefined, 40 + Math.min(report.top_profit_menu.length, 10) * 17);
    hBarChart(c, report.top_profit_menu.map((t) => ({ label: t.menu, value: Number(t.laba), note: `${rpShort(t.laba)} - ${t.qty} pcs` })), { color: PALETTE[0] });
  }

  // 6. Komposisi metode pembayaran
  if (report.by_payment.length) {
    chartTitle(c, "Komposisi Metode Pembayaran", "porsi omzet", 100);
    stackedBar(c, report.by_payment.map((p) => ({ label: p.metode, value: Number(p.omzet) })));
  }

  // 7. Perbandingan cabang
  if (report.branch_id === null && report.by_branch.length > 1) {
    const bs = report.by_branch.slice(0, 8).map((b) => ({ ...b, lk: Number(b.omzet) - Number(b.refund) - Number(b.hpp) }));
    chartTitle(c, "Perbandingan Cabang", "omzet (biru) dan laba kotor (hijau)", 40 + bs.length * 2 * 15);
    hBarChart(
      c,
      bs.flatMap((b) => [
        { label: b.branch_name, value: Number(b.omzet), note: rpShort(Number(b.omzet)), color: PALETTE[1] },
        { label: "laba kotor", value: b.lk, note: rpShort(b.lk), color: PALETTE[0], muted: true },
      ]),
      { rowH: 13, labelW: 110 }
    );
  }

  drawFooters(c, meta.fileName, q);
  return c.doc;
}

/** Catatan metodologi untuk laporan lain (dipakai mode Semua Data). */
export function methodologyNote(c: PdfCtx) {
  sectionTitle(c, "Catatan Metodologi", 120);
  paragraph(
    c,
    "Omzet = jumlah total_amount transaksi pada periode & cabang terpilih. Laba Kotor = Omzet - Refund - HPP. " +
      "HPP = jumlah (qty x HPP per unit saat transaksi terjadi). Sumber HPP berjenjang: snapshot saat checkout, " +
      "HPP resep per cabang, HPP menu per cabang, lalu HPP default menu; baris tanpa snapshot ditandai estimasi. " +
      "Susut stok = selisih stok opname + barang rusak/terbuang. Laba Bersih = Laba Kotor - Susut - Komisi channel - Biaya operasional."
  );
}
