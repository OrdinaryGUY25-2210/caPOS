"use client";

import { Clock, Users, CalendarClock } from "lucide-react";
import { cx, formatRupiah } from "@/lib/utils";
import type { TableLiveStatus } from "@/lib/types";
import TableStatusBadge, { STATUS_STYLE } from "./TableStatusBadge";

function elapsedMinutes(since: string | null) {
  if (!since) return null;
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}

/**
 * Table Management §4 — satu kartu meja. Dipakai di TableGrid (tampilan
 * list) maupun tampilan "Floor" (grid lebih besar, lihat page.tsx) — style
 * ukurannya diatur lewat prop `variant` supaya satu komponen dipakai di
 * kedua tempat (Output-nya cuma minta 1 TableCard.tsx, bukan 2 versi).
 */
export default function TableCard({
  table,
  onClick,
  variant = "compact",
}: {
  table: TableLiveStatus;
  onClick: () => void;
  variant?: "compact" | "floor";
}) {
  const mins =
    table.status === "OCCUPIED" || table.status === "BILL_PRINTED"
      ? elapsedMinutes(table.occupied_at)
      : table.status === "CLEANING"
      ? elapsedMinutes(table.cleaning_started_at)
      : null;

  const isFloor = variant === "floor";

  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-[1.03] hover:shadow-sm text-center relative",
        STATUS_STYLE[table.status],
        isFloor ? "aspect-square w-full p-3" : "min-w-[84px] px-3 py-2.5"
      )}
    >
      {table.upcoming_reservation_id && (
        <span
          title="Ada reservasi mendatang"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-warning text-white flex items-center justify-center shadow"
        >
          <CalendarClock size={11} />
        </span>
      )}

      <span className={cx("font-bold", isFloor ? "text-base" : "text-sm")}>Meja {table.table_number}</span>

      {isFloor ? (
        <TableStatusBadge status={table.status} />
      ) : (
        <span className="text-[10px] font-normal opacity-80">{table.status === "AVAILABLE" ? `Kapasitas ${table.capacity}` : null}</span>
      )}

      <span className="text-[10px] font-normal opacity-70 flex items-center gap-0.5">
        <Users size={9} /> {table.capacity}
      </span>

      {(table.status === "OCCUPIED" || table.status === "BILL_PRINTED") && (
        <span className="text-[10px] font-semibold opacity-90">{formatRupiah(table.active_order_total)}</span>
      )}

      {mins !== null && (
        <span className="text-[10px] font-normal opacity-80 flex items-center gap-0.5">
          <Clock size={9} /> {mins}mnt
        </span>
      )}
    </button>
  );
}
