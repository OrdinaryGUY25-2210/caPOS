"use client";

import { Sparkles, X } from "lucide-react";
import { useDemoMode } from "@/lib/demoMode";

/**
 * Banner yang tampil di halaman Dashboard (dan POS) selama tenant belum
 * punya transaksi: menjelaskan bahwa isi halaman adalah data contoh dan akan
 * hilang otomatis setelah aktivitas pertama.
 *
 * Tombol tutup sekarang MENYIMPAN pilihan pengguna (localStorage), bukan
 * sekadar menyembunyikan banner sampai reload. Sebelumnya banner bisa
 * "tutup", tetapi guard mode contoh tetap aktif dan menolak transaksi
 * pertama — itu akar masalah tenant baru yang tidak bisa berjualan.
 */
export default function DemoBanner() {
  const { isDemo, dismiss } = useDemoMode();
  if (!isDemo) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
      <Sparkles size={18} className="mt-0.5 shrink-0 text-amber-500" />
      <p className="flex-1 text-sm leading-relaxed">
        <span className="font-semibold">Ini data contoh.</span> Tampilan di
        halaman ini hanya ilustrasi agar Anda membayangkan aplikasi saat sudah
        terisi. Begitu Anda mulai beraktivitas (transaksi pertama), semua data
        contoh akan hilang otomatis. Anda tetap bisa langsung berjualan.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup banner contoh"
        title="Sembunyikan dan jangan tampilkan lagi"
        className="shrink-0 rounded-lg p-1 hover:bg-amber-100 text-amber-600"
      >
        <X size={16} />
      </button>
    </div>
  );
}
