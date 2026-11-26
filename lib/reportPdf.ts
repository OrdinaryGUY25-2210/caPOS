import { formatRupiah } from "@/lib/utils";
import { DEMO_REPORT_TX, DEMO_REPORT_ITEMS, DEMO_REPORT_OPNAME } from "@/lib/demoData";

/**
 * Generator PDF bersama untuk DUA jenis laporan:
 *  - "omzet": ringkas — omzet, analitik pertumbuhan, grafik batang, pertumbuhan cabang.
 *  - "full" : lengkap — semua di atas + laba kotor/HPP, kerugian opname, menu terlaris,
 *             metode pembayaran, dan kinerja kasir.
 *
 * Kedua jenis SELALU memuat analitik pertumbuhan (dibanding periode sebelumnya
 * dengan panjang sama) dan grafik batang per cabang, supaya owner bisa melihat
 * cabang mana yang tumbuh atau turun. Grafik digambar dengan primitif jsPDF
 * (rect/line/text), jadi tidak butuh canvas atau library tambahan.
 */
export type ReportType = "omzet" | "full";

export interface ReportOptions {
  supabase: any;
  tenantId: string;
  cafeName: string;
  type: ReportType;
  start: Date;
  end: Date;
  /** ID cabang, atau "all" untuk konsolidasi semua cabang. */
  branchId: string;
  branches: { id: string; name: string }[];
  /** Tampilkan label cabang di header (hanya untuk akun yang bisa ganti cabang). */
  showBranchLabel: boolean;
  isDemo: boolean;
  /** Catatan kecil di header, mis. batas paket Free Trial. */
  note?: string;
}

type RGB = [number, number, number];
const GREEN: RGB = [16, 185, 129];
const GREY: RGB = [180, 190, 200];

const localKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}jt`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}rb`;
  return String(Math.round(n));
}

function growth(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? null : 0; // null = "Baru" (tidak ada pembanding)
  return ((cur - prev) / prev) * 100;
}

function fmtGrowth(g: number | null, curIsZero = false) {
  if (g === null) return "Baru";
  if (g === 0 && curIsZero) return "-";
  return `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
}

function niceMax(v: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

function ensure(doc: any, y: number, need: number) {
  if (y + need > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    return 50;
  }
  return y;
}

/** Grafik batang (grouped bars). Mengembalikan posisi y setelah grafik. */
function drawBars(
  doc: any,
  o: {
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    labels: string[];
    series: { name: string; color: RGB; values: number[] }[];
    labelEvery?: number;
  }
): number {
  const { x, y, w, h, title, labels, series } = o;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(title, x, y);

  // Legenda (kanan atas)
  if (series.length > 1) {
    let lx = x + w;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const s of [...series].reverse()) {
      const tw = doc.getTextWidth(s.name);
      lx -= tw;
      doc.setTextColor(90);
      doc.text(s.name, lx, y);
      lx -= 10;
      doc.setFillColor(...s.color);
      doc.rect(lx, y - 6, 7, 7, "F");
      lx -= 10;
    }
  }

  const top = y + 12;
  const plotH = h - 34;
  const left = x + 40;
  const plotW = w - 40;
  const maxVal = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.setLineWidth(0.4);
  for (let i = 0; i <= 4; i++) {
    const gy = top + plotH - (plotH * i) / 4;
    doc.setDrawColor(228);
    doc.line(left, gy, left + plotW, gy);
    doc.text(fmtShort((maxVal * i) / 4), left - 4, gy + 2, { align: "right" });
  }

  const n = Math.max(1, labels.length);
  const groupW = plotW / n;
  const barW = Math.min(30, (groupW * 0.72) / series.length);
  const every = o.labelEvery ?? Math.max(1, Math.ceil(n / 12));
  for (let i = 0; i < n; i++) {
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0;
      const bh = (v / maxVal) * plotH;
      if (bh > 0) {
        const bx = left + groupW * i + (groupW - barW * series.length) / 2 + barW * k;
        doc.setFillColor(...s.color);
        doc.rect(bx, top + plotH - bh, barW, bh, "F");
      }
    });
    if (i % every === 0) {
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(labels[i] ?? "", left + groupW * i + groupW / 2, top + plotH + 11, { align: "center" });
    }
  }
  doc.setTextColor(0);
  return y + h;
}

/** Grafik batang horizontal (peringkat). */
function drawHBars(doc: any, o: { x: number; y: number; w: number; title: string; rows: { label: string; value: number }[] }): number {
  const { x, w, title, rows } = o;
  let y = o.y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(title, x, y);
  y += 10;
  const maxVal = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 120;
  const barMax = w - labelW - 60;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const r of rows) {
    y += 15;
    doc.setTextColor(60);
    doc.text(r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label, x, y);
    const bw = (r.value / maxVal) * barMax;
    doc.setFillColor(...GREEN);
    if (bw > 0) doc.rect(x + labelW, y - 7, bw, 9, "F");
    doc.setTextColor(90);
    doc.text(String(r.value), x + labelW + bw + 4, y);
  }
  doc.setTextColor(0);
  return y + 14;
}

async function fetchTx(opts: ReportOptions, start: Date, end: Date, full: boolean) {
  const { supabase, tenantId, branchId } = opts;
  const base = full ? "id, total_amount, payment_method, created_at, cashier_id, branch_id, profiles(full_name)" : "id, total_amount, created_at, branch_id";
  const run = async (cols: string) => {
    let q = supabase
      .from("transactions")
      .select(cols)
      .eq("tenant_id", tenantId)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .limit(10000);
    if (branchId !== "all") q = q.eq("branch_id", branchId);
    return q;
  };
  // Kolom service_amount/tax_amount ada sejak migration_021; kalau belum
  // dijalankan, ulangi tanpa kolom itu supaya laporan tetap jadi.
  const withCharges = await run(base + ", service_amount, tax_amount");
  if (!withCharges.error) return (withCharges.data ?? []) as any[];
  const plain = await run(base);
  return (plain.data ?? []) as any[];
}

export async function generateReportPdf(opts: ReportOptions): Promise<void> {
  const { supabase, tenantId, cafeName, type, start, end, branchId, branches, isDemo } = opts;
  const full = type === "full";

  // Periode pembanding: rentang sama panjang tepat sebelum periode ini.
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);

  const [txRows, prevRows, itemRows, opnameRows] = await Promise.all([
    isDemo ? Promise.resolve(DEMO_REPORT_TX) : fetchTx(opts, start, end, full),
    isDemo ? Promise.resolve([] as any[]) : fetchTx(opts, prevStart, prevEnd, false),
    isDemo || !full
      ? Promise.resolve(isDemo ? DEMO_REPORT_ITEMS : [])
      : (() => {
          let q = supabase
            .from("transaction_items")
            .select("qty, subtotal, product_id, products(name, cost_price), transactions!inner(created_at, tenant_id, branch_id)")
            .eq("transactions.tenant_id", tenantId)
            .gte("transactions.created_at", start.toISOString())
            .lte("transactions.created_at", end.toISOString())
            .limit(10000);
          if (branchId !== "all") q = q.eq("transactions.branch_id", branchId);
          return q.then((r: any) => r.data ?? []);
        })(),
    isDemo || !full
      ? Promise.resolve(isDemo ? DEMO_REPORT_OPNAME : [])
      : (() => {
          let q = supabase
            .from("stock_opname_logs")
            .select("loss_value")
            .eq("tenant_id", tenantId)
            .gte("created_at", start.toISOString())
            .lte("created_at", end.toISOString())
            .limit(10000);
          if (branchId !== "all") q = q.eq("branch_id", branchId);
          return q.then((r: any) => r.data ?? []);
        })(),
  ]);

  // Nama kustom service/pajak (migration_022); gagal/kolom belum ada → nama default.
  let serviceLabel = "Service";
  let taxLabel = "Pajak";
  try {
    const { data: lab, error: labErr } = await supabase.from("tenants").select("service_label, tax_label").eq("id", tenantId).single();
    if (!labErr && lab) {
      serviceLabel = String((lab as any).service_label ?? "").trim() || serviceLabel;
      taxLabel = String((lab as any).tax_label ?? "").trim() || taxLabel;
    }
  } catch {}

  const transactions: any[] = txRows;
  const items: any[] = itemRows;

  // ---------- Angka utama ----------
  const sum = (rows: any[]) => rows.reduce((s, t) => s + Number(t.total_amount), 0);
  const totalOmzet = sum(transactions);
  const totalOrders = transactions.length;
  const avg = totalOrders > 0 ? Math.round(totalOmzet / totalOrders) : 0;
  const prevOmzet = sum(prevRows);
  const prevOrders = prevRows.length;
  const prevAvg = prevOrders > 0 ? Math.round(prevOmzet / prevOrders) : 0;
  const totalService = transactions.reduce((sum, t) => sum + Number(t.service_amount ?? 0), 0);
  const totalTax = transactions.reduce((sum, t) => sum + Number(t.tax_amount ?? 0), 0);
  const totalOpnameLoss = (opnameRows as any[]).reduce((s, r) => s + Number(r.loss_value), 0);
  const totalHpp = items.reduce((s, it) => s + Number(it.qty) * Number(it.products?.cost_price ?? 0), 0);
  const grossProfit = totalOmzet - totalHpp;
  const netProfit = grossProfit - totalOpnameLoss;

  const gOmzet = growth(totalOmzet, prevOmzet);
  const gOrders = growth(totalOrders, prevOrders);
  const gAvg = growth(avg, prevAvg);

  // ---------- Deret waktu (per jam untuk 1 hari, per hari untuk lebih) ----------
  const singleDay = localKey(start) === localKey(end);
  let tLabels: string[] = [];
  let tValues: number[] = [];
  let peakText = "";
  if (singleDay) {
    tLabels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
    tValues = Array(24).fill(0);
    for (const t of transactions) tValues[new Date(t.created_at).getHours()] += Number(t.total_amount);
    const maxV = Math.max(...tValues);
    if (maxV > 0) {
      const h = tValues.indexOf(maxV);
      peakText = `Jam paling ramai: ${String(h).padStart(2, "0")}.00–${String(h + 1).padStart(2, "0")}.00 (${formatRupiah(maxV)})`;
    }
  } else {
    const dayMap = new Map<string, number>();
    for (const t of transactions) {
      const k = localKey(new Date(t.created_at));
      dayMap.set(k, (dayMap.get(k) ?? 0) + Number(t.total_amount));
    }
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    let guard = 0;
    while (cursor <= end && guard++ < 93) {
      const k = localKey(cursor);
      tLabels.push(k.slice(8) + "/" + k.slice(5, 7));
      tValues.push(dayMap.get(k) ?? 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    const maxV = Math.max(0, ...tValues);
    if (maxV > 0) peakText = `Hari omzet tertinggi: ${tLabels[tValues.indexOf(maxV)]} (${formatRupiah(maxV)})`;
  }

  // ---------- Pertumbuhan per cabang ----------
  const nameOf = (id: string | null | undefined) => branches.find((b) => b.id === id)?.name ?? (isDemo ? "Cabang Utama (contoh)" : "Cabang");
  const branchKeys = new Set<string>();
  for (const t of [...transactions, ...prevRows]) branchKeys.add(t.branch_id ?? "_");
  if (branchId !== "all") branchKeys.add(branchId);
  if (branchId === "all") for (const b of branches) branchKeys.add(b.id);
  const branchRows = Array.from(branchKeys)
    .map((key) => {
      const cur = transactions.filter((t) => (t.branch_id ?? "_") === key);
      const prv = prevRows.filter((t) => (t.branch_id ?? "_") === key);
      return {
        name: key === "_" ? nameOf(null) : nameOf(key),
        cur: sum(cur),
        prev: sum(prv),
        curOrders: cur.length,
        prevOrders: prv.length,
      };
    })
    .sort((a, b) => b.cur - a.cur);

  // ---------- Menu / pembayaran / kasir (laporan lengkap) ----------
  const productMap = new Map<string, { qty: number; revenue: number }>();
  for (const it of items) {
    const name = it.products?.name ?? "Produk";
    const e = productMap.get(name) ?? { qty: 0, revenue: 0 };
    e.qty += Number(it.qty);
    e.revenue += Number(it.subtotal);
    productMap.set(name, e);
  }
  const topProducts = Array.from(productMap.entries()).sort(([, a], [, b]) => b.qty - a.qty).slice(0, 10);

  const paymentMap = new Map<string, { count: number; revenue: number }>();
  for (const t of transactions) {
    const m = (t.payment_method ?? "cash").toUpperCase();
    const e = paymentMap.get(m) ?? { count: 0, revenue: 0 };
    e.count += 1;
    e.revenue += Number(t.total_amount);
    paymentMap.set(m, e);
  }
  const cashierMap = new Map<string, { orders: number; revenue: number }>();
  for (const t of transactions) {
    const name = t.profiles?.full_name ?? "Kasir";
    const e = cashierMap.get(name) ?? { orders: 0, revenue: 0 };
    e.orders += 1;
    e.revenue += Number(t.total_amount);
    cashierMap.set(name, e);
  }

  // ---------- Gambar PDF ----------
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc: any = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const contentW = pageWidth - margin * 2;
  let y = 50;

  const sectionTitle = (text: string) => {
    y = ensure(doc, y, 60);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(text, margin, y);
    y += 6;
  };
  const table = (head: string[][], body: string[][]) => {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      theme: "grid",
      head,
      body: body.length ? body : [head[0].map(() => "-")],
      headStyles: { fillColor: GREEN },
    });
    y = doc.lastAutoTable.finalY + 22;
  };

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(cafeName, margin, y);
  y += 20;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(full ? "Laporan Lengkap — caPOS" : "Laporan Omzet — caPOS", margin, y);
  y += 16;
  doc.setFontSize(9);
  doc.setTextColor(100);
  const branchLabel = opts.showBranchLabel ? `  ·  Cabang: ${branchId === "all" ? "Semua Cabang (Konsolidasi)" : nameOf(branchId)}` : "";
  doc.text(`Periode: ${localKey(start)} s/d ${localKey(end)}  ·  Dibuat: ${new Date().toLocaleString("id-ID")}${branchLabel}`, margin, y);
  y += 12;
  if (opts.note) {
    doc.setTextColor(180, 83, 9);
    doc.text(opts.note, margin, y);
    y += 12;
  }
  doc.setTextColor(0);
  y += 10;

  // Ringkasan
  if (full) {
    table(
      [["Total Omzet", "Total Transaksi", "Rata-rata/Transaksi", "Laba Kotor", "Kerugian Opname", "Keuntungan Bersih"]],
      [[formatRupiah(totalOmzet), String(totalOrders), formatRupiah(avg), formatRupiah(grossProfit), totalOpnameLoss > 0 ? `- ${formatRupiah(totalOpnameLoss)}` : formatRupiah(0), formatRupiah(netProfit)]]
    );
  } else {
    table(
      [["Total Omzet", "Total Transaksi", "Rata-rata/Transaksi", "Pertumbuhan Omzet"]],
      [[formatRupiah(totalOmzet), String(totalOrders), formatRupiah(avg), fmtGrowth(gOmzet, totalOmzet === 0)]]
    );
  }

  // Analitik pertumbuhan
  sectionTitle(singleDay ? "Analitik Pertumbuhan (dibanding hari sebelumnya)" : "Analitik Pertumbuhan (dibanding periode sebelumnya)");
  table(
    [["Metrik", "Periode Ini", "Periode Lalu", "Perubahan"]],
    [
      ["Omzet", formatRupiah(totalOmzet), formatRupiah(prevOmzet), fmtGrowth(gOmzet, totalOmzet === 0)],
      ["Jumlah Transaksi", String(totalOrders), String(prevOrders), fmtGrowth(gOrders, totalOrders === 0)],
      ["Rata-rata per Transaksi", formatRupiah(avg), formatRupiah(prevAvg), fmtGrowth(gAvg, avg === 0)],
    ]
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70);
  const insight =
    gOmzet === null
      ? "Belum ada data periode sebelumnya sebagai pembanding."
      : gOmzet >= 0
        ? `Omzet naik ${gOmzet.toFixed(1)}% dibanding periode sebelumnya.`
        : `Omzet turun ${Math.abs(gOmzet).toFixed(1)}% dibanding periode sebelumnya.`;
  doc.text(insight + (peakText ? `  ${peakText}.` : ""), margin, y - 10, { maxWidth: contentW });
  doc.setTextColor(0);
  y += 8;

  if (totalService > 0 || totalTax > 0) {
    sectionTitle(`Rincian ${serviceLabel} & ${taxLabel}`);
    table(
      [["Keterangan", "Jumlah"]],
      [
        ["Total dibayar pelanggan", formatRupiah(totalOmzet)],
        [serviceLabel, formatRupiah(totalService)],
        [taxLabel, formatRupiah(totalTax)],
        [`Penjualan bersih (tanpa ${serviceLabel} & ${taxLabel})`, formatRupiah(totalOmzet - totalService - totalTax)],
      ]
    );
  }

  // Grafik 1: omzet per jam / per hari
  y = ensure(doc, y, 190);
  y = drawBars(doc, {
    x: margin,
    y,
    w: contentW,
    h: 170,
    title: singleDay ? "Grafik Omzet per Jam" : "Grafik Omzet per Hari",
    labels: tLabels,
    series: [{ name: "Omzet", color: GREEN, values: tValues }],
    labelEvery: singleDay ? 3 : undefined,
  }) + 14;

  // Grafik 2: pertumbuhan per cabang
  sectionTitle("Pertumbuhan per Cabang");
  table(
    [["Cabang", "Omzet Ini", "Omzet Lalu", "Pertumbuhan", "Transaksi Ini", "Transaksi Lalu"]],
    branchRows.map((b) => [b.name, formatRupiah(b.cur), formatRupiah(b.prev), fmtGrowth(growth(b.cur, b.prev), b.cur === 0), String(b.curOrders), String(b.prevOrders)])
  );
  if (branchRows.length > 0) {
    y = ensure(doc, y, 190);
    y = drawBars(doc, {
      x: margin,
      y,
      w: contentW,
      h: 170,
      title: "Grafik Omzet per Cabang: Periode Ini vs Periode Lalu",
      labels: branchRows.map((b) => (b.name.length > 14 ? b.name.slice(0, 13) + "…" : b.name)),
      series: [
        { name: "Periode lalu", color: GREY, values: branchRows.map((b) => b.prev) },
        { name: "Periode ini", color: GREEN, values: branchRows.map((b) => b.cur) },
      ],
      labelEvery: 1,
    }) + 14;
  }

  // Rincian harian
  if (!singleDay) {
    sectionTitle("Omzet Harian");
    const dayAgg = new Map<string, { orders: number; revenue: number }>();
    for (const t of transactions) {
      const k = localKey(new Date(t.created_at));
      const e = dayAgg.get(k) ?? { orders: 0, revenue: 0 };
      e.orders += 1;
      e.revenue += Number(t.total_amount);
      dayAgg.set(k, e);
    }
    table(
      [["Tanggal", "Jumlah Transaksi", "Omzet"]],
      Array.from(dayAgg.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, String(v.orders), formatRupiah(v.revenue)])
    );
  }

  if (full) {
    sectionTitle("Menu Terlaris");
    table(
      [["Menu", "Terjual (pcs)", "Omzet"]],
      topProducts.map(([name, v]) => [name, String(v.qty), formatRupiah(v.revenue)])
    );
    if (topProducts.length > 0) {
      y = ensure(doc, y, 20 + Math.min(5, topProducts.length) * 15 + 20);
      y = drawHBars(doc, {
        x: margin,
        y,
        w: contentW,
        title: "Grafik 5 Menu Terlaris (pcs)",
        rows: topProducts.slice(0, 5).map(([name, v]) => ({ label: name, value: v.qty })),
      }) + 10;
    }

    sectionTitle("Metode Pembayaran");
    table(
      [["Metode", "Jumlah Transaksi", "Total"]],
      Array.from(paymentMap.entries()).map(([m, v]) => [m, String(v.count), formatRupiah(v.revenue)])
    );

    sectionTitle("Kinerja Kasir");
    table(
      [["Kasir", "Jumlah Transaksi", "Omzet"]],
      Array.from(cashierMap.entries()).sort(([, a], [, b]) => b.revenue - a.revenue).map(([n, v]) => [n, String(v.orders), formatRupiah(v.revenue)])
    );
  }

  const pageCount = doc.internal.pages.length - 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Dibuat otomatis oleh caPOS — halaman ${i}/${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: "center" });
  }

  doc.save(`${full ? "laporan-lengkap" : "laporan-omzet"}-capos-${localKey(start)}-sd-${localKey(end)}.pdf`);
}
