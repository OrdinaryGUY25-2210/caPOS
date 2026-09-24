"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import Modal from "@/components/Modal";
import Receipt, { type ReceiptData } from "./Receipt";
import { printReceipt } from "@/lib/receipt";

/**
 * Modal siap-pakai untuk pratinjau + cetak struk, dengan pilihan lebar
 * kertas 58mm/80mm langsung di tempat (item 11 — printer thermal umumnya
 * dua ukuran ini). Dipakai di POS (setelah checkout), Open Bill, dan
 * riwayat transaksi supaya UX cetak struk konsisten di seluruh app.
 *
 * `data.width` dipakai sebagai default awal; user tetap bisa ganti ukuran
 * sebelum cetak tanpa perlu menutup modal.
 */
export default function ReceiptPreviewModal({
  data,
  title = "Struk",
  onClose,
  footerExtra,
  children,
}: {
  data: ReceiptData | null;
  title?: string;
  onClose: () => void;
  /** Tombol/aksi tambahan di footer, mis. "Transaksi Baru". */
  footerExtra?: React.ReactNode;
  /** Konten opsional di atas pratinjau struk, mis. banner "Pembayaran diterima". */
  children?: React.ReactNode;
}) {
  const [width, setWidth] = useState<"58mm" | "80mm">(data?.width ?? "80mm");

  if (!data) return null;
  const previewData: ReceiptData = { ...data, width };

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidth="sm:max-w-md"
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-1 rounded-xl bg-neutral-100 p-1 text-xs font-medium">
            {(["58mm", "80mm"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                className={
                  "flex-1 rounded-lg py-1.5 transition-colors " +
                  (width === w ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500")
                }
                aria-pressed={width === w}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => printReceipt(width)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <Printer size={16} />
            Cetak Struk
          </button>
          {footerExtra}
        </div>
      }
    >
      <div className="space-y-4">
        {children}
        <div className="rounded-2xl bg-neutral-100 p-3 flex justify-center overflow-x-auto">
          <Receipt data={previewData} />
        </div>
      </div>
    </Modal>
  );
}
