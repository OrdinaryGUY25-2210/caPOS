"use client";

import Link from "next/link";
import { Loader2, Printer, ArrowRightLeft, Combine, Split, CheckCircle2, ShoppingCart, ClipboardCheck } from "lucide-react";
import type { TableLiveStatus } from "@/lib/types";
import { formatRupiah } from "@/lib/utils";

/**
 * Table Management §4 — daftar aksi per status meja:
 *  - AVAILABLE   → "Open Table" (assign order baru, lewat POS)
 *  - RESERVED    → "Assign Order" (tandai reservasi datang / buka meja langsung)
 *  - OCCUPIED / BILL_PRINTED → Cetak Bill, Pindah, Gabung, Split Bill, ke Kasir untuk Bayar
 *  - CLEANING    → Tandai Selesai Dibersihkan
 *
 * Pembayaran non-split (single method) tetap lewat /pos supaya alur PIN
 * supervisor untuk void/diskon manual tetap satu jalur otorisasi — tombol
 * "Ke Kasir untuk Bayar" cuma jalan pintas ke sana.
 */
export default function TableActionMenu({
  table,
  busy,
  canMove,
  canMerge,
  onPrintBill,
  onMove,
  onMerge,
  onSplitBill,
  onFinishCleaning,
}: {
  table: TableLiveStatus;
  busy: boolean;
  canMove: boolean;
  canMerge: boolean;
  onPrintBill: () => void;
  onMove: () => void;
  onMerge: () => void;
  onSplitBill: () => void;
  onFinishCleaning: () => void;
}) {
  if (table.status === "AVAILABLE") {
    return (
      <div className="space-y-3">
        <div className="bg-neutral-50 rounded-lg px-3 py-2 text-sm text-neutral-500">Meja kosong — siap dipakai.</div>
        <Link href="/pos" className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          <ShoppingCart size={15} /> Buka Meja & Pesan (ke Kasir)
        </Link>
      </div>
    );
  }

  if (table.status === "CLEANING") {
    return (
      <div className="space-y-3">
        <div className="bg-neutral-50 rounded-lg px-3 py-2 text-sm text-neutral-500">Meja sedang dibersihkan setelah tamu selesai.</div>
        <button disabled={busy} onClick={onFinishCleaning} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} Tandai Selesai Dibersihkan
        </button>
      </div>
    );
  }

  if (table.status === "RESERVED") {
    return (
      <div className="space-y-3">
        <div className="bg-warning-light text-warning rounded-lg px-3 py-2 text-sm">Meja ini direservasi.</div>
        <Link href="/dashboard/reservations" className="btn-outline w-full flex items-center justify-center gap-2 text-sm">
          <ClipboardCheck size={15} /> Kelola Reservasi
        </Link>
        <Link href="/pos" className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          <ShoppingCart size={15} /> Tamu Sudah Datang — Buka Meja
        </Link>
      </div>
    );
  }

  // OCCUPIED / BILL_PRINTED
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2 text-sm">
        <span className="text-neutral-500">{table.active_order_number ?? "Order aktif"}</span>
        <span className="font-bold text-primary">{formatRupiah(table.active_order_total)}</span>
      </div>

      <button disabled={busy} onClick={onPrintBill} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
        {busy ? <Loader2 className="animate-spin" size={14} /> : <Printer size={14} />} Cetak Bill
      </button>
      <button disabled={busy} onClick={onSplitBill} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
        <Split size={14} /> Split Bill
      </button>
      <button disabled={busy || !canMove} onClick={onMove} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
        <ArrowRightLeft size={14} /> Pindah Meja
      </button>
      <button disabled={busy || !canMerge} onClick={onMerge} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
        <Combine size={14} /> Gabung ke Meja Lain
      </button>
      <Link href="/pos" className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
        <ShoppingCart size={15} /> Ke Kasir untuk Bayar
      </Link>
      <p className="text-xs text-neutral-400 text-center pt-1">
        Void item, batalkan pesanan & diskon manual dilakukan dari kasir (/pos) supaya PIN supervisor tercatat di sana.
      </p>
    </div>
  );
}
