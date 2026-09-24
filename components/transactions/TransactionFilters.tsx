"use client";

import { Search, CalendarRange } from "lucide-react";

const PAYMENT_OPTIONS = [
  { value: "", label: "Semua Pembayaran" },
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "debit", label: "Kartu Debit" },
  { value: "credit", label: "Kartu Kredit" },
  { value: "ewallet", label: "E-Wallet" },
  { value: "bank_transfer", label: "Transfer Bank" },
];

const ORDER_TYPE_OPTIONS = [
  { value: "", label: "Semua Tipe" },
  { value: "dine_in", label: "Dine-in" },
  { value: "takeaway", label: "Takeaway" },
  { value: "delivery", label: "Delivery" },
];

/**
 * Transactions §10 — "Search", "Filter date", "Payment filter", "Order
 * type" — sebelumnya /dashboard/transactions tidak punya satu pun filter
 * ini, cuma daftar mentah terbaru-ke-lama.
 */
export default function TransactionFilters({
  search,
  onSearchChange,
  dateStart,
  dateEnd,
  onDateStartChange,
  onDateEndChange,
  paymentMethod,
  onPaymentMethodChange,
  orderType,
  onOrderTypeChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  dateStart: string;
  dateEnd: string;
  onDateStartChange: (v: string) => void;
  onDateEndChange: (v: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;
  orderType: string;
  onOrderTypeChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Cari no. invoice atau nama pelanggan..."
          className="input-field pl-9"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <CalendarRange size={15} className="text-neutral-400 shrink-0" />
        <input type="date" value={dateStart} max={dateEnd || undefined} onChange={(e) => onDateStartChange(e.target.value)} className="input-field w-auto py-1.5" />
        <span className="text-neutral-400 text-sm">s/d</span>
        <input type="date" value={dateEnd} min={dateStart || undefined} onChange={(e) => onDateEndChange(e.target.value)} className="input-field w-auto py-1.5" />
      </div>
      <select value={paymentMethod} onChange={(e) => onPaymentMethodChange(e.target.value)} className="input-field w-auto">
        {PAYMENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select value={orderType} onChange={(e) => onOrderTypeChange(e.target.value)} className="input-field w-auto">
        {ORDER_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
