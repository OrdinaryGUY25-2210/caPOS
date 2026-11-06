"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  LogOut,
  RefreshCw,
  HandCoins,
  Lock,
  ShieldCheck,
} from "lucide-react";
import Modal from "@/components/Modal";
import SupervisorPinModal from "@/components/SupervisorPinModal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatNumberWithDots, stripNumberDots } from "@/lib/utils";
import type { ShiftCashSummary } from "@/lib/types";

type Tab = "cash_in" | "cash_out" | "exchange" | "close";

/**
 * Modal Manajemen Kasir — dipanggil dari /pos. Punya 2 mode:
 *
 *  - Belum ada shift terbuka (shiftId null): tampilkan form Opening Cash
 *    (modal awal) — kasir WAJIB isi ini sebelum bisa mulai transaksi.
 *  - Sudah ada shift terbuka: tampilkan tab Cash In / Cash Out / Tukar Uang
 *    / Tutup Shift.
 *
 * migration_023 menambahkan:
 *  - Tukar uang (net zero, tercatat berpasangan di cash_movements)
 *  - No-sale (buka laci) dengan otorisasi PIN untuk kasir
 *  - Peringatan petty cash TANPA membocorkan omzet (blind closing)
 *  - Ringkasan kembalian PENDING + tutup paksa dengan PIN supervisor
 */
export default function ShiftModal({
  tenantId,
  branchId,
  cashierId,
  shiftId,
  role,
  onOpened,
  onClosed,
  onClose,
}: {
  tenantId: string;
  branchId: string | null;
  cashierId: string;
  /** null = belum ada shift terbuka -> tampilkan form buka shift */
  shiftId: string | null;
  /** Peran pemakai; kasir wajib PIN untuk no-sale / tutup paksa. */
  role: string;
  onOpened: (shiftId: string, openedAt: string) => void;
  onClosed: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();

  // --- State: buka shift ---
  const [openingCash, setOpeningCash] = useState("");
  const [openingSaving, setOpeningSaving] = useState(false);

  // --- State: cash in/out ---
  const [tab, setTab] = useState<Tab>("cash_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementSent, setMovementSent] = useState<string | null>(null);

  // --- State: tukar uang & no-sale (migration_023) ---
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [exchangeReason, setExchangeReason] = useState("");
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeSent, setExchangeSent] = useState<string | null>(null);
  const [noSaleReason, setNoSaleReason] = useState("");
  const [showNoSalePin, setShowNoSalePin] = useState(false);
  const [noSaleSaving, setNoSaleSaving] = useState(false);
  const [cashAlert, setCashAlert] = useState<{ is_low: boolean; threshold: number } | null>(null);
  const [cashAlertLoading, setCashAlertLoading] = useState(false);

  // --- State: tutup shift ---
  const [summary, setSummary] = useState<ShiftCashSummary | null>(null);
  const [actualCash, setActualCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closedResult, setClosedResult] = useState<{
    expected: number;
    actual: number;
    difference: number;
    pendingAmount: number;
    pendingCount: number;
  } | null>(null);

  // migration_023 — kembalian PENDING memblokir tutup shift normal.
  const [pendingChanges, setPendingChanges] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });
  const [forcePrompt, setForcePrompt] = useState(false);
  const [forceCloseError, setForceCloseError] = useState<string | null>(null);
  const [showForcePin, setShowForcePin] = useState(false);

  // --- State: keluar dari akun sebelum shift dibuka ---
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);

  // CATATAN PENTING (Blind Cashier Shift Closing): Expected Cash TIDAK
  // pernah ditampilkan sebelum shift ditutup. `shift_cash_summary` hanya
  // dipanggil SETELAH `close_shift` berhasil. Ringkasan kembalian PENDING
  // di bawah aman karena hanya kewajiban ke pelanggan, bukan omzet.

  async function loadPendingChanges() {
    if (!shiftId) return;
    const { data } = await supabase
      .from("transactions")
      .select("change_amount")
      .eq("shift_id", shiftId)
      .eq("change_status", "PENDING");
    const rows = (data ?? []) as { change_amount: number }[];
    setPendingChanges({
      count: rows.length,
      amount: rows.reduce((sum, r) => sum + Number(r.change_amount ?? 0), 0),
    });
  }

  useEffect(() => {
    if (shiftId) loadPendingChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

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

  async function handleExchange() {
    if (!shiftId) return;
    if (!exchangeAmount || Number(exchangeAmount) <= 0) {
      alert("Nominal penukaran harus lebih dari 0.");
      return;
    }
    if (!exchangeReason.trim()) {
      alert("Keterangan penukaran wajib diisi.");
      return;
    }
    setExchangeSaving(true);
    const { error } = await supabase.rpc("record_cash_exchange", {
      p_shift_id: shiftId,
      p_amount: Number(exchangeAmount),
      p_reason: exchangeReason.trim(),
    });
    setExchangeSaving(false);
    if (error) {
      alert("Gagal mencatat penukaran uang: " + error.message);
      return;
    }
    setExchangeSent("Penukaran uang tercatat (kas keluar & masuk dengan nominal sama, net 0).");
    setExchangeAmount("");
    setExchangeReason("");
    setTimeout(() => setExchangeSent(null), 4000);
  }

  async function doNoSale(pin: string | null, reasonText: string) {
    if (!shiftId) return { error: "Shift tidak ditemukan." };
    const { error } = await supabase.rpc("log_no_sale", {
      p_shift_id: shiftId,
      p_reason: reasonText,
      p_supervisor_pin: pin,
    });
    if (error) return { error: error.message };
    setNoSaleReason("");
    setExchangeSent("Buka laci (no sale) tercatat di audit log.");
    setTimeout(() => setExchangeSent(null), 4000);
    return {};
  }

  function handleNoSale() {
    if (role === "cashier") {
      setShowNoSalePin(true);
      return;
    }
    if (!noSaleReason.trim()) {
      alert("Alasan buka laci wajib diisi.");
      return;
    }
    setNoSaleSaving(true);
    doNoSale(null, noSaleReason.trim()).then((res) => {
      setNoSaleSaving(false);
      if (res.error) alert("Gagal mencatat no-sale: " + res.error);
    });
  }

  async function handleCheckCashAlert() {
    if (!shiftId) return;
    setCashAlertLoading(true);
    const { data, error } = await supabase.rpc("shift_cash_alert", { p_shift_id: shiftId });
    setCashAlertLoading(false);
    if (error) {
      alert("Gagal memeriksa kas: " + error.message);
      return;
    }
    const row = (data as { is_low: boolean; threshold: number }[] | null)?.[0];
    setCashAlert(row ?? null);
  }

  function handleCloseShift() {
    if (!shiftId) return;
    if (!actualCash) {
      alert("Isi hasil hitung fisik uang tunai di laci (Actual Cash) terlebih dahulu.");
      return;
    }
    setCloseError(null);
    setConfirmingClose(true);
  }

  async function handleExitWithoutShift() {
    setExiting(true);
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  async function applyCloseShift(opts: { force?: boolean; pin?: string; reason?: string } = {}): Promise<{ error?: string }> {
    if (!shiftId) return { error: "Shift tidak ditemukan." };
    setCloseError(null);
    setForceCloseError(null);
    setClosing(true);

    // Gabungkan catatan kasir dengan alasan otorisasi supaya jejak audit
    // tetap memuat konteks kenapa shift ditutup paksa.
    const mergedNotes =
      [closingNotes.trim(), opts.reason?.trim()].filter(Boolean).join(" — ") || null;

    // Blind close: kasir mengirim Actual Cash TANPA pernah melihat
    // Expected Cash sistem — server (`close_shift`) yang menghitung &
    // membandingkan keduanya, baru dikembalikan ke sini sebagai hasil.
    const { data, error } = await supabase.rpc("close_shift", {
      p_shift_id: shiftId,
      p_actual_cash: Number(actualCash),
      p_notes: mergedNotes,
      p_force_close: !!opts.force,
      p_supervisor_pin: opts.pin ?? null,
    });
    setClosing(false);

    if (error) {
      setConfirmingClose(false);
      if (error.message.includes("PENDING_CHANGE")) {
        // Server sengaja menolak tutup shift normal. Tampilkan jalur tutup
        // paksa (PIN untuk kasir) tanpa membocorkan expected cash.
        setForcePrompt(true);
        setForceCloseError(error.message.replace(/^PENDING_CHANGE:\s*/, ""));
        await loadPendingChanges();
        return {};
      }
      setCloseError("Gagal menutup shift: " + error.message);
      return { error: error.message };
    }

    const row = data[0];
    setClosedResult({
      expected: row.expected_cash,
      actual: row.actual_cash,
      difference: row.difference,
      pendingAmount: Number(row.pending_change_amount ?? 0),
      pendingCount: Number(row.pending_change_count ?? 0),
    });
    setConfirmingClose(false);
    setForcePrompt(false);

    // Shift sudah tertutup permanen di titik ini — sekarang BARU aman
    // untuk mengambil rincian lengkap (modal awal, kas masuk/keluar,
    // total transaksi tunai) untuk Laporan Selisih Kas.
    const { data: summaryRows } = await supabase.rpc("shift_cash_summary", { p_shift_id: shiftId });
    if (summaryRows && summaryRows.length > 0) setSummary(summaryRows[0] as ShiftCashSummary);
    return {};
  }

  // --- Tampilan setelah shift berhasil ditutup: Laporan Selisih Kas ---
  if (closedResult) {
    const isBalanced = closedResult.difference === 0;

    function handleAcknowledge() {
      setClosedResult(null);
      setSummary(null);
      onClosed();
    }

    return (
      <Modal title="Laporan Selisih Kas (Z-Report)" onClose={handleAcknowledge} footer={<button onClick={handleAcknowledge} className="btn-primary w-full">Tutup</button>}>
        <div className="text-center py-2">
          {isBalanced ? (
            <CheckCircle2 className="mx-auto text-emerald-600 mb-2" size={40} />
          ) : (
            <AlertTriangle className="mx-auto text-amber-500 mb-2" size={40} />
          )}
          <p className="font-semibold text-neutral-900">{isBalanced ? "Kas Seimbang" : "Ada Selisih Kas"}</p>
          <p className="text-xs text-neutral-400 mt-1">Blind Closing — Actual Cash sudah dikunci, tidak bisa diubah lagi.</p>
        </div>

        {summary && (
          <div className="space-y-1.5 text-sm bg-neutral-50 rounded-xl p-3">
            <div className="flex justify-between"><span className="text-neutral-500">Modal Awal (Opening Float)</span><span>{formatRupiah(summary.opening_cash)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Total Transaksi Tunai</span><span>{formatRupiah(summary.total_cash_sales)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Kas Masuk</span><span>+{formatRupiah(summary.total_cash_in)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Kas Keluar</span><span>-{formatRupiah(summary.total_cash_out)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Uang Tunai Diterima</span><span>{formatRupiah(summary.total_cash_received)}</span></div>
            <p className="text-[11px] text-neutral-400 pt-1">
              Total {summary.total_transactions_count} transaksi ({formatRupiah(summary.total_transactions)}) — termasuk non-tunai.
            </p>
          </div>
        )}

        {(closedResult.pendingCount > 0 || (summary?.pending_change_count ?? 0) > 0) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <HandCoins size={14} /> Kembalian ditutup paksa
            </p>
            <p>
              {closedResult.pendingCount || summary?.pending_change_count || 0} transaksi dengan total{" "}
              {formatRupiah(closedResult.pendingAmount || summary?.total_change_owed || 0)} masih berstatus PENDING.
              Selesaikan lewat daftar transaksi setelah shift ini ditutup.
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
        onClose={() => (confirmExit ? handleExitWithoutShift() : setConfirmExit(true))}
        footer={
          confirmExit ? (
            <div className="space-y-2.5">
              <p className="text-xs text-urgent flex items-start gap-1.5">
                <LogOut size={14} className="shrink-0 mt-0.5" />
                Keluar dari akun kasir ini di perangkat ini? Shift belum dibuka, jadi tidak ada modal awal yang tercatat dan transaksi tidak bisa dilayani sampai shift dibuka.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={exiting}
                  onClick={() => setConfirmExit(false)}
                  className="btn-outline flex-1 text-sm py-2 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  disabled={exiting}
                  onClick={handleExitWithoutShift}
                  className="flex-1 text-sm py-2 rounded-xl bg-urgent hover:bg-red-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {exiting && <Loader2 className="animate-spin" size={16} />} Ya, Keluar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button disabled={openingSaving} onClick={handleOpenShift} className="btn-primary w-full flex items-center justify-center gap-2">
                {openingSaving && <Loader2 className="animate-spin" size={16} />} Mulai Shift
              </button>
              <button
                disabled={openingSaving}
                onClick={() => setConfirmExit(true)}
                className="btn-outline w-full flex items-center justify-center gap-2 text-sm"
              >
                <LogOut size={14} /> Keluar dari Akun
              </button>
            </div>
          )
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
        <p className="text-xs text-neutral-400">
          Belum mau mulai shift? Tekan <span className="font-medium">Keluar dari Akun</span> di bawah atau tombol
          X di atas.
        </p>
      </Modal>
    );
  }

  // --- Shift sedang berjalan: tab Cash In / Cash Out / Tukar Uang / Tutup ---
  return (
    <Modal title="Manajemen Kasir & Kas Shift" onClose={onClose}>
      <div className="grid grid-cols-4 gap-1.5 -mt-1">
        <button onClick={() => setTab("cash_in")} className={tab === "cash_in" ? "py-2 rounded-xl bg-primary text-white text-[11px] font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-[11px] font-semibold flex flex-col items-center gap-1"}>
          <ArrowDownCircle size={15} /> Masuk
        </button>
        <button onClick={() => setTab("cash_out")} className={tab === "cash_out" ? "py-2 rounded-xl bg-primary text-white text-[11px] font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-[11px] font-semibold flex flex-col items-center gap-1"}>
          <ArrowUpCircle size={15} /> Keluar
        </button>
        <button onClick={() => setTab("exchange")} className={tab === "exchange" ? "py-2 rounded-xl bg-primary text-white text-[11px] font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-[11px] font-semibold flex flex-col items-center gap-1"}>
          <RefreshCw size={15} /> Tukar
        </button>
        <button onClick={() => setTab("close")} className={tab === "close" ? "py-2 rounded-xl bg-primary text-white text-[11px] font-semibold flex flex-col items-center gap-1" : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-[11px] font-semibold flex flex-col items-center gap-1"}>
          <Wallet size={15} /> Tutup
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

      {tab === "exchange" && (
        <div className="space-y-4 pt-2">
          {exchangeSent && <div className="bg-emerald-50 text-emerald-700 text-xs rounded-lg px-3 py-2">{exchangeSent}</div>}

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
                <RefreshCw size={14} /> Tukar Uang (Pecahan)
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Catat penukaran uang besar/kecil. Dibuat berpasangan kas keluar + kas masuk dengan nominal sama,
                jadi saldo laci tidak berubah — hanya histori pecahan yang tercatat.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nominal Ditukar (Rp)</label>
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberWithDots(exchangeAmount)}
                onChange={(e) => setExchangeAmount(stripNumberDots(e.target.value))}
                placeholder="Contoh: 100.000"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Keterangan</label>
              <input
                value={exchangeReason}
                onChange={(e) => setExchangeReason(e.target.value)}
                placeholder="Contoh: Tukar 2 lembar 50rb jadi 10 lembar 10rb"
                className="input-field"
                maxLength={140}
              />
            </div>
            <button disabled={exchangeSaving} onClick={handleExchange} className="btn-primary w-full flex items-center justify-center gap-2">
              {exchangeSaving && <Loader2 className="animate-spin" size={16} />} Catat Penukaran
            </button>
          </div>

          <div className="border-t border-neutral-100 pt-3 space-y-2">
            <p className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
              <Lock size={14} /> Buka Laci Tanpa Transaksi (No Sale)
            </p>
            <p className="text-xs text-neutral-500">
              Untuk mengecek uang atau menukar pecahan ke pelanggan. Wajib tercatat dan, untuk kasir,
              wajib PIN supervisor.
            </p>
            {role !== "cashier" && (
              <input
                value={noSaleReason}
                onChange={(e) => setNoSaleReason(e.target.value)}
                placeholder="Alasan, mis. pelanggan minta pecahan"
                className="input-field"
                maxLength={140}
              />
            )}
            <button
              disabled={noSaleSaving}
              onClick={handleNoSale}
              className="btn-outline w-full flex items-center justify-center gap-2"
            >
              {noSaleSaving ? <Loader2 className="animate-spin" size={16} /> : <Lock size={16} />}
              {role === "cashier" ? "Buka Laci (Wajib PIN)" : "Catat Buka Laci"}
            </button>
          </div>

          <div className="border-t border-neutral-100 pt-3 space-y-2">
            <p className="text-sm font-semibold text-neutral-900">Cek Kas Laci</p>
            <p className="text-xs text-neutral-500">
              Memeriksa apakah kas laci di bawah batas petty cash. Hasilnya HANYA peringatan —
              angka omzet/expected cash tidak ditampilkan (blind closing).
            </p>
            <button
              disabled={cashAlertLoading}
              onClick={handleCheckCashAlert}
              className="btn-outline w-full flex items-center justify-center gap-2"
            >
              {cashAlertLoading ? <Loader2 className="animate-spin" size={16} /> : <Wallet size={16} />} Cek Kas Laci
            </button>
            {cashAlert && (
              cashAlert.is_low ? (
                <div className="bg-urgent-light text-urgent text-xs rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  Kas laci di bawah batas {formatRupiah(cashAlert.threshold)}. Lakukan setoran/penukaran
                  uang agar cukup untuk kembalian.
                </div>
              ) : (
                <div className="bg-emerald-50 text-emerald-700 text-xs rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  Kas laci masih di atas batas minimum {formatRupiah(cashAlert.threshold)}.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {tab === "close" && (
        <div className="space-y-3 pt-2">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
            <strong>Blind Closing.</strong> Hitung fisik uang tunai di laci SEKARANG, sebelum lihat rincian apapun dari sistem. Angka omzet sistem baru muncul setelah shift ini ditutup.
          </div>

          {pendingChanges.count > 0 && (
            <div className="rounded-xl border border-urgent/30 bg-urgent-light/50 p-3 text-xs text-urgent space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <HandCoins size={14} /> {pendingChanges.count} kembalian belum diserahkan
              </p>
              <p>Total {formatRupiah(pendingChanges.amount)}. Selesaikan dulu lewat banner di layar kasir.</p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Actual Cash (hasil hitung fisik laci)</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={formatNumberWithDots(actualCash)}
              onChange={(e) => {
                setActualCash(stripNumberDots(e.target.value));
                setForcePrompt(false);
                setForceCloseError(null);
              }}
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

          {forcePrompt ? (
            <div className="rounded-xl border border-urgent/30 bg-urgent-light/60 p-3 space-y-2.5">
              <p className="text-xs text-urgent flex items-start gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {forceCloseError ?? "Masih ada kembalian yang belum diserahkan."}
              </p>
              <p className="text-[11px] text-neutral-600">
                Selesaikan kembalian lewat banner di layar kasir, atau tutup paksa dengan otorisasi
                supervisor. Kembalian tetap tercatat PENDING dan harus diselesaikan setelah shift ditutup.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={closing}
                  onClick={() => setForcePrompt(false)}
                  className="btn-outline flex-1 text-sm py-2 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  disabled={closing}
                  onClick={() => {
                    if (role === "cashier") setShowForcePin(true);
                    else applyCloseShift({ force: true });
                  }}
                  className="flex-1 text-sm py-2 rounded-xl bg-urgent hover:bg-red-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {closing ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                  Tutup Paksa
                </button>
              </div>
            </div>
          ) : confirmingClose ? (
            <div className="rounded-xl border border-urgent/30 bg-urgent-light/60 p-3 space-y-2.5">
              <p className="text-xs text-urgent flex items-start gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Tutup shift sekarang? Setelah ditutup, transaksi baru tidak bisa dikaitkan ke shift ini lagi dan
                Actual Cash tidak bisa diubah.
              </p>
              {closeError && <p className="text-xs text-urgent font-medium">{closeError}</p>}
              <div className="flex gap-2">
                <button
                  disabled={closing}
                  onClick={() => setConfirmingClose(false)}
                  className="btn-outline flex-1 text-sm py-2 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  disabled={closing}
                  onClick={() => applyCloseShift()}
                  className="flex-1 text-sm py-2 rounded-xl bg-urgent hover:bg-red-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {closing && <Loader2 className="animate-spin" size={16} />} Ya, Tutup Shift
                </button>
              </div>
            </div>
          ) : (
            <button disabled={closing || !actualCash} onClick={handleCloseShift} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              <Wallet size={16} /> Kunci &amp; Tutup Shift Sekarang
            </button>
          )}
        </div>
      )}

      {showNoSalePin && (
        <SupervisorPinModal
          action="NO_SALE"
          branchId={branchId}
          contextLabel="Buka laci tanpa transaksi"
          onClose={() => setShowNoSalePin(false)}
          onConfirm={async ({ pin, reason }) => {
            const result = await doNoSale(pin, reason);
            if (!result.error) setShowNoSalePin(false);
            return result;
          }}
        />
      )}

      {showForcePin && (
        <SupervisorPinModal
          action="FORCE_CLOSE_SHIFT"
          branchId={branchId}
          contextLabel={`Tutup paksa shift — ${pendingChanges.count} kembalian belum diserahkan`}
          onClose={() => setShowForcePin(false)}
          onConfirm={async ({ pin, reason }) => {
            const result = await applyCloseShift({ force: true, pin, reason });
            if (!result.error) setShowForcePin(false);
            return result;
          }}
        />
      )}
    </Modal>
  );
}
