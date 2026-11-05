/** Mode "Ringkasan" — laporan harian cepat (2–4 halaman). */
import type { ProfitReport } from "@/lib/types";
import { computeMetrics, hppQuality, metricsFromReport } from "@/lib/metrics";
import { barChart, createPdf, drawFooters, drawHeader, kpiTable, paragraph, pct, rp, sectionTable, table } from "./common";

export interface PdfMeta {
  cafeName: string;
  branchLabel: string;
  periodLabel: string;
  fileName: string;
}

export async function buildSummaryPdf(report: ProfitReport, meta: PdfMeta) {
  const c = await createPdf({ ...meta, title: "Laporan Ringkasan Penjualan" });
  const m = metricsFromReport(report);
  const q = hppQuality(report.summary.hpp_lines_actual, report.summary.hpp_lines_estimate);

  drawHeader(c);
  kpiTable(c, [
    ["Omzet", rp(m.omzet)],
    ["Transaksi", String(m.transaksi)],
    ["Rata-rata / Transaksi", rp(m.aov)],
    ["HPP", rp(m.hpp)],
    ["Laba Kotor", rp(m.labaKotor)],
    ["Susut Stok", m.susutStok > 0 ? `- ${rp(m.susutStok)}` : rp(0)],
    ["Laba Bersih", rp(m.labaBersih)],
    ["Margin Kotor", pct(m.marginKotor)],
  ]);
  paragraph(c, `${q.label}: ${q.note}${report.summary.opex_tersedia ? "" : " Laba bersih belum termasuk biaya operasional (modul Pengeluaran belum dipakai)."}`);

  sectionTable(c, "Omzet Harian");
  barChart(c, report.daily.map((d) => ({ label: d.tanggal.slice(5), value: Number(d.omzet) })));
  table(
    c,
    ["Tanggal", "Transaksi", "Omzet", "HPP", "Laba Kotor"],
    report.daily.map((d) => {
      const dm = computeMetrics({ omzet: d.omzet, hpp: d.hpp, transaksi: d.transaksi });
      return [d.tanggal, String(d.transaksi), rp(d.omzet), rp(d.hpp), rp(dm.omzet - dm.hpp)];
    })
  );

  sectionTable(c, "Menu Terlaris (Top 10)");
  table(c, ["Menu", "Terjual (pcs)", "Omzet"], report.top_menu.map((t) => [t.menu, String(t.qty), rp(t.omzet)]));

  sectionTable(c, "Metode Pembayaran");
  table(c, ["Metode", "Transaksi", "Total"], report.by_payment.map((p) => [p.metode, String(p.transaksi), rp(p.omzet)]));

  drawFooters(c, meta.fileName, q);
  return c.doc;
}
