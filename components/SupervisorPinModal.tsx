"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, KeyRound } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import type { SensitiveAction, SupervisorAuthResult } from "@/lib/types";

const ACTION_LABEL: Record<SensitiveAction, string> = {
  VOID_ITEM: "Batalkan Item (Void)",
  CANCEL_ORDER: "Batalkan Pesanan",
  MANUAL_DISCOUNT: "Diskon Manual",
  PRICE_OVERRIDE: "Ubah Harga (Price Override)",
};

const REASON_PLACEHOLDER: Record<SensitiveAction, string> = {
  VOID_ITEM: "Contoh: salah input, pelanggan batal",
  CANCEL_ORDER: "Contoh: pelanggan membatalkan seluruh pesanan",
  MANUAL_DISCOUNT: "Contoh: kompensasi komplain, promo internal",
  PRICE_OVERRIDE: "Contoh: harga event khusus, negosiasi manager",
};

/**
 * Modal otorisasi PIN Supervisor (Migrasi 019) — gerbang UI untuk 4
 * tindakan sensitif kasir (Void Item, Cancel Order, Manual Discount,
 * Price Override). PIN dicek dulu di sini lewat verify_supervisor_pin()
 * (read-only, TIDAK mencatat audit_log) supaya kasir dapat feedback
 * instan kalau salah ketik — otorisasi RESMI & audit_log tetap terjadi
 * di server saat onConfirm memanggil RPC tindakan aslinya (yang secara
 * internal memanggil require_supervisor_authorization() lagi). Modal
 * ini TIDAK bisa dilewati dari client: kalaupun seseorang memanggil
 * RPC langsung tanpa modal ini, server tetap menolak tanpa PIN valid.
 *
 * Manager/Owner/Super Admin yang sedang login TIDAK diminta PIN (server
 * juga sudah membebaskan mereka) — modal ini otomatis dilewati oleh
 * pemanggil untuk peran tersebut (lihat helper useSupervisorGate di
 * bawah, dipakai di RefundModal/OpenBillPanel dsb).
 */
export default function SupervisorPinModal({
  action,
  branchId,
  contextLabel,
  onClose,
  onConfirm,
}: {
  action: SensitiveAction;
  branchId: string | null;
  /** Konteks singkat, mis. "2x Nasi Goreng — Rp30.000" atau "Order ORD-014 — Rp250.000". */
  contextLabel?: string;
  onClose: () => void;
  /** Dipanggil setelah PIN valid & alasan diisi. Parent yang memanggil RPC tindakan
   * aslinya (mengirim pin+reason) dan mengembalikan { error } kalau gagal supaya
   * modal tetap terbuka dan menampilkan pesan error, atau tidak mengembalikan
   * apa pun / undefined kalau sukses (modal otomatis menutup). */
  onConfirm: (args: { pin: string; reason: string }) => Promise<{ error?: string } | void>;
}) {
  const supabase = createClient();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState<SupervisorAuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Verifikasi PIN begitu 4-6 digit sudah diketik — read-only, tidak
  // menulis audit_log (hanya require_supervisor_authorization di server
  // yang mencatat, dipanggil dari RPC tindakan aslinya lewat onConfirm).
  useEffect(() => {
    setVerified(null);
    setError(null);
    if (!/^[0-9]{4,6}$/.test(pin)) return;
    let cancelled = false;
    setChecking(true);
    (async () => {
      const { data, error: rpcError } = await supabase.rpc("verify_supervisor_pin", {
        p_pin: pin,
        p_branch_id: branchId,
      });
      if (cancelled) return;
      setChecking(false);
      if (rpcError) {
        setError("Gagal memeriksa PIN: " + rpcError.message);
        return;
      }
      const row = (data as SupervisorAuthResult[] | null)?.[0] ?? null;
      if (!row) {
        setError("PIN supervisor tidak dikenali.");
      } else {
        setVerified(row);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, branchId]);

  async function handleSubmit() {
    if (!verified) return;
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onConfirm({ pin, reason: reason.trim() });
    setSubmitting(false);
    if (result?.error) {
      setError(result.error);
    } else {
      onClose();
    }
  }

  return (
    <Modal title={`Otorisasi Supervisor — ${ACTION_LABEL[action]}`} onClose={onClose}>
      <div className="space-y-4">
        {contextLabel && (
          <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-700">
            {contextLabel}
          </div>
        )}

        <p className="text-xs text-neutral-500 flex items-start gap-1.5">
          <ShieldAlert size={14} className="shrink-0 mt-0.5" />
          Tindakan ini wajib PIN Manager/Owner. Masukkan PIN supervisor yang sedang bertugas.
        </p>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">PIN Supervisor</label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4-6 digit"
              className="input-field pl-9 tracking-[0.3em] text-center font-semibold"
              autoComplete="one-time-code"
            />
            {checking && <Loader2 className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />}
          </div>
          {verified && (
            <p className="text-xs text-primary flex items-center gap-1 mt-1.5">
              <ShieldCheck size={12} /> Terverifikasi — {verified.supervisor_name ?? "Supervisor"} ({verified.supervisor_role})
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={REASON_PLACEHOLDER[action]}
            className="input-field text-sm"
            rows={2}
          />
        </div>

        {error && <p className="text-xs text-urgent">{error}</p>}

        <button
          disabled={!verified || !reason.trim() || submitting}
          onClick={handleSubmit}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
          Otorisasi &amp; Lanjutkan
        </button>
      </div>
    </Modal>
  );
}
