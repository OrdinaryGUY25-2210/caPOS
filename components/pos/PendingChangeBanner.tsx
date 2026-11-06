"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, HandCoins, Loader2, ShieldAlert, XCircle } from "lucide-react";
import Modal from "@/components/Modal";
import SupervisorPinModal from "@/components/SupervisorPinModal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/utils";
import type { PendingChangeRow } from "@/lib/types";

/**
 * migration_023 — Banner & pengelola kembalian tertunda.
 *
 * Kembalian yang belum diserahkan adalah KEWAJIBAN kasir, bukan diskon.
 * Banner ini tidak pernah menampilkan omzet / expected cash (blind closing
 * tetap terjaga) — hanya daftar transaksi yang kembaliannya masih PENDING.
 *
 * - Kasir: "Sudah diserahkan" langsung lewat confirm_change(); write-off
 *   wajib PIN supervisor (server juga menegakkan).
 * - Manager/Owner: write-off cukup alasan, tanpa PIN (server membebaskan).
 */
export default function PendingChangeBanner({
  branchId,
  shiftId,
  role,
  refreshKey = 0,
  onChanged,
}: {
  branchId: string | null;
  shiftId: string | null;
  role: string;
  /** Naikkan angka ini untuk memaksa muat ulang (mis. setelah checkout). */
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<PendingChangeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Write-off: kasir lewat PIN modal, manager+ lewat input alasan biasa.
  const [pinTarget, setPinTarget] = useState<PendingChangeRow | null>(null);
  const [reasonTarget, setReasonTarget] = useState<PendingChangeRow | null>(null);
  const [reasonText, setReasonText] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("transactions")
      .select("id, invoice_number, total_amount, cash_received, change_amount, change_due_at, created_at, cashier_id, branch_id")
      .eq("change_status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(100);
    if (branchId) query = query.eq("branch_id", branchId);
    if (shiftId) query = query.eq("shift_id", shiftId);
    const { data, error: qError } = await query;
    if (qError) {
      // Jangan berisik kalau migrasi belum dijalankan di lingkungan lokal.
      console.warn("PendingChangeBanner: gagal memuat kembalian tertunda:", qError.message);
      setRows([]);
      return;
    }
    setRows((data as PendingChangeRow[]) ?? []);
  }, [branchId, shiftId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const total = rows.reduce((sum, r) => sum + Number(r.change_amount ?? 0), 0);
  const overdue = rows.filter((r) => r.change_due_at && new Date(r.change_due_at).getTime() < Date.now()).length;

  async function confirmRow(row: PendingChangeRow) {
    setBusyId(row.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("confirm_change", {
      p_transaction_id: row.id,
      p_notes: null,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
    onChanged?.();
  }

  async function writeOff(row: PendingChangeRow, reason: string, pin: string | null) {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("write_off_change", {
      p_transaction_id: row.id,
      p_reason: reason,
      p_supervisor_pin: pin,
    });
    if (rpcError) return { error: rpcError.message };
    await load();
    onChanged?.();
    return {};
  }

  if (rows.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 hover:bg-amber-100 transition-colors"
      >
        <HandCoins size={16} className="text-amber-600 shrink-0" />
        <span className="text-xs sm:text-sm text-amber-900 flex-1">
          <strong>{rows.length} kembalian</strong> belum diserahkan — total{" "}
          <strong>{formatRupiah(total)}</strong>
          {overdue > 0 && (
            <span className="text-urgent font-semibold"> · {overdue} lewat jatuh tempo</span>
          )}
        </span>
        <span className="text-xs font-semibold text-amber-700 whitespace-nowrap">Kelola →</span>
      </button>

      {open && (
        <Modal title="Kembalian Belum Diserahkan" onClose={() => setOpen(false)} maxWidth="sm:max-w-lg">
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                Uang ini masih berada di laci dan menjadi kewajiban ke pelanggan. Menandai
                &quot;Sudah diserahkan&quot; TIDAK mengubah omzet; write-off mencatatnya sebagai kas masuk
                dan wajib otorisasi.
              </span>
            </div>

            {error && <p className="text-xs text-urgent">{error}</p>}

            {rows.map((row) => {
              const late = row.change_due_at && new Date(row.change_due_at).getTime() < Date.now();
              return (
                <div key={row.id} className="rounded-xl border border-neutral-200 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">{row.invoice_number}</p>
                      <p className="text-xs text-neutral-400">
                        {new Date(row.created_at).toLocaleString("id-ID")}
                        {row.cash_received != null && ` · diterima ${formatRupiah(row.cash_received)}`}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-amber-700 shrink-0">{formatRupiah(row.change_amount)}</p>
                  </div>

                  {row.change_due_at && (
                    <p className={`text-xs flex items-center gap-1 ${late ? "text-urgent font-medium" : "text-neutral-500"}`}>
                      <Clock size={12} />
                      {late ? "Lewat jatuh tempo: " : "Batas ambil: "}
                      {new Date(row.change_due_at).toLocaleString("id-ID")}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={busyId === row.id}
                      onClick={() => confirmRow(row)}
                      className="btn-outline flex-1 text-xs py-1.5 flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {busyId === row.id ? <Loader2 className="animate-spin" size={13} /> : <HandCoins size={13} />}
                      Sudah diserahkan
                    </button>
                    <button
                      disabled={busyId === row.id}
                      onClick={() => {
                        setError(null);
                        if (role === "cashier") setPinTarget(row);
                        else {
                          setReasonText("");
                          setReasonTarget(row);
                        }
                      }}
                      className="text-xs py-1.5 px-2 rounded-xl border border-urgent/30 text-urgent hover:bg-urgent-light/50 flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      <XCircle size={13} /> Hapuskan
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {pinTarget && (
        <SupervisorPinModal
          action="WRITE_OFF_CHANGE"
          branchId={branchId}
          contextLabel={`${pinTarget.invoice_number} — kembalian ${formatRupiah(pinTarget.change_amount)}`}
          onClose={() => setPinTarget(null)}
          onConfirm={async ({ pin, reason }) => {
            const result = await writeOff(pinTarget, reason, pin);
            if (!result.error) setPinTarget(null);
            return result;
          }}
        />
      )}

      {reasonTarget && (
        <Modal
          title={`Hapuskan Kembalian — ${reasonTarget.invoice_number}`}
          onClose={() => setReasonTarget(null)}
          footer={
            <button
              disabled={!reasonText.trim() || busyId === reasonTarget.id}
              onClick={async () => {
                setBusyId(reasonTarget.id);
                const result = await writeOff(reasonTarget, reasonText.trim(), null);
                setBusyId(null);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setReasonTarget(null);
              }}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busyId === reasonTarget.id && <Loader2 className="animate-spin" size={16} />}
              Hapuskan &amp; Catat Kas Masuk
            </button>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-neutral-600 flex items-start gap-2">
              <ShieldAlert size={15} className="shrink-0 mt-0.5 text-amber-600" />
              Kembalian {formatRupiah(reasonTarget.change_amount)} akan dihapuskan dan dicatat sebagai kas masuk.
              Tindakan ini masuk audit log.
            </p>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan</label>
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                rows={2}
                className="input-field resize-none"
                placeholder="Contoh: pelanggan tidak kembali mengambil kembalian"
              />
            </div>
            {error && <p className="text-xs text-urgent">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
