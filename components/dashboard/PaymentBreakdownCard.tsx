"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, cx } from "@/lib/utils";
import { ALL_BRANCHES } from "@/lib/branchContext";
import type { PaymentMethod } from "@/lib/types";

interface Props {
  tenantId: string;
  selectedBranchId: string | typeof ALL_BRANCHES;
}

interface Row {
  method: PaymentMethod | string;
  total: number;
  count: number;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  debit: "Kartu Debit",
  credit: "Kartu Kredit",
  ewallet: "E-Wallet",
  bank_transfer: "Transfer Bank",
};

const METHOD_COLOR: Record<string, string> = {
  cash: "bg-primary",
  qris: "bg-blue-500",
  debit: "bg-amber-500",
  credit: "bg-purple-500",
  ewallet: "bg-pink-500",
  bank_transfer: "bg-neutral-500",
};

/**
 * Dashboard §9 — "Payment breakdown" (bagian "Hari ini") yang sebelumnya
 * belum ada sama sekali di /dashboard. Menjumlahkan transaksi HARI INI per
 * metode pembayaran dari tabel `transactions` (sumber yang sama dengan
 * /dashboard/transactions), supaya owner tahu komposisi tunai vs QRIS vs
 * kartu tanpa buka halaman lain.
 */
export default function PaymentBreakdownCard({ tenantId, selectedBranchId }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, selectedBranchId]);

  async function load() {
    const supabase = createClient();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    let query = supabase
      .from("transactions")
      .select("payment_method, total_amount")
      .eq("tenant_id", tenantId)
      .gte("created_at", dayStart.toISOString());
    if (selectedBranchId !== ALL_BRANCHES) query = query.eq("branch_id", selectedBranchId);

    const { data } = await query;
    const byMethod = new Map<string, Row>();
    for (const t of (data as { payment_method: string; total_amount: number }[]) ?? []) {
      const existing = byMethod.get(t.payment_method) ?? { method: t.payment_method, total: 0, count: 0 };
      existing.total += Number(t.total_amount);
      existing.count += 1;
      byMethod.set(t.payment_method, existing);
    }
    setRows(Array.from(byMethod.values()).sort((a, b) => b.total - a.total));
  }

  const grandTotal = (rows ?? []).reduce((s, r) => s + r.total, 0);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={16} className="text-neutral-400" />
        <p className="font-semibold text-neutral-900">Rincian Pembayaran Hari Ini</p>
      </div>

      {rows === null ? (
        <div className="h-24 animate-pulse bg-neutral-100 rounded-xl" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">Belum ada transaksi hari ini.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0;
            return (
              <div key={r.method}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-neutral-700">
                    {METHOD_LABEL[r.method] ?? r.method}
                    <span className="text-neutral-400 font-normal ml-1.5">· {r.count}x</span>
                  </span>
                  <span className="font-semibold text-neutral-900">{formatRupiah(r.total)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className={cx("h-full rounded-full", METHOD_COLOR[r.method] ?? "bg-neutral-400")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-sm">
            <span className="text-neutral-500">Total Hari Ini</span>
            <span className="font-bold text-neutral-900">{formatRupiah(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
