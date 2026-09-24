import React from "react";
import { cx } from "@/lib/utils";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function pageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "...")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] as number) > 1) out.push("...");
    out.push(p);
  });
  return out;
}

const navBtn =
  "h-9 min-w-9 px-2 rounded-md text-sm font-medium transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
  "disabled:opacity-40 disabled:pointer-events-none";

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={cx(navBtn, "border border-neutral-300 text-neutral-600 hover:bg-neutral-50")}
      >
        Prev
      </button>

      {pageWindow(currentPage, totalPages).map((p, i) =>
        p === "..." ? (
          <span key={`dots-${i}`} className="px-1 text-neutral-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            aria-current={currentPage === p ? "page" : undefined}
            className={cx(
              navBtn,
              currentPage === p
                ? "bg-primary text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            )}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={cx(navBtn, "border border-neutral-300 text-neutral-600 hover:bg-neutral-50")}
      >
        Next
      </button>
    </nav>
  );
}
