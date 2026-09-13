"use client";

import { useState } from "react";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatNumberWithDots, stripNumberDots } from "@/lib/utils";
import type { ShiftCashSummary } from "@/lib/types";

type Tab = "cash_in" | "cash_out" | "close";

/**
 * Modal Manajemen Kasir — dipanggil dari /pos. Punya 2 mode:
 *
 *  - Belum ada shift terbuka (shiftId null): tampilkan form Opening Cash
 *    (modal awal) — kasir WAJIB isi ini sebelum bisa mulai transaksi.
 *  - Sudah ada shift terbuka: tampilkan tab Cash In / Cash Out / Tutup Shift.
 */
export default function ShiftModal({
  tenantId,
  branchId,
  cashierId,
  shiftId,
  onOpened,
  onClosed,
  onClose,
}: {
  tenantId: string;
  branchId: string | null;
  cashierId: string;
  /** null = belum ada shift terbuka -> tampilkan form buka shift */
  shiftId: string | null;
  onOpened: (shiftId: string, openedAt: string) => void;
  onClosed: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();

  // --- State: buka shift ---
  const [openingCash, setOpeningCash] = useState("");
  const [openingSaving, setOpeningSaving] = useState(false);

  // --- State: cash in/out & tutup shift ---
  const [tab, setTab] = useState<Tab>("cash_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementSent, setMovementSent] = useState<string | null>(null);

  const [summary, setSummary] = useState<ShiftCashSummary | null>(null);
  const [actualCash, setActualCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [closedResult, setClosedResult] = useState<{ expected: number; actual: number; difference: number } | null>(null);

  // CATATAN PENTING (Blind Cashier Shift Closing — Requirement 3):
  // Sebelumnya modul ini memanggil `shift_cash_summary` dan LANGSUNG
  // menampilkan Expected Cash + selisih yang ter-update live begitu kasir
  // mengetik Actual Cash — itu artinya kasir bisa lihat dulu angka omzet
  // sistem sebelum/sambil menghitung fisik laci, yang membatalkan seluruh
  // tujuan blind count (mendeteksi selisih JUJUR, bukan angka yang
  // "disesuaikan" supaya pas). Sekarang `shift_cash_summary` HANYA
  // dipanggil SETELAH `close_shift` berhasil disimpan (lihat
  // handleCloseShift) — kasir input Actual Cash lebih dulu tanpa
  // petunjuk apapun, baru laporan selisih lengkap muncul di layar
  // `closedResult` setelah kas ditutup dan tidak bisa diubah lagi.

  async function handleOpenShift() {
    if (!openingCash) {
      alert("Isi modal awal kas terlebih dahulu (boleh 0 kalau memang belum ada uang tunai di laci).");
      return;
    }
    setOpeningSaving(true);
    const { data, error } = await supabase.rpc("open_shift_v2", {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_cashier_id: cashierId,
      p_opening_cash: Number(openingCash),
    });
    setOpeningSaving(false);
    if (error) {
      alert("Gagal membuka shift: " + error.message);
      return;
    }
    const { data: shiftRow } = await supabase.from("shifts").select("opened_at").eq("id", data).single();
    onOpened(data as string, shiftRow?.opened_at ?? new Date().toISOString());
  }

  async function handleMovement() {
    if (!shiftId) return;
    if (!amount || Number(amount) <= 0) {
      alert("Nominal harus lebih dari 0.");
      return;
    }
    if (!reason.trim()) {
      alert("Keterangan wajib diisi.");
      return;
    }
    setMovementSaving(true);
    const { error } = await supabase.rpc("record_cash_movement", {
      p_shift_id: shiftId,
      p_type: tab, // 'cash_in' | 'cash_out'
      p_amount: Number(amount),
      p_reason: reason.trim(),
    });
    setMovementSaving(false);
    if (error) {
      alert("Gagal mencatat: " + error.message);
      return;
    }
    setMovementSent(tab === "cash_in" ? "Kas masuk tercatat." : "Kas keluar tercatat.");
    setAmount("");
    setReason("");
    setTimeout(() => setMovementSent(null), 3000);
  }

  async function handleCloseShift() {
    if (!shiftId) return;
    if (!actualCash) {
      alert("Isi hasil hitung fisik uang tunai di laci (Actual Cash) terlebih dahulu.");
      return;
    }
    if (!confirm("Tutup shift sekarang? Setelah ditutup, transaksi baru tidak bisa dikaitkan ke shift ini lagi dan Actual Cash tidak bisa diubah.")) return;

    setClosing(true);
    // Blind close: kasir mengirim Actual Cash TANPA pernah melihat
    // Expected Cash sistem — server (`close_shift`) yang menghitung &
    // membandingkan keduanya, baru dikembalikan ke sini sebagai hasil.
    const { data, error } = await supabase.rpc("close_shift", {
      p_shift_id: shiftId,
      p_actual_cash: Number(actualCash),
      p_notes: closingNotes.trim() || null,
    });
    if (error) {
      setClosing(false);
      alert("Gagal menutup shift: " + error.message);
      return;
    }
    const row = data[0];
    setClosedResult({ expected: row.expected_cash, actual: row.actual_cash, difference: row.difference });

    // Shift sudah tertutup permanen di titik ini — sekarang BARU aman
    // untuk mengambil rincian lengkap (modal awal, kas masuk/keluar,
    // total transaksi tunai) untuk Laporan Selisih Kas, karena kasir
    // sudah tidak bisa lagi mengubah input Actual Cash-nya.
    const { data: summaryRows } = await supabase.rpc("shift_cash_summary", { p_shift_id: shiftId });
    if (summaryRows && summaryRows.length > 0) setSummary(summaryRows[0] as ShiftCashSummary);
    setClosing(false);
  }

  // --- Tampilan setelah shift berhasil ditutup: Laporan Selisih Kas ---
  if (closedResult) {
    const isBalanced = closedResult.difference === 0;
    return (
      <Modal title="Laporan Selisih Kas (Z-Report)" onClose={onClosed} footer={<button onClick={onClosed} className="btn-primary w-full">Tutup</button>}>
        <div className="text-center py-2">
          {isBalanced ? (
            <CheckCircle2 className="mx-auto text-emerald-600 mb-2" size={40} />
          ) : (
            <AlertTriangle className="mx-auto text-amber-500 mb-2" size={40} />
          )}
          <p className="font-semibold text-neutral-900">{isBalanced ? "Kas Seimbang" : "Ada Selisih Kas"}</p>
          <p className="text-xs text-neutral-400 mt-1">Blind Closing — Actual Cash sudah dikunci, tidak bisa diubah lagi.</p>
        </div>

        {/* Rincian lengkap — BARU boleh ditampilkan sekarang, setelah shift
            benar-benar tertutup, supaya tidak bisa mempengaruhi angka
            Actual Cash yang sudah dikirim di atas. */}
        {summary && (
          <div className="space-y-1.5 text-sm bg-neutral-50 rounded-xl p-3">
            <div className="flex justify-between"><span className="text-neutral-500">Modal Awal (Opening Float)</span><span>{formatRupiah(summary.opening_cash)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Total Transaksi Tunai</span><span>{formatRupiah(summary.total_cash_sales)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Kas Masuk</span><span>+{formatRupiah(summary.total_cash_in)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Kas Keluar</span><span>-{formatRupiah(summary.total_cash_out)}</span></div>
            <p className="text-[11px] text-neutral-400 pt-1">
              Total {summary.total_transactions_count} transaksi ({formatRupiah(summary.total_transactions)}) — termasuk non-tunai.
            </p>
          </div>
        )}

        <div className="space-y-2 text-sm border-t border-neutral-100 pt-3">
          <div className="flex justify-between"><span className="text-neutral-500">Expected Cash (sistem)</span><span className="font-medium">{formatRupiah(closedResult.expected)}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Actual Cash (hitung fisik kasir)</span><span className="font-medium">{formatRupiah(closedResult.actual)}</span></div>
          <div className={`flex justify-between font-bold text-base pt-1 border-t border-neutral-100 ${closedResult.difference < 0 ? "text-urgent" : closedResult.difference > 0 ? "text-primary" : "text-neutral-900"}`}>
            <span>Selisih (Variance)</span>
            <span>{closedResult.difference > 0 ? "+" : ""}{formatRupiah(closedResult.difference)}</span>
          </div>
        </div>
      </Modal>
    );
  }

  // --- Belum ada shift terbuka: form Opening Cash (wajib) ---
  if (!shiftId) {
    return (
      <Modal
        title="Buka Shift — Modal Awal Kas"
        onClose={onClose}
        footer={
          <button disabled={openingSaving} onClick={handleOpenShift} className="btn-primary w-full flex items-center justify-center gap-2">
            {openingSaving && <Loader2 className="animate-spin" size={16} />} Mulai Shift
          </button>
        }
      >
        <p className="text-sm text-neutral-500">
          Masukkan jumlah uang tunai (float cash) di laci sebelum mulai melayani transaksi hari ini.
        </p>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Modal Awal (Rp)</label>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={formatNumberWithDots(openingCash)}
            onChange={(e) => setOpeningCash(stripNumberDots(e.target.value))}
            placeholder="Contoh: 500.000"
            className="input-field text-lg font-semibold"
          />
        </div>
      </Modal>
    );
  }

  // --- Shift sedang berjalan: tab Cash In / Cash Out / Tutup Shift ---
  return (
    <Modal title="Manajemen Kasir & Kas Shift" onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 -mt-1">
        <button onClick={() => setTab("cash_in")} className={tab === "cash_in" ? "py-2 rounded-xl bg-primary text-white text-xs font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-xs font-semibold flex flex-col items-center gap-1"}>
          <ArrowDownCircle size={16} /> Kas Masuk
        </button>
        <button onClick={() => setTab("cash_out")} className={tab === "cash_out" ? "py-2 rounded-xl bg-primary text-white text-xs font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-xs font-semibold flex flex-col items-center gap-1"}>
          <ArrowUpCircle size={16} /> Kas Keluar
        </button>
        <button onClick={() => setTab("close")} className={tab === "close" ? "py-2 rounded-xl bg-primary text-white text-xs font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-xs font-semibold flex flex-col items-center gap-1"}>
          <Wallet size={16} /> Tutup Shift
        </button>
      </div>

      {(tab === "cash_in" || tab === "cash_out") && (
        <div className="space-y-3 pt-2">
          <p className="text-xs text-neutral-500">
            {tab === "cash_in"
              ? "Pemasukan tunai non-transaksi (mis. setoran modal tambahan)."
              : "Pengeluaran kecil dari laci kasir (mis. Beli Es Batu Darurat)."}
          </p>
          {movementSent && <div className="bg-emerald-50 text-emerald-700 text-xs rounded-lg px-3 py-2">{movementSent}</div>}
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nominal (Rp)</label>
            <input
              type="text"
              inputMode="numeric"
              value={formatNumberWithDots(amount)}
              onChange={(e) => setAmount(stripNumberDots(e.target.value))}
              placeholder="Contoh: 20.000"
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Keterangan</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tab === "cash_in" ? "Contoh: Setoran modal tambahan" : "Contoh: Beli Es Batu Darurat"}
              className="input-field"
              maxLength={140}
            />
          </div>
          <button disabled={movementSaving} onClick={handleMovement} className="btn-primary w-full flex items-center justify-center gap-2">
            {movementSaving && <Loader2 className="animate-spin" size={16} />} Simpan
          </button>
        </div>
      )}

      {tab === "close" && (
        <div className="space-y-3 pt-2">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
            <strong>Blind Closing.</strong> Hitung fisik uang tunai di laci SEKARANG, sebelum lihat rincian apapun dari sistem. Angka omzet sistem baru muncul setelah shift ini ditutup.
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Actual Cash (hasil hitung fisik laci)</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={formatNumberWithDots(actualCash)}
              onChange={(e) => setActualCash(stripNumberDots(e.target.value))}
              placeholder="Contoh: 1.250.000"
              className="input-field text-lg font-semibold"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan (opsional)</label>
            <textarea
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              rows={2}
              className="input-field resize-none"
              placeholder="Mis. kondisi laci, kejadian selama shift, dll."
            />
          </div>

          <button disabled={closing || !actualCash} onClick={handleCloseShift} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
            {closing && <Loader2 className="animate-spin" size={16} />} Kunci &amp; Tutup Shift Sekarang
          </button>
        </div>
      )}
    </Modal>
  );
}
