/**
 * WP-07 — Single Source of Truth metrik keuangan caPOS.
 *
 * Semua halaman (Laporan & Omzet, Laporan PDF, analitik) memakai fungsi di
 * sini. Rumusnya SAMA dengan get_profit_report() di
 * supabase/20251104_profit_report_rpc.sql — kalau satu diubah, ubah keduanya.
 *
 *   Omzet        = Σ transactions.total_amount
 *   Laba Kotor   = Omzet − Refund − HPP
 *   Laba Bersih  = Laba Kotor − Susut Stok − Komisi Channel − Biaya Operasional
 *   Margin Kotor = Laba Kotor ÷ Omzet × 100
 *   AOV          = Omzet ÷ jumlah transaksi
 *
 * Refund: tabel refunds TIDAK mengubah baris transactions, jadi omzet tetap
 * kotor dan refund COMPLETED dikurangkan sebagai baris tersendiri.
 */
import type { ProfitReport } from "@/lib/types";

export interface MetricInputs {
  omzet: number;
  diskon?: number;
  hpp: number;
  refund?: number;
  susut?: number;
  komisi?: number;
  opex?: number;
  transaksi: number;
  itemTerjual?: number;
}

export interface Metrics {
  omzet: number;
  diskon: number;
  hpp: number;
  refund: number;
  labaKotor: number;
  susutStok: number;
  komisi: number;
  biayaOperasional: number;
  labaBersih: number;
  marginKotor: number;
  marginBersih: number;
  transaksi: number;
  aov: number;
  itemTerjual: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function computeMetrics(i: MetricInputs): Metrics {
  const omzet = n(i.omzet);
  const hpp = n(i.hpp);
  const refund = n(i.refund);
  const susut = n(i.susut);
  const komisi = n(i.komisi);
  const opex = n(i.opex);
  const transaksi = n(i.transaksi);
  const labaKotor = omzet - refund - hpp;
  const labaBersih = labaKotor - susut - komisi - opex;
  return {
    omzet,
    diskon: n(i.diskon),
    hpp,
    refund,
    labaKotor,
    susutStok: susut,
    komisi,
    biayaOperasional: opex,
    labaBersih,
    marginKotor: omzet > 0 ? (labaKotor / omzet) * 100 : 0,
    marginBersih: omzet > 0 ? (labaBersih / omzet) * 100 : 0,
    transaksi,
    aov: transaksi > 0 ? Math.round(omzet / transaksi) : 0,
    itemTerjual: n(i.itemTerjual),
  };
}

export function metricsFromReport(r: ProfitReport): Metrics {
  const s = r.summary;
  return computeMetrics({
    omzet: s.omzet, diskon: s.diskon, hpp: s.hpp, refund: s.refund, susut: s.susut,
    komisi: s.komisi, opex: s.opex, transaksi: s.transaksi, itemTerjual: s.item_terjual,
  });
}

export type HppQuality = {
  level: "aktual" | "sebagian" | "estimasi";
  label: string;
  note: string;
};

/** Badge kualitas HPP yang wajib tampil di setiap laporan. */
export function hppQuality(actualLines: number, estimateLines: number): HppQuality {
  const total = actualLines + estimateLines;
  if (total === 0 || estimateLines === 0) {
    return { level: "aktual", label: "HPP Aktual", note: "Seluruh HPP memakai snapshot saat transaksi terjadi." };
  }
  if (actualLines === 0) {
    return {
      level: "estimasi",
      label: "HPP Estimasi",
      note: "HPP dihitung ulang dari harga bahan/menu hari ini (transaksi sebelum fitur snapshot HPP).",
    };
  }
  const pct = Math.round((estimateLines / total) * 100);
  return {
    level: "sebagian",
    label: "HPP Sebagian Estimasi",
    note: `${pct}% baris item memakai HPP hari ini karena transaksinya terjadi sebelum fitur snapshot HPP.`,
  };
}
