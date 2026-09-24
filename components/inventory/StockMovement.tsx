"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { SkeletonTableRows } from "@/components/Skeleton";

const REASON_LABEL: Record<string, string> = {
  expired: "Bahan Basi/Expired",
  damaged: "Rusak/Tumpah",
  cashier_discrepancy: "Selisih Transaksi Kasir",
  input_correction: "Koreksi Input",
};

interface LogRow {
  id: string;
  created_at: string;
  system_qty: number;
  physical_qty: number;
  difference_qty: number;
  loss_value: number;
  reason: string | null;
  note: string | null;
  unit: string | null;
  ingredient_name: string;
  branch_name: string;
  created_by_name: string;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Inventory §7 — "Stock movement" / "History". Dipisah dari
 * app/dashboard/stock-opname/page.tsx (sebelumnya `OpnameHistory` lokal di
 * file itu) supaya bisa dipakai ulang, mis. di Ingredients sebagai riwayat
 * per-bahan tanpa harus pindah halaman. Membaca `v_stock_opname_history`
 * (migration_16) — SATU-SATUNYA sumber riwayat pergerakan stok bahan baku.
 */
export default function StockMovement({
  tenantId,
  branchId,
  showBranchColumn,
  ingredientId,
}: {
  tenantId: string;
  branchId: string | null;
  showBranchColumn: boolean;
  /** Opsional — kalau diisi, riwayat difilter ke 1 bahan saja. */
  ingredientId?: string;
}) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(toISODate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [end, setEnd] = useState(toISODate(new Date()));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const supabase = createClient();
      let q = supabase
        .from("v_stock_opname_history")
        .select("id, created_at, system_qty, physical_qty, difference_qty, loss_value, reason, note, unit, ingredient_name, branch_name, created_by_name, ingredient_id")
        .eq("tenant_id", tenantId)
        .gte("created_at", `${start}T00:00:00`)
        .lte("created_at", `${end}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (branchId) q = q.eq("branch_id", branchId);
      if (ingredientId) q = q.eq("ingredient_id", ingredientId);

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
          unit: l.unit,
          ingredient_name: l.ingredient_name ?? "Bahan Baku",
          branch_name: l.branch_name ?? "Cabang",
          created_by_name: l.created_by_name ?? "-",
        }))
      );
      setLoading(false);
    })();
  }, [tenantId, branchId, start, end, ingredientId]);

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
              <th className="p-3 font-medium">Bahan Baku</th>
              <th className="p-3 font-medium">Sistem</th>
              <th className="p-3 font-medium">Fisik</th>
              <th className="p-3 font-medium">Selisih</th>
              <th className="p-3 font-medium">Alasan</th>
              <th className="p-3 font-medium">Kerugian</th>
              <th className="p-3 font-medium">Dicatat Oleh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading && <SkeletonTableRows rows={6} cols={showBranchColumn ? 9 : 8} />}
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
                <td className="p-3 font-medium text-neutral-900">
                  {l.ingredient_name}
                  {l.unit && <span className="ml-1 text-xs font-normal text-neutral-400">({l.unit})</span>}
                </td>
                <td className="p-3 text-neutral-500">{l.system_qty}</td>
                <td className="p-3 text-neutral-500">{l.physical_qty}</td>
                <td className={cx("p-3 font-semibold", l.difference_qty < 0 ? "text-urgent" : l.difference_qty > 0 ? "text-primary-dark" : "text-neutral-400")}>
                  {l.difference_qty > 0 ? "+" : ""}
                  {l.difference_qty}
                </td>
                <td className="p-3 text-xs">
                  {l.reason ? <span className="badge-warning">{REASON_LABEL[l.reason] ?? l.reason}</span> : <span className="text-neutral-300">—</span>}
                </td>
                <td className="p-3">
                  {l.loss_value > 0 ? <span className="text-urgent font-medium">{formatRupiah(l.loss_value)}</span> : <span className="text-neutral-300">—</span>}
                </td>
                <td className="p-3 text-neutral-500">{l.created_by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
