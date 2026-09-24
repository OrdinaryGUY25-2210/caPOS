"use client";

import React, { useEffect, useState } from "react";
import { cx } from "@/lib/utils";

export interface ToastProps {
  message: string;
  variant?: "success" | "error" | "warning" | "info";
  duration?: number;
  onDismiss?: () => void;
}

const variantStyles: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "bg-primary text-white",
  error: "bg-urgent text-white",
  warning: "bg-warning text-white",
  info: "bg-neutral-900 text-white",
};

// Komponen presentasional saja — pemanggilan (queue/stack banyak toast
// sekaligus) sebaiknya dikelola oleh satu ToastProvider di layout,
// bukan di-mount berulang per halaman. Lihat catatan lanjutan di
// docs/AUDIT_LANJUTAN_PRIORITAS.md Priority 1.
export function Toast({ message, variant = "info", duration = 3000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={cx(
        "fixed bottom-4 right-4 z-[60] px-4 py-3 rounded-md shadow-[var(--shadow-popover)] text-sm font-medium",
        "animate-in fade-in slide-in-from-bottom-2",
        variantStyles[variant]
      )}
    >
      {message}
    </div>
  );
}
