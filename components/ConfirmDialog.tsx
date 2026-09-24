"use client";

import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import { toast } from "./Toast";

/**
 * Item #28 (Error & Safety Layer) — pengganti `window.confirm()` +
 * `alert()` mentah yang sebelumnya dipakai untuk destructive action
 * (Delete, Void, Refund, Cancel, Merge, Move, Close, Logout, dst).
 *
 * Polanya SELALU 3 tahap sesuai spesifikasi:
 *   1. Confirmation — tampil begitu komponen ini dirender (bukan browser
 *      dialog bawaan, jadi bisa distyle & tidak memblokir thread JS).
 *   2. Processing  — tombol konfirmasi berubah jadi spinner + disabled,
 *      tombol Batal & tombol X juga dimatikan supaya tidak ada aksi ganda
 *      (double-submit) selagi request masih berjalan.
 *   3. Success/Error — sukses: dialog otomatis tertutup + `toast.success`
 *      (pesan dikustomisasi lewat parameter `successMessage`, atau caller
 *      bisa panggil toast sendiri di dalam `onConfirm` untuk pesan
 *      dinamis). Gagal: dialog TETAP TERBUKA, pesan error tampil inline
 *      di dalam dialog (bukan alert()), dan pengguna bisa coba lagi tanpa
 *      mengulang dari awal (recovery UI).
 *
 * `onConfirm` boleh melempar Error (atau reject) untuk menandai gagal —
 * pesan `error.message`-nya yang akan ditampilkan.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = "Ya, Lanjutkan",
  cancelLabel = "Batal",
  /** false = aksi netral (mis. Logout) → tombol konfirmasi warna primary, bukan merah. */
  danger = true,
  successMessage,
  onConfirm,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Kalau diisi, toast sukses otomatis ditampilkan setelah onConfirm() berhasil. Kosongkan kalau onConfirm sudah menampilkan toast-nya sendiri (pesan dinamis). */
  successMessage?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setProcessing(true);
    try {
      await onConfirm();
      if (successMessage) toast.success(successMessage);
      setProcessing(false);
      onClose();
    } catch (e) {
      setProcessing(false);
      setError(e instanceof Error ? e.message : "Terjadi kesalahan. Silakan coba lagi.");
    }
  }

  return (
    <Modal
      title={title}
      onClose={() => !processing && onClose()}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="btn-outline flex-1 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={processing}
            className={`flex-1 rounded-xl font-semibold flex items-center justify-center gap-2 py-2.5 px-4 transition-colors disabled:opacity-60 ${
              danger ? "bg-urgent hover:bg-red-600 text-white" : "bg-primary hover:bg-primary-dark text-white"
            }`}
          >
            {processing && <Loader2 className="animate-spin" size={16} />}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-3">
        {danger && (
          <div className="w-9 h-9 rounded-full bg-urgent-light flex items-center justify-center shrink-0">
            <AlertTriangle className="text-urgent" size={18} />
          </div>
        )}
        <div className="text-sm text-neutral-600">{description}</div>
      </div>

      {error && (
        <div className="rounded-xl bg-urgent-light/60 border border-urgent/20 p-2.5 text-xs text-urgent">
          {error}
        </div>
      )}
    </Modal>
  );
}
