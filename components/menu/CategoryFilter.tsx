"use client";

import { cx } from "@/lib/utils";

/**
 * Menu Management §6 — "Filter" dari checklist (filter by kategori) —
 * sebelumnya juga belum ada; seluruh menu selalu ditampilkan sekaligus.
 */
export default function CategoryFilter({
  categories,
  active,
  onChange,
}: {
  categories: string[];
  active: string | null;
  onChange: (category: string | null) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      <button
        onClick={() => onChange(null)}
        className={cx(
          "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border shrink-0",
          active === null ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"
        )}
      >
        Semua
      </button>
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border shrink-0",
            active === c ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
