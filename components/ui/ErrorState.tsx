import React from "react";
import { Button } from "./Button";

export interface ErrorStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ErrorState({
  title = "Terjadi kesalahan",
  message = "Gagal memuat data. Coba muat ulang halaman ini.",
  actionLabel = "Coba Lagi",
  onAction,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-urgent-light text-2xl text-urgent"
        aria-hidden="true"
      >
        ⚠️
      </div>
      <h3 className="text-base font-semibold text-neutral-900 mb-1">{title}</h3>
      <p className="text-sm text-neutral-500 max-w-sm mb-6">{message}</p>
      {onAction && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
