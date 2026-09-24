import { cx } from "@/lib/utils";
import type { TableLiveStatusValue } from "@/lib/types";

export const STATUS_STYLE: Record<TableLiveStatusValue, string> = {
  AVAILABLE: "bg-primary-light text-primary border-primary/30",
  RESERVED: "bg-warning-light text-warning border-warning/30",
  OCCUPIED: "bg-urgent-light text-urgent border-urgent/30",
  BILL_PRINTED: "bg-blue-50 text-blue-600 border-blue-200",
  CLEANING: "bg-neutral-200 text-neutral-500 border-neutral-300",
};

export const STATUS_LABEL: Record<TableLiveStatusValue, string> = {
  AVAILABLE: "Tersedia",
  RESERVED: "Direservasi",
  OCCUPIED: "Terisi",
  BILL_PRINTED: "Bill Dicetak",
  CLEANING: "Dibersihkan",
};

/**
 * Table Management §4 — badge status meja, dipakai bareng oleh TableCard,
 * TableDetailModal, dan mana pun yang perlu menampilkan status meja secara
 * konsisten (warna & label sama persis di semua tempat).
 */
export default function TableStatusBadge({
  status,
  size = "sm",
}: {
  status: TableLiveStatusValue;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border font-semibold",
        STATUS_STYLE[status],
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
