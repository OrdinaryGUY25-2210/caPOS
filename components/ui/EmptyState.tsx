import React from "react";
import { Button } from "./Button";

export interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

// Dipakai untuk state "Empty" di seluruh halaman (Priority 3) —
// lihat docs/DESIGN_SYSTEM.md untuk contoh copy per modul.
export function EmptyState({
  title = "Belum ada data",
  description = "Data yang kamu cari belum tersedia di sini.",
  actionLabel,
  onAction,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl text-neutral-400"
        aria-hidden="true"
      >
        {icon ?? "📭"}
      </div>
      <h3 className="text-base font-semibold text-neutral-900 mb-1">{title}</h3>
      <p className="text-sm text-neutral-500 max-w-sm mb-6">{description}</p>
      {actionLabel && (
        <Button variant="primary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
