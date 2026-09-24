"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { ErrorState, LoadingState, PosButton, SectionLabel, SuccessState } from "./ui";

export interface QrisState {
  configured: boolean;
  enabled: boolean;
  status: "idle" | "creating" | "pending" | "paid" | "failed" | "expired";
  qrUrl: string | null;
  error: string | null;
}

export default function QRISPayment({
  state,
  onCreate,
  disabled,
}: {
  state: QrisState;
  onCreate: () => void;
  disabled?: boolean;
}) {
  if (!state.configured) {
    return (
      <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2.5 text-xs text-neutral-500">
        QRIS dinamis belum aktif untuk cabang ini. Kasir tetap bisa menyelesaikan transaksi dengan
        memverifikasi QRIS manual dari EDC / aplikasi bank.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionLabel hint="Otomatis, dari Midtrans per-cabang">QRIS Dinamis</SectionLabel>

      {!state.enabled && (
        <PosButton variant="outline" onClick={onCreate} disabled={disabled} fullWidth>
          Buat Kode QRIS Dinamis
        </PosButton>
      )}

      {state.enabled && state.status === "creating" && (
        <LoadingState message="Membuat kode QRIS..." compact />
      )}

      {state.enabled && state.qrUrl && (state.status === "pending" || state.status === "paid") && (
        <div className="flex flex-col items-center gap-2 py-2">
          <img
            src={state.qrUrl}
            alt="Kode QRIS"
            className="w-48 h-48 rounded-xl border border-neutral-200 bg-white"
          />
          {state.status === "pending" && (
            <p className="text-sm text-neutral-500 animate-pulse">
              Menunggu pelanggan scan &amp; bayar...
            </p>
          )}
          {state.status === "paid" && <SuccessState message="Pembayaran diterima" />}
        </div>
      )}

      {state.enabled && (state.status === "failed" || state.status === "expired") && (
        <div className="space-y-2">
          <ErrorState
            message={
              state.status === "expired"
                ? "Kode QRIS sudah kedaluwarsa (5 menit terlewati tanpa pembayaran)."
                : state.error ?? "Gagal membuat / menerima pembayaran QRIS."
            }
          />
          <PosButton variant="outline" onClick={onCreate} fullWidth>
            Buat Kode Baru
          </PosButton>
        </div>
      )}
    </div>
  );
}

export { CheckCircle2, Loader2 };