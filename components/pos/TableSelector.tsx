"use client";

import { Hash } from "lucide-react";
import { cx } from "@/lib/utils";

const QUICK_TABLES = ["1", "2", "3", "4", "5", "6", "7", "8"];

export default function TableSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isQuick = QUICK_TABLES.includes(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
        <Hash size={12} /> Nomor Meja
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_TABLES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(value === t ? "" : t)}
            className={cx(
              "w-9 h-9 rounded-lg border text-xs font-semibold transition-colors touch-manipulation",
              value === t
                ? "bg-primary text-white border-primary"
                : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            )}
            aria-pressed={value === t}
          >
            {t}
          </button>
        ))}
        <input
          value={isQuick ? "" : value}
          onChange={(e) => onChange(e.target.value.slice(0, 6))}
          placeholder="Lain"
          aria-label="Nomor meja lainnya"
          className="w-16 h-9 rounded-lg border border-neutral-200 px-2 text-xs text-center focus:border-primary outline-none"
        />
      </div>
    </div>
  );
}