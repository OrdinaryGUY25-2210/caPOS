/**
 * lib/export/sections.ts — menyusun seluruh bagian laporan dari data mentah.
 *
 * Satu sumber untuk PDF dan Excel supaya isi kedua format selalu sama.
 * Kolom uang dikirim sebagai NUMBER; renderer yang memformat tampilan.
 */

import { resolveItemCost, toNumber } from "@/lib/hpp";
import type { ReportData, ReportSection, ExportScope } from "@/lib/export/types";
import type { ReportMetrics } from "@/lib/metrics";

interface BuildArgs {
  scope: ExportScope;
  mode: ReportData["mode"];
  metrics: ReportMetrics;
  raw: ReportData["raw"];
  warnings: string[];
}

function dateOnly(value: unknown): string {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

function dateTime(value: unknown): string {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

export function maskPhone(value: unknown): string {
  const s = String(value ?? "").replace(/\s+/g, "");
  if (s.length < 6) return s ? "***" : "-";
  return `${s.slice(0, 4)}****${s.slice(-3)}`;
}

export function maskEmail(value: unknown): string {
  const s = String(value ?? "");
  const at = s.indexOf("@");
  if (at < 1) return s ? "***" : "-";
  return `${s.slice(0, 2)}***${s.slice(at)}`;
}

function maskAccount(value: unknown): string {
  const s = String(value ?? "").replace(/\s+/g, "");
  if (s.length <= 4) return s || "-";
  return `****${s.slice(-4)}`;
}

function section(
  key: string,
  title: string,
  head: string[],
  rows: (string | number)[][]
): ReportSection {
  return { key, title, head, rows, totalRows: rows.length, truncated: false };
}

function productLookup(products: any[]) {
  const map = new Map<string, any>();
  for (const p of products) map.set(p.id, p);
  return map;
}

function txDateMap(transactions: any[]) {
  const map = new Map<string, string>();
  for (const t of transactions) map.set(t.id, dateOnly(t.created_at));
  return map;
}

export function buildSections(args: BuildArgs): ReportSection[] {
  const { scope, mode, metrics, raw } = args;
  const productById = productLookup(raw.products);
  const txDate = txDateMap(raw.transactions);
  const txBranch = new Map<string, string | null>();
  for (const t of raw.transactions) txBranch.set(t.id, t.branch_id ?? null);
  // Peta transaksi untuk lookup O(1) — jangan pakai .find() di dalam map
  // karena bisa 20.000 transaksi × 40.000 item.
  const txById = new Map<string, any>();
  const txByOrderId = new Map<string, any>();
  for (const t of raw.transactions) {
    txById.set(t.id, t);
    if (t.order_id) txByOrderId.set(t.order_id, t);
  }
  const branchForItem = (item: any): string | null =>
    scope.branchId ?? (item.transaction_id ? txBranch.get(item.transaction_id) ?? null : null);
  const sections: ReportSection[] = [];

  // ================================================================ RINGKASAN
  const summary = section(
    "ringkasan",
    "Ringkasan Eksekutif",
    ["Metrik", "Nilai"],
    [
      ["Omzet", metrics.omzet],
      ["Subtotal sebelum diskon", metrics.subtotal],
      ["Diskon", metrics.diskon],
      ["HPP (COGS)", metrics.hpp],
      ["Laba Kotor", metrics.labaKotor],
      ["Susut Stok", metrics.susutStok],
      ["Komisi Channel", metrics.komisiChannel],
      ["Biaya Operasional", metrics.opex],
      ["Laba Bersih", metrics.labaBersih],
      ["Margin Kotor (%)", Number(metrics.marginKotorPct.toFixed(2))],
      ["Jumlah Transaksi", metrics.totalTransaksi],
      ["Item Terjual", metrics.itemTerjual],
      ["Rata-rata per Transaksi (AOV)", metrics.aov],
      ["Status HPP", metrics.hppAktual ? "Aktual" : "Estimasi"],
    ]
  );
  sections.push(summary);

  // ================================================================ KERUGIAN
  const opnameLoss = (raw.stockOpnameLogs ?? []).reduce((s: number, r: any) => s + toNumber(r.loss_value), 0);
  const opnameHeaderLoss = (raw.stockOpnames ?? []).reduce(
    (s: number, r: any) => s + toNumber(r.total_loss_value),
    0
  );
  const productWasteLoss = (raw.wasteLogs ?? []).reduce((s: number, r: any) => s + toNumber(r.total_loss_amount), 0);
  const ingredientWasteLoss = (raw.ingredientWasteLogs ?? []).reduce(
    (s: number, r: any) => s + toNumber(r.total_loss_amount ?? r.loss_value),
    0
  );
  sections.push(
    section("kerugian", "Rincian Kerugian", ["Kategori", "Nilai (Rp)"], [
      ["Kerugian Stok Opname Bahan", opnameHeaderLoss],
      ["Kerugian Stok Opname Produk (lama)", opnameLoss],
      ["Waste Produk Jadi", productWasteLoss],
      ["Waste Bahan Baku", ingredientWasteLoss],
      ["TOTAL KERUGIAN", opnameHeaderLoss + opnameLoss + productWasteLoss + ingredientWasteLoss],
    ])
  );

  if (mode === "profit" || mode === "full") {
    const lossDetail: (string | number)[][] = [
      ...(raw.stockOpnames ?? []).map((o: any) => [
        dateOnly(o.created_at),
        "Stok Opname Bahan",
        o.note ?? "Selisih opname bahan",
        toNumber(o.total_loss_value),
      ]),
      ...(raw.stockOpnameLogs ?? []).map((l: any) => [
        dateOnly(l.created_at),
        "Stok Opname Produk",
        l.reason ? `Selisih opname (${l.reason})` : "Selisih opname",
        toNumber(l.loss_value),
      ]),
      ...(raw.wasteLogs ?? []).map((w: any) => [
        dateOnly(w.created_at),
        "Waste Produk",
        `${w.product_name ?? "-"} (${w.waste_type ?? "-"})`,
        toNumber(w.total_loss_amount),
      ]),
      ...(raw.ingredientWasteLogs ?? []).map((w: any) => [
        dateOnly(w.created_at),
        "Waste Bahan",
        `${w.ingredient_id ? String(w.ingredient_id).slice(0, 8) : "-"} (${w.waste_type ?? "-"})`,
        toNumber(w.total_loss_amount ?? w.loss_value),
      ]),
    ].sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    if (lossDetail.length) {
      sections.push(
        section("detail-kerugian", "Detail Kerugian", ["Tanggal", "Sumber", "Keterangan", "Nilai (Rp)"], lossDetail)
      );
    }
  }

  // ================================================================ HARIAN
  const branchCostMap = new Map<string, number>();
  for (const r of raw.branchCosts) branchCostMap.set(`${r.branch_id}:${r.product_id}`, toNumber(r.cost_price));
  const productCostMap = new Map<string, number>();
  for (const p of raw.products) productCostMap.set(p.id, toNumber(p.cost_price));

  const daily = new Map<string, { orders: number; omzet: number; hpp: number }>();
  for (const t of raw.transactions) {
    const d = dateOnly(t.created_at);
    const e = daily.get(d) ?? { orders: 0, omzet: 0, hpp: 0 };
    e.orders += 1;
    e.omzet += toNumber(t.total_amount);
    daily.set(d, e);
  }
  for (const item of raw.items) {
    const d = txDate.get(item.transaction_id) ?? "-";
    const e = daily.get(d) ?? { orders: 0, omzet: 0, hpp: 0 };
    e.hpp += resolveItemCost(item, productCostMap, branchCostMap, branchForItem(item)).totalCost;
    daily.set(d, e);
  }
  const dailyRows = Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => [d, v.orders, v.omzet, v.hpp, v.omzet - v.hpp]);
  sections.push(
    section("harian", "Omzet & Laba Harian", ["Tanggal", "Transaksi", "Omzet (Rp)", "HPP (Rp)", "Laba Kotor (Rp)"], dailyRows)
  );

  // ================================================================ MENU
  const menuMap = new Map<string, { name: string; qty: number; omzet: number; hpp: number }>();
  for (const item of raw.items) {
    const product = productById.get(item.product_id);
    const name = product?.name ?? "(menu dihapus)";
    const e = menuMap.get(item.product_id) ?? { name, qty: 0, omzet: 0, hpp: 0 };
    e.qty += toNumber(item.qty);
    e.omzet += toNumber(item.subtotal);
    e.hpp += resolveItemCost(item, productCostMap, branchCostMap, branchForItem(item)).totalCost;
    menuMap.set(item.product_id, e);
  }
  const menuRows = Array.from(menuMap.values())
    .sort((a, b) => b.omzet - a.omzet)
    .map((m) => [m.name, m.qty, m.omzet, m.hpp, m.omzet - m.hpp, m.omzet > 0 ? Number((((m.omzet - m.hpp) / m.omzet) * 100).toFixed(2)) : 0]);

  sections.push(
    section("menu", "Menu Terlaris & Kontribusi Laba", ["Menu", "Qty", "Omzet (Rp)", "HPP (Rp)", "Laba Kotor (Rp)", "Margin (%)"], menuRows)
  );

  // ================================================================ PEMBAYARAN
  const paymentRowsSource = raw.payments.length
    ? raw.payments.map((p: any) => ({ method: p.method, amount: toNumber(p.amount), txId: p.transaction_id }))
    : raw.transactions.map((t: any) => ({ method: t.payment_method ?? "cash", amount: toNumber(t.total_amount), txId: t.id }));
  const paymentMap = new Map<string, { count: number; total: number }>();
  for (const p of paymentRowsSource) {
    const key = String(p.method ?? "lainnya").toUpperCase();
    const e = paymentMap.get(key) ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += p.amount;
    paymentMap.set(key, e);
  }
  sections.push(
    section(
      "pembayaran",
      "Metode Pembayaran",
      ["Metode", "Jumlah", "Total (Rp)"],
      Array.from(paymentMap.entries()).map(([k, v]) => [k, v.count, v.total])
    )
  );

  // ================================================================ KASIR
  const profileMap = new Map<string, any>();
  for (const p of raw.profiles) profileMap.set(p.id, p);
  const cashierMap = new Map<string, { count: number; total: number }>();
  for (const t of raw.transactions) {
    const name = profileMap.get(t.cashier_id)?.full_name ?? "Tanpa kasir";
    const e = cashierMap.get(name) ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += toNumber(t.total_amount);
    cashierMap.set(name, e);
  }
  sections.push(
    section(
      "kasir",
      "Kinerja Kasir",
      ["Kasir", "Transaksi", "Omzet (Rp)"],
      Array.from(cashierMap.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([k, v]) => [k, v.count, v.total])
    )
  );

  // ================================================================ PROFIT
  if (mode === "profit" || mode === "full") {
    const categoryMap = new Map<string, { omzet: number; hpp: number; qty: number }>();
    for (const item of raw.items) {
      const product = productById.get(item.product_id);
      const cat = product?.category ?? "Tanpa Kategori";
      const e = categoryMap.get(cat) ?? { omzet: 0, hpp: 0, qty: 0 };
      e.omzet += toNumber(item.subtotal);
      e.qty += toNumber(item.qty);
      e.hpp += resolveItemCost(item, productCostMap, branchCostMap, branchForItem(item)).totalCost;
      categoryMap.set(cat, e);
    }
    sections.push(
      section(
        "margin-kategori",
        "Margin per Kategori Menu",
        ["Kategori", "Qty", "Omzet (Rp)", "HPP (Rp)", "Laba Kotor (Rp)", "Margin (%)"],
        Array.from(categoryMap.entries())
          .sort((a, b) => b[1].omzet - a[1].omzet)
          .map(([cat, v]) => [
            cat,
            v.qty,
            v.omzet,
            v.hpp,
            v.omzet - v.hpp,
            v.omzet > 0 ? Number((((v.omzet - v.hpp) / v.omzet) * 100).toFixed(2)) : 0,
          ])
      )
    );

    // Perbandingan cabang
    if (!scope.branchId) {
      const branchNameMap = new Map<string, string>();
      for (const b of raw.branches) branchNameMap.set(b.id, b.name ?? String(b.id).slice(0, 8));
      const branchMap = new Map<string, { omzet: number; hpp: number; count: number }>();
      const txBranch = new Map<string, string>();
      for (const t of raw.transactions) {
        const key = t.branch_id ?? "tanpa-cabang";
        txBranch.set(t.id, key);
        const e = branchMap.get(key) ?? { omzet: 0, hpp: 0, count: 0 };
        e.omzet += toNumber(t.total_amount);
        e.count += 1;
        branchMap.set(key, e);
      }
      for (const item of raw.items) {
        const key = txBranch.get(item.transaction_id) ?? "tanpa-cabang";
        const e = branchMap.get(key) ?? { omzet: 0, hpp: 0, count: 0 };
        e.hpp += resolveItemCost(
          item,
          productCostMap,
          branchCostMap,
          key === "tanpa-cabang" ? null : key
        ).totalCost;
        branchMap.set(key, e);
      }
      sections.push(
        section(
          "per-cabang",
          "Kinerja per Cabang",
          ["Cabang", "Transaksi", "Omzet (Rp)", "HPP (Rp)", "Laba Kotor (Rp)", "Margin (%)"],
          Array.from(branchMap.entries()).map(([id, v]) => [
            id === "tanpa-cabang" ? "Tanpa Cabang" : branchNameMap.get(id) ?? `Cabang ${id.slice(0, 8)}`,
            v.count,
            v.omzet,
            v.hpp,
            v.omzet - v.hpp,
            v.omzet > 0 ? Number((((v.omzet - v.hpp) / v.omzet) * 100).toFixed(2)) : 0,
          ])
        )
      );
    }

    sections.push(
      section("metodologi", "Metodologi & Kualitas HPP", ["Item", "Keterangan"], [
        ["Sumber HPP", "Snapshot transaksi → HPP cabang → HPP produk → estimasi"],
        ["Status HPP", metrics.hppAktual ? "Aktual (semua item punya snapshot)" : "Estimasi (sebagian item memakai fallback)"],
        ["Item tanpa snapshot", metrics.hppEstimasiItem],
        ["Rumus laba kotor", "Omzet − HPP"],
        ["Rumus laba bersih", "Laba kotor − susut stok − komisi channel − biaya operasional"],
        ["Catatan", "Pembulatan mengikuti nilai database; angka dapat berbeda tipis dari tampilan UI."],
      ])
    );
  }

  // ================================================================ FULL
  if (mode === "full") {
    const txRows = raw.transactions.map((t: any) => [
      t.invoice_number ?? "-",
      dateTime(t.created_at),
      t.branch_id ? String(t.branch_id).slice(0, 8) : "-",
      toNumber(t.total_amount),
      toNumber(t.discount_amount),
      String(t.payment_method ?? "-").toUpperCase(),
      profileMap.get(t.cashier_id)?.full_name ?? "-",
    ]);
    sections.push(
      section("tx", "A. Rincian Transaksi", ["Invoice", "Waktu", "Cabang", "Total (Rp)", "Diskon (Rp)", "Metode", "Kasir"], txRows)
    );

    const itemRows = raw.items.map((item: any) => {
      const tx = txById.get(item.transaction_id);
      const product = productById.get(item.product_id);
      const resolved = resolveItemCost(item, productCostMap, branchCostMap, branchForItem(item));
      return [
        tx?.invoice_number ?? "-",
        dateOnly(tx?.created_at),
        product?.name ?? "(menu dihapus)",
        toNumber(item.qty),
        toNumber(item.unit_price),
        toNumber(item.subtotal),
        resolved.unitCost,
        resolved.totalCost,
        resolved.source,
      ];
    });
    sections.push(
      section(
        "items",
        "A. Item Transaksi",
        ["Invoice", "Tanggal", "Menu", "Qty", "Harga (Rp)", "Subtotal (Rp)", "HPP/Unit (Rp)", "Total HPP (Rp)", "Sumber HPP"],
        itemRows
      )
    );

    sections.push(
      section(
        "payments",
        "A. Pembayaran",
        ["Invoice", "Metode", "Jumlah (Rp)", "Referensi", "Split"],
        raw.payments.map((p: any) => {
          const tx = txById.get(p.transaction_id);
          return [tx?.invoice_number ?? "-", String(p.method ?? "-").toUpperCase(), toNumber(p.amount), p.reference_number ?? "-", p.split_group_label ?? "-"];
        })
      )
    );

    sections.push(
      section(
        "orders",
        "A. Order & Channel",
        ["No. Order", "Waktu", "Tipe", "Channel", "Status", "Total (Rp)", "Komisi (Rp)"],
        raw.orders.map((o: any) => [
          o.order_number ?? "-",
          dateTime(o.created_at),
          o.order_type ?? "-",
          o.channel ?? "-",
          o.status ?? "-",
          toNumber(txByOrderId.get(o.id)?.total_amount),
          toNumber(o.channel_commission_amount),
        ])
      )
    );

    sections.push(
      section(
        "refunds",
        "A. Refund",
        ["Tanggal", "Tipe", "Jumlah (Rp)", "Alasan", "Status"],
        raw.refunds.map((r: any) => [dateTime(r.created_at), r.refund_type ?? "-", toNumber(r.amount), r.reason_category ?? "-", r.status ?? "-"])
      )
    );

    sections.push(
      section(
        "qr-orders",
        "A. QR Order",
        ["Waktu", "Meja", "Metode", "Status Bayar", "Total (Rp)"],
        raw.qrOrders.map((q: any) => [dateTime(q.created_at), q.table_id ? String(q.table_id).slice(0, 8) : "-", q.payment_method ?? "-", q.payment_status ?? "-", toNumber(q.total_amount)])
      )
    );

    sections.push(
      section(
        "products",
        "B. Produk",
        ["Nama", "Kategori", "Harga (Rp)", "HPP Default (Rp)", "Margin (%)", "Aktif"],
        raw.products.map((p: any) => [
          p.name ?? "-",
          p.category ?? "-",
          toNumber(p.price),
          toNumber(p.cost_price),
          toNumber(p.price) > 0 ? Number((((toNumber(p.price) - toNumber(p.cost_price)) / toNumber(p.price)) * 100).toFixed(2)) : 0,
          p.is_available === false ? "Tidak" : "Ya",
        ])
      )
    );

    sections.push(
      section(
        "hpp-cabang",
        "B. HPP per Cabang",
        ["Cabang", "Produk", "HPP (Rp)", "Diperbarui"],
        raw.branchCosts.map((r: any) => [
          r.branch_id ? String(r.branch_id).slice(0, 8) : "-",
          productById.get(r.product_id)?.name ?? String(r.product_id ?? "-").slice(0, 8),
          toNumber(r.cost_price),
          dateTime(r.updated_at),
        ])
      )
    );

    sections.push(
      section(
        "variants",
        "B. Varian Produk",
        ["Produk", "Varian", "Harga (Rp)", "Aktif"],
        raw.variants.map((v: any) => [productById.get(v.product_id)?.name ?? "-", v.name ?? "-", toNumber(v.price), v.is_active === false ? "Tidak" : "Ya"])
      )
    );

    sections.push(
      section(
        "modifiers",
        "B. Modifier",
        ["Nama", "Harga Tambahan (Rp)", "Aktif"],
        raw.modifiers.map((m: any) => [m.name ?? "-", toNumber(m.price_adjustment ?? m.price), m.is_active === false ? "Tidak" : "Ya"])
      )
    );

    sections.push(
      section(
        "recipes",
        "B. Resep",
        ["Produk", "Varian", "Versi", "Aktif"],
        raw.recipes.map((r: any) => [productById.get(r.product_id)?.name ?? "-", r.variant_id ? String(r.variant_id).slice(0, 8) : "-", r.version ?? "-", r.is_active === false ? "Tidak" : "Ya"])
      )
    );

    const ingredientById = new Map(raw.ingredients.map((i: any) => [i.id, i]));
    sections.push(
      section(
        "recipe-items",
        "B. Item Resep",
        ["Resep", "Bahan", "Qty", "Unit"],
        raw.recipeItems.map((ri: any) => [
          String(ri.recipe_id ?? "-").slice(0, 8),
          ingredientById.get(ri.ingredient_id)?.name ?? String(ri.ingredient_id ?? "-").slice(0, 8),
          toNumber(ri.quantity),
          ri.unit ?? ingredientById.get(ri.ingredient_id)?.inventory_unit ?? "-",
        ])
      )
    );

    sections.push(
      section(
        "ingredients",
        "B. Bahan Baku",
        ["Nama", "Kategori", "Unit Beli", "Unit Stok", "Ambang Stok", "Status"],
        raw.ingredients.map((i: any) => [i.name ?? "-", i.category ?? "-", i.purchase_unit ?? "-", i.inventory_unit ?? "-", toNumber(i.low_stock_threshold), i.status ?? "-"])
      )
    );

    sections.push(
      section(
        "branch-stock",
        "B. Stok Bahan per Cabang",
        ["Bahan", "Qty", "HPP (Rp)", "Nilai (Rp)", "Ambang"],
        raw.branchIngredients.map((r: any) => [
          ingredientById.get(r.ingredient_id)?.name ?? String(r.ingredient_id ?? "-").slice(0, 8),
          toNumber(r.stock_qty),
          toNumber(r.cost_price),
          toNumber(r.stock_qty) * toNumber(r.cost_price),
          toNumber(r.low_stock_threshold),
        ])
      )
    );

    sections.push(
      section(
        "opname",
        "C. Stok Opname Bahan",
        ["Tanggal", "Status", "Total Kerugian (Rp)", "Catatan"],
        raw.stockOpnames.map((o: any) => [
          dateTime(o.created_at ?? o.submitted_at),
          o.status ?? "-",
          toNumber(o.total_loss_value),
          o.note ?? "-",
        ])
      )
    );

    sections.push(
      section(
        "opname-log",
        "C. Log Kerugian Opname Produk (lama)",
        ["Tanggal", "Produk", "Selisih Qty", "Alasan", "Nilai Kerugian (Rp)"],
        raw.stockOpnameLogs.map((l: any) => [
          dateTime(l.created_at),
          productById.get(l.product_id)?.name ?? String(l.product_id ?? "-").slice(0, 8),
          toNumber(l.difference_qty),
          l.reason ?? "-",
          toNumber(l.loss_value),
        ])
      )
    );

    sections.push(
      section(
        "waste",
        "C. Waste Produk",
        ["Tanggal", "Produk", "Tipe", "Qty", "Nilai (Rp)"],
        raw.wasteLogs.map((w: any) => [dateTime(w.created_at), w.product_name ?? "-", w.waste_type ?? "-", toNumber(w.qty_wasted), toNumber(w.total_loss_amount)])
      )
    );

    sections.push(
      section(
        "waste-bahan",
        "C. Waste Bahan",
        ["Tanggal", "Bahan", "Tipe", "Qty", "Nilai (Rp)"],
        raw.ingredientWasteLogs.map((w: any) => [
          dateTime(w.created_at),
          ingredientById.get(w.ingredient_id)?.name ?? "-",
          w.waste_type ?? "-",
          toNumber(w.qty_wasted ?? w.quantity),
          toNumber(w.total_loss_amount ?? w.loss_value),
        ])
      )
    );

    sections.push(
      section(
        "consumption",
        "C. Konsumsi Resep",
        ["Tanggal", "Bahan", "Qty", "Unit", "Cost Snapshot (Rp)", "Total (Rp)"],
        raw.consumption.map((c: any) => {
          const qty = toNumber(c.quantity);
          const cost = toNumber(c.cost_snapshot);
          return [dateTime(c.created_at), ingredientById.get(c.ingredient_id)?.name ?? "-", qty, c.unit ?? "-", cost, qty * cost];
        })
      )
    );

    sections.push(
      section(
        "suppliers",
        "D. Pemasok",
        ["Kode", "Nama", "Kontak", "Telepon", "Bank", "Rekening"],
        raw.suppliers.map((s: any) => [
          s.supplier_code ?? "-",
          s.company_name ?? "-",
          s.contact_person ?? "-",
          maskPhone(s.phone_number ?? s.whatsapp_number),
          s.bank_name ?? "-",
          maskAccount(s.bank_account),
        ])
      )
    );

    sections.push(
      section(
        "po",
        "D. Purchase Order",
        ["No. PO", "Tanggal", "Status", "Subtotal (Rp)", "Pajak (Rp)", "Total (Rp)"],
        raw.purchaseOrders.map((p: any) => [p.po_number ?? "-", dateTime(p.po_date ?? p.created_at), p.status ?? "-", toNumber(p.subtotal_amount), toNumber(p.tax_amount), toNumber(p.total_amount)])
      )
    );

    const poById = new Map(raw.purchaseOrders.map((p: any) => [p.id, p]));
    sections.push(
      section(
        "po-items",
        "D. Item Purchase Order",
        ["No. PO", "Produk", "Qty", "Harga (Rp)", "Subtotal (Rp)"],
        raw.poItems.map((i: any) => [
          poById.get(i.po_id)?.po_number ?? String(i.po_id ?? "-").slice(0, 8),
          i.product_name ?? i.ingredient_name ?? "-",
          toNumber(i.qty_ordered ?? i.quantity),
          toNumber(i.unit_price),
          toNumber(i.subtotal ?? toNumber(i.qty_ordered ?? i.quantity) * toNumber(i.unit_price)),
        ])
      )
    );

    sections.push(
      section(
        "grn",
        "D. Goods Receipt",
        ["No. GRN", "Tanggal", "Catatan"],
        raw.goodsReceipts.map((g: any) => [g.grn_number ?? "-", dateTime(g.receipt_date ?? g.created_at), g.notes ?? "-"])
      )
    );

    const grnById = new Map(raw.goodsReceipts.map((g: any) => [g.id, g]));
    sections.push(
      section(
        "grn-items",
        "D. Item Goods Receipt",
        ["No. GRN", "Produk/Bahan", "Qty", "Unit", "Harga (Rp)"],
        raw.grnItems.map((i: any) => [
          grnById.get(i.grn_id)?.grn_number ?? String(i.grn_id ?? "-").slice(0, 8),
          i.product_name ?? ingredientById.get(i.ingredient_id)?.name ?? "-",
          toNumber(i.qty_received),
          i.unit ?? "-",
          toNumber(i.unit_price),
        ])
      )
    );

    sections.push(
      section(
        "customers",
        "E. Pelanggan (Dimask)",
        ["Kode", "Nama", "Telepon", "Email", "Kunjungan", "Lifetime (Rp)"],
        raw.customers.map((c: any) => [
          c.customer_code ?? "-",
          c.customer_name ?? "-",
          maskPhone(c.phone_number ?? c.whatsapp_number),
          maskEmail(c.email),
          toNumber(c.visit_count),
          toNumber(c.lifetime_spend),
        ])
      )
    );

    sections.push(
      section(
        "memberships",
        "E. Membership (Dimask)",
        ["Kode", "Nama", "Telepon", "Diskon (%)", "Berlaku s/d", "Aktif"],
        raw.memberships.map((m: any) => [m.member_code ?? "-", m.customer_name ?? "-", maskPhone(m.customer_phone), toNumber(m.discount_percentage), dateOnly(m.valid_until), m.is_active === false ? "Tidak" : "Ya"])
      )
    );

    sections.push(
      section(
        "vouchers",
        "E. Voucher",
        ["Kode", "Nama", "Tipe", "Nilai", "Pemakaian", "Batas", "Aktif"],
        raw.vouchers.map((v: any) => [v.voucher_code ?? "-", v.voucher_name ?? "-", v.discount_type ?? "-", toNumber(v.discount_value), toNumber(v.usage_count), toNumber(v.usage_limit), v.is_active === false ? "Tidak" : "Ya"])
      )
    );

    const voucherById = new Map(raw.vouchers.map((v: any) => [v.id, v]));
    const branchById = new Map(raw.branches.map((b: any) => [b.id, b]));

    sections.push(
      section(
        "voucher-redemptions",
        "E. Pemakaian Voucher",
        ["Waktu", "Kode Voucher", "Diskon (Rp)"],
        raw.voucherRedemptions.map((v: any) => [
          dateTime(v.redeemed_at),
          voucherById.get(v.voucher_id)?.voucher_code ?? "-",
          toNumber(v.discount_given),
        ])
      )
    );

    sections.push(
      section(
        "voucher-branches",
        "E. Cakupan Cabang Voucher",
        ["Kode Voucher", "Cabang"],
        raw.voucherBranches.map((vb: any) => [
          voucherById.get(vb.voucher_id)?.voucher_code ?? String(vb.voucher_id ?? "-").slice(0, 8),
          branchById.get(vb.branch_id)?.name ?? String(vb.branch_id ?? "-").slice(0, 8),
        ])
      )
    );

    sections.push(
      section(
        "promotions",
        "E. Promosi",
        ["Nama", "Kode", "Tipe", "Aktif"],
        raw.promotions.map((p: any) => [p.promo_name ?? "-", p.promo_code ?? "-", p.promo_type ?? "-", p.is_active === false ? "Tidak" : "Ya"])
      )
    );

    sections.push(
      section(
        "referrals",
        "E. Referral",
        ["Kode", "Status", "Dibuat"],
        raw.referrals.map((r: any) => [r.referral_code ?? r.code ?? "-", r.status ?? "-", dateTime(r.created_at)])
      )
    );

    sections.push(
      section(
        "branches",
        "F. Daftar Cabang",
        ["Nama", "Slug", "Alamat", "Utama", "Aktif"],
        raw.branches.map((b: any) => [
          b.name ?? "-",
          b.slug ?? "-",
          b.address ?? "-",
          b.is_main ? "Ya" : "Tidak",
          b.is_active === false ? "Tidak" : "Ya",
        ])
      )
    );

    sections.push(
      section(
        "employees",
        "F. Karyawan",
        ["Nama", "Role", "Jabatan", "Aktif"],
        raw.profiles.map((p: any) => [p.full_name ?? "-", p.role ?? "-", p.job_title ?? "-", p.is_active === false ? "Tidak" : "Ya"])
      )
    );

    sections.push(
      section(
        "shifts",
        "F. Shift Kasir",
        ["Buka", "Tutup", "Kas Awal (Rp)", "Kas Akhir (Rp)", "Selisih (Rp)", "Status"],
        raw.shifts.map((s: any) => [dateTime(s.opened_at), dateTime(s.closed_at), toNumber(s.opening_cash), toNumber(s.closing_cash_actual), toNumber(s.cash_difference), s.status ?? "-"])
      )
    );

    sections.push(
      section(
        "attendance",
        "F. Kehadiran",
        ["Karyawan", "Tipe", "Mulai", "Selesai", "Status"],
        raw.attendance.map((a: any) => [profileMap.get(a.employee_id)?.full_name ?? "-", a.type ?? "-", dateOnly(a.date_start), dateOnly(a.date_end), a.status ?? "-"])
      )
    );

    sections.push(
      section(
        "cash",
        "F. Pergerakan Kas",
        ["Waktu", "Tipe", "Jumlah (Rp)", "Alasan"],
        raw.cashMovements.map((c: any) => [dateTime(c.created_at), c.type ?? "-", toNumber(c.amount), c.reason ?? "-"])
      )
    );

    sections.push(
      section(
        "reservations",
        "F. Reservasi",
        ["Waktu", "Nama", "Orang", "Deposit (Rp)", "Status"],
        raw.reservations.map((r: any) => [dateTime(r.reservation_at), r.customer_name ?? "-", toNumber(r.party_size), toNumber(r.deposit_amount), r.status ?? "-"])
      )
    );

    sections.push(
      section(
        "view-daily",
        "G. Analitik Penjualan Harian",
        ["Tanggal", "Order", "Omzet (Rp)"],
        raw.viewDaily.map((d: any) => [dateOnly(d.sale_date), toNumber(d.total_orders), toNumber(d.total_revenue)])
      )
    );

    sections.push(
      section(
        "view-best",
        "G. Menu Terlaris (View)",
        ["Menu", "Qty"],
        raw.viewBestSeller.map((b: any) => [b.product_name ?? "-", toNumber(b.total_qty)])
      )
    );

    sections.push(
      section(
        "view-profit",
        "G. Profitabilitas Produk (View)",
        ["Produk", "Omzet (Rp)", "COGS (Rp)", "Laba (Rp)", "Margin (%)"],
        raw.viewProfitability.map((p: any) => [p.product_name ?? p.name ?? "-", toNumber(p.total_revenue), toNumber(p.total_cogs), toNumber(p.gross_profit), toNumber(p.profit_margin_pct)])
      )
    );

    sections.push(
      section(
        "view-peak",
        "G. Jam Sibuk (View)",
        ["Jam", "Order", "Omzet (Rp)"],
        raw.viewPeak.map((p: any) => [`${String(p.hour_of_day ?? 0).padStart(2, "0")}:00`, toNumber(p.total_orders), toNumber(p.total_revenue)])
      )
    );

    sections.push(
      section(
        "view-channel",
        "G. Komisi Channel (View)",
        ["Tanggal", "Channel", "Order", "Omzet (Rp)", "Komisi (Rp)", "Net (Rp)"],
        raw.viewChannel.map((c: any) => [dateOnly(c.sale_date), c.channel ?? "-", toNumber(c.total_orders), toNumber(c.gross_revenue), toNumber(c.total_commission), toNumber(c.net_revenue)])
      )
    );

    sections.push(
      section(
        "menu-engineering",
        "G. Menu Engineering",
        ["Produk", "Kategori", "Qty", "Omzet (Rp)", "Margin (%)", "Klasifikasi", "Rekomendasi"],
        raw.menuEngineering.map((m: any) => [m.product_name ?? "-", m.category ?? "-", toNumber(m.qty_sold), toNumber(m.revenue), toNumber(m.margin_pct), m.classification ?? "-", m.recommendation ?? "-"])
      )
    );
  }

  // Tandai pemotongan PDF (renderer memakai batas 300 baris/bagian).
  const PDF_ROW_LIMIT = 300;
  for (const s of sections) {
    if (s.rows.length > PDF_ROW_LIMIT) s.truncated = true;
  }

  return sections;
}
