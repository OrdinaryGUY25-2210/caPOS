"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Modal standar untuk seluruh app. Dibuat supaya bug "tombol Simpan/Batal
 * tidak kelihatan di HP" tidak terulang di form lain — sebelumnya tiap
 * halaman (menu, kasir, member, kode akses) menulis ulang div modal-nya
 * sendiri dengan `max-w-sm p-6` tanpa batas tinggi, jadi begitu isi form
 * lebih tinggi dari layar (umum terjadi di HP), tombol paling bawah
 * ter-dorong ke luar viewport dan tidak bisa di-scroll untuk dijangkau.
 *
 * Perbaikannya:
 *  - Panel dibatasi `max-h-[92vh]` dengan `flex flex-col`.
 *  - Header (judul + tombol X) dan footer (tombol aksi) dibuat `shrink-0`
 *    supaya selalu terlihat.
 *  - Hanya body-nya yang `overflow-y-auto` — jadi kalau formnya panjang,
 *    yang di-scroll adalah isinya, bukan seluruh modal.
 *  - Di HP (di bawah breakpoint `sm`), modal muncul sebagai bottom-sheet
 *    (nempel di bawah, rounded cuma di atas) yang lebih natural untuk
 *    layar sentuh dan lebih mudah dijangkau ibu jari, dibanding kotak
 *    mengambang di tengah layar.
 */
export default function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = "sm:max-w-sm",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className={`bg-white w-full ${maxWidth} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-neutral-200 shrink-0">
          <h3 className="font-bold text-lg text-neutral-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-full p-1.5 -m-1.5 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1 min-h-0">{children}</div>

        {footer && <div className="p-4 sm:p-5 border-t border-neutral-200 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
