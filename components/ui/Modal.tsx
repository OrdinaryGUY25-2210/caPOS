"use client";

import React, { useEffect } from "react";
import { cx } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  footer?: React.ReactNode;
}

// Lebar modal DIKUNCI ke 3 opsi saja — lihat Priority 4 audit note
// "modal tidak terlalu besar". Jangan lempar w-[...] custom per page.
const sizeStyles: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export function Modal({ open, onClose, title, children, size = "md", footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        className={cx(
          "w-full rounded-xl bg-white shadow-[var(--shadow-modal)] max-h-[90vh] flex flex-col",
          sizeStyles[size]
        )}
      >
        {title && (
          <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0">
            <h2 id="modal-title" className="text-base font-semibold text-neutral-900">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Tutup"
              className="text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md p-1"
            >
              ✕
            </button>
          </div>
        )}
        <div className="px-6 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
