"use client";

import { cx } from "@/lib/utils";
import type { KitchenStation } from "@/lib/types";

export default function KitchenStatusFilter({
  stations,
  activeStationCode,
  onStationChange,
  counts,
}: {
  stations: KitchenStation[];
  activeStationCode: string; // "all" | station.code
  onStationChange: (code: string) => void;
  counts: { total: number; new: number; preparing: number; ready: number };
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-3 bg-white border-b border-neutral-200 shrink-0">
      <button
        onClick={() => onStationChange("all")}
        aria-pressed={activeStationCode === "all"}
        className={cx(
          "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap shrink-0 transition-colors touch-manipulation",
          activeStationCode === "all"
            ? "bg-primary text-white"
            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
        )}
      >
        Semua Stasiun
        {counts.total > 0 && <span className="ml-2 text-xs opacity-80">{counts.total}</span>}
      </button>
      {stations.map((s) => (
        <button
          key={s.id}
          onClick={() => onStationChange(s.code)}
          aria-pressed={activeStationCode === s.code}
          className={cx(
            "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap shrink-0 transition-colors touch-manipulation",
            activeStationCode === s.code
              ? "bg-primary text-white"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          )}
        >
          {s.name}
        </button>
      ))}

      {/* Ringkasan status — glance-able, tidak butuh scroll kolom. */}
      <div className="ml-auto flex items-center gap-3 pl-3 border-l border-neutral-200 shrink-0">
        <Summary label="Baru" value={counts.new} tone="blue" />
        <Summary label="Siapkan" value={counts.preparing} tone="amber" />
        <Summary label="Siap" value={counts.ready} tone="emerald" />
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "emerald" }) {
  const colors = {
    blue: "text-blue-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
  }[tone];
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={cx("font-mono font-bold tabular-nums", colors)}>{value}</span>
      <span className="text-neutral-500">{label}</span>
    </div>
  );
}