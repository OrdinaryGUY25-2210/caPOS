"use client";

import { useEffect, useState, useMemo } from "react";
import { ClipboardList, Loader2, AlertTriangle, CalendarRange, Save, History, Store } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import type { Product } from "@/lib/types";

interface ProductStock extends Product {
  cost_price: number;
  track_stock: boolean;
}

const REASON_OPTIONS = [
  { value: "expired", label: "Bahan Basi/Expired" },
  { value: "damaged", label: "Rusak/Tumpah" },
  { value: "cashier_discrepancy", label: "Selisih Transaksi Kasir" },
  { value: "input_correction", label: "Koreksi Input" },
] as const;

const REASON_LABEL: Record<string, string> = Object.fromEntries(REASON_OPTIONS.map((r) => [r.value, r.label]));

interface OpnameRow {
  product: ProductStock;
  systemQty: number;
  physicalInput: string;
  reason: string;
  note: string;
  saving: boolean;
  savedAt: number | null; // timestamp lokal — buat kasih tanda "Tersimpan" sesaat setelah submit
}

interface LogRow {
  id: string;
  created_at: string;
  system_qty: number;
  physical_qty: number;
  difference_qty: number;
  loss_value: number;
  reason: string | null;
  note: string | null;
  product_name: string;
  branch_name: string;
  created_by_name: string;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function StockOpnamePage() {
  const { selectedBranchId, selectedBranch, canSwitchBranch, ownBranchId, loading: branchLoading } = useBranch();
  const [tab, setTab] = useState<"input" | "riwayat">("input");
  const [isManagerOrOwner, setIsManagerOrOwner] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rows, setRows] = useState<OpnameRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Cabang yang benar-benar dipakai untuk opname: Owner harus pilih 1
  // cabang spesifik lewat BranchSwitcher (tidak bisa opname "semua cabang"
  // sekaligus — itu tidak masuk akal secara fisik); Manager/Kasir otomatis
  // terkunci ke cabang penugasannya.
  const activeBranchId = canSwitchBranch ? (selectedBranchId === ALL_BRANCHES ? null : selectedBranchId) : ownBranchId;

  async function loadProducts() {
    if (!activeBranchId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);
    setIsManagerOrOwner(profile.role === "owner" || profile.role === "manager" || profile.role === "super_admin");

    const supabase = createClient();
    const [{ data: products }, { data: stock }] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .eq("track_stock", true)
        .order("name", { ascending: true }),
      supabase.from("branch_stock").select("product_id, stock_qty").eq("branch_id", activeBranchId),
    ]);

    const stockMap = new Map<string, number>((stock ?? []).map((s: any) => [s.product_id, Number(s.stock_qty)]));

    setRows(
      ((products as ProductStock[]) ?? []).map((p) => {
        const systemQty = stockMap.get(p.id) ?? 0;
        return {
          product: p,
          systemQty,
          physicalInput: String(systemQty),
          reason: "",
          note: "",
          saving: false,
          savedAt: null,
        };
      })
    );
    setLoading(false);
  }

  useEffect(() => {
    if (branchLoading) return;
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId, branchLoading]);

  function updateRow(productId: string, patch: Partial<OpnameRow>) {
    setRows((prev) => prev.map((r) => (r.product.id === productId ? { ...r, ...patch } : r)));
  }

  async function submitRow(row: OpnameRow) {
    if (!activeBranchId) return;
    const physical = row.physicalInput === "" ? 0 : Number(row.physicalInput);
    const difference = physical - row.systemQty;
    if (difference !== 0 && !row.reason) {
      alert(`Pilih alasan selisih untuk "${row.product.name}" dulu sebelum disimpan.`);
      return;
    }

    updateRow(row.product.id, { saving: true });
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_stock_opname", {
      p_branch_id: activeBranchId,
      p_product_id: row.product.id,
      p_physical_qty: physical,
      p_reason: row.reason || null,
      p_note: row.note || null,
    });

    if (error) {
      updateRow(row.product.id, { saving: false });
      alert("Gagal menyimpan opname: " + error.message);
      return;
    }

    updateRow(row.product.id, {
      saving: false,
      systemQty: physical, // stok sistem sudah dikoreksi ke hasil fisik ini
      savedAt: Date.now(),
    });
  }

  const dirtyCount = useMemo(
    () => rows.filter((r) => (r.physicalInput === "" ? 0 : Number(r.physicalInput)) !== r.systemQty).length,
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <ClipboardList size={20} className="text-primary" /> Stok Opname
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Bandingkan stok fisik dengan stok sistem — selisih otomatis dihitung nilainya berdasarkan HPP.
          </p>
        </div>
        <div className="flex rounded-xl border border-neutral-200 p-1 bg-white text-sm">
          <button
            onClick={() => setTab("input")}
            className={cx("px-3 py-1.5 rounded-lg font-medium transition-colors", tab === "input" ? "bg-primary text-white" : "text-neutral-600")}
          >
            Input Opname
          </button>
          <button
            onClick={() => setTab("riwayat")}
            className={cx("px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5", tab === "riwayat" ? "bg-primary text-white" : "text-neutral-600")}
          >
            <History size={14} /> Riwayat
          </button>
        </div>
      </div>

      {!activeBranchId && !branchLoading && (
        <div className="card p-6 flex items-start gap-3 bg-warning-light/40 border-warning">
          <Store className="text-warning shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-neutral-800">
            <p className="font-semibold">Pilih cabang dulu</p>
            <p className="text-neutral-600 mt-0.5">
              Gunakan pemilih cabang di kanan atas navbar untuk memilih cabang mana yang mau di-opname. Stok opname
              tidak bisa dilakukan untuk "Semua Cabang" sekaligus.
            </p>
          </div>
        </div>
      )}

      {activeBranchId && tab === "input" && (
        <>
          {dirtyCount > 0 && (
            <div className="rounded-xl bg-warning-light text-warning text-sm px-4 py-2.5">
              {dirtyCount} menu punya selisih dari stok sistem — pilih alasan lalu klik Simpan per baris.
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-neutral-500">
                  <th className="p-3 font-medium">Menu</th>
                  <th className="p-3 font-medium">Stok Sistem</th>
                  <th className="p-3 font-medium">Stok Fisik</th>
                  <th className="p-3 font-medium">Selisih</th>
                  <th className="p-3 font-medium">Nilai Kerugian</th>
                  <th className="p-3 font-medium">Alasan</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-400">
                      <Loader2 className="animate-spin inline mr-2" size={16} /> Memuat data stok...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-400">
                      Belum ada menu yang dilacak stoknya. Aktifkan pelacakan stok di halaman Stok & HPP dulu.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const physical = row.physicalInput === "" ? 0 : Number(row.physicalInput);
                  const difference = physical - row.systemQty;
                  const lossPreview = difference < 0 ? Math.abs(difference) * row.product.cost_price : 0;
                  const isDirty = difference !== 0;
                  return (
                    <tr key={row.product.id} className={isDirty ? "bg-urgent-light/20" : undefined}>
                      <td className="p-3 font-medium text-neutral-900">{row.product.name}</td>
                      <td className="p-3 text-neutral-500">{row.systemQty}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.physicalInput}
                          onChange={(e) =>
                            updateRow(row.product.id, { physicalInput: e.target.value.replace(/[^0-9]/g, ""), savedAt: null })
                          }
                          className="input-field w-20 py-1.5"
                        />
                      </td>
                      <td className={cx("p-3 font-semibold", difference < 0 ? "text-urgent" : difference > 0 ? "text-primary-dark" : "text-neutral-400")}>
                        {difference > 0 ? "+" : ""}
                        {difference}
                      </td>
                      <td className="p-3">
                        {lossPreview > 0 ? <span className="text-urgent font-medium">{formatRupiah(lossPreview)}</span> : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="p-3">
                        {isDirty ? (
                          <select
                            value={row.reason}
                            onChange={(e) => updateRow(row.product.id, { reason: e.target.value })}
                            className="input-field py-1.5 text-xs"
                          >
                            <option value="">Pilih alasan...</option>
                            {REASON_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-neutral-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {row.savedAt && !isDirty ? (
                          <span className="text-xs text-primary-dark font-medium">Tersimpan</span>
                        ) : (
                          <button
                            onClick={() => submitRow(row)}
                            disabled={row.saving || !isManagerOrOwner || (isDirty && !row.reason)}
                            className="btn-outline text-xs py-1.5 px-2.5 flex items-center gap-1.5 disabled:opacity-40 ml-auto"
                          >
                            {row.saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            Simpan
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "riwayat" && tenantId && (
        <OpnameHistory tenantId={tenantId} branchId={canSwitchBranch ? (selectedBranchId === ALL_BRANCHES ? null : selectedBranchId) : ownBranchId} showBranchColumn={canSwitchBranch && selectedBranchId === ALL_BRANCHES} />
      )}
    </div>
  );
}

function OpnameHistory({ tenantId, branchId, showBranchColumn }: { tenantId: string; branchId: string | null; showBranchColumn: boolean }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(toISODate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [end, setEnd] = useState(toISODate(new Date()));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const supabase = createClient();
      let q = supabase
        .from("stock_opname_logs")
        .select(
          "id, created_at, system_qty, physical_qty, difference_qty, loss_value, reason, note, products(name), branches(name), profiles(full_name)"
        )
        .eq("tenant_id", tenantId)
        .gte("created_at", `${start}T00:00:00`)
        .lte("created_at", `${end}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (branchId) q = q.eq("branch_id", branchId);

      const { data } = await q;
      setLogs(
        (data ?? []).map((l: any) => ({
          id: l.id,
          created_at: l.created_at,
          system_qty: Number(l.system_qty),
          physical_qty: Number(l.physical_qty),
          difference_qty: Number(l.difference_qty),
          loss_value: Number(l.loss_value),
          reason: l.reason,
          note: l.note,
          product_name: l.products?.name ?? "Produk",
          branch_name: l.branches?.name ?? "Cabang",
          created_by_name: l.profiles?.full_name ?? "-",
        }))
      );
      setLoading(false);
    })();
  }, [tenantId, branchId, start, end]);

  const totalLoss = useMemo(() => logs.reduce((s, l) => s + l.loss_value, 0), [logs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={16} className="text-neutral-400" />
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="input-field w-auto py-1.5" />
          <span className="text-neutral-400 text-sm">s/d</span>
          <input type="date" value={end} min={start} max={toISODate(new Date())} onChange={(e) => setEnd(e.target.value)} className="input-field w-auto py-1.5" />
        </div>
      </div>

      <div className="card p-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">Total Nilai Kerugian (periode ini{branchId ? "" : ", semua cabang"})</p>
        <p className="font-bold text-urgent">{formatRupiah(totalLoss)}</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th className="p-3 font-medium">Tanggal</th>
              {showBranchColumn && <th className="p-3 font-medium">Cabang</th>}
              <th className="p-3 font-medium">Menu</th>
              <th className="p-3 font-medium">Sistem</th>
              <th className="p-3 font-medium">Fisik</th>
              <th className="p-3 font-medium">Selisih</th>
              <th className="p-3 font-medium">Alasan</th>
              <th className="p-3 font-medium">Kerugian</th>
              <th className="p-3 font-medium">Dicatat Oleh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-neutral-400">
                  <Loader2 className="animate-spin inline mr-2" size={16} /> Memuat riwayat...
                </td>
              </tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-neutral-400">
                  Belum ada riwayat opname di periode ini.
                </td>
              </tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="p-3 whitespace-nowrap text-neutral-500">{new Date(l.created_at).toLocaleString("id-ID")}</td>
                {showBranchColumn && <td className="p-3">{l.branch_name}</td>}
                <td className="p-3 font-medium text-neutral-900">{l.product_name}</td>
                <td className="p-3 text-neutral-500">{l.system_qty}</td>
                <td className="p-3 text-neutral-500">{l.physical_qty}</td>
                <td className={cx("p-3 font-semibold", l.difference_qty < 0 ? "text-urgent" : l.difference_qty > 0 ? "text-primary-dark" : "text-neutral-400")}>
                  {l.difference_qty > 0 ? "+" : ""}
                  {l.difference_qty}
                </td>
                <td className="p-3 text-xs">
                  {l.reason ? <span className="badge-warning">{REASON_LABEL[l.reason] ?? l.reason}</span> : <span className="text-neutral-300">—</span>}
                  {l.note && <p className="text-neutral-400 mt-1">{l.note}</p>}
                </td>
                <td className="p-3">{l.loss_value > 0 ? <span className="text-urgent font-medium">{formatRupiah(l.loss_value)}</span> : <span className="text-neutral-300">—</span>}</td>
                <td className="p-3 text-neutral-500">{l.created_by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logs.length > 0 && (
        <p className="text-xs text-neutral-400 flex items-center gap-1.5">
          <AlertTriangle size={12} /> Total kerugian di atas otomatis memotong Keuntungan Bersih pada Laporan PDF periode yang sama.
        </p>
      )}
    </div>
  );
}
