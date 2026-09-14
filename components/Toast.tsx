"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

/**
 * Phase 2A.3 §11 (Tier 1 infra) — pengganti `alert()` browser mentah, yang
 * sebelumnya dipakai di 21 file (`app/pos`, `app/kitchen`, `app/admin`,
 * dan 18 halaman `app/dashboard/*`) untuk pesan error/sukses. `alert()`
 * memblokir seluruh thread JS (termasuk render), tidak bisa distyle, dan
 * tidak konsisten sama sekali dengan look-and-feel caPOS.
 *
 * DESAIN: sengaja BUKAN React Context/Provider — supaya bisa dipanggil dari
 * mana saja (`toast.success(...)`, `toast.error(...)`, `toast.info(...)`)
 * tanpa perlu membungkus tiap root layout (`/pos`, `/dashboard`, `/kitchen`,
 * `/admin` masing-masing punya struktur berbeda) dengan Provider terpisah.
 * Cukup pub-sub sederhana + SATU `<ToastContainer />` yang dipasang sekali
 * di `app/layout.tsx` (root layout, membungkus SEMUA route).
 *
 * INI HANYA INFRASTRUKTUR. Migrasi 21 titik `alert()` yang sudah ada ke
 * `toast.*` BELUM dilakukan di sini — itu pekerjaan Tier 2 yang sengaja
 * dipisah (lihat docs/PHASE_2A2_REV01_COMPLETION_REPORT.md bagian
 * "Remaining risks" dan master prompt Phase 2A.3 di percakapan). Jangan
 * anggap alert() sudah hilang dari codebase hanya karena file ini ada.
 */

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l([...toasts]));
}

function push(message: string, variant: ToastVariant) {
  const id = nextId++;
  toasts = [...toasts, { id, message, variant }];
  emit();
  // Auto-dismiss — error diberi waktu lebih lama karena biasanya lebih
  // panjang dan lebih penting untuk benar-benar terbaca.
  const timeout = variant === "error" ? 6000 : 3500;
  setTimeout(() => dismiss(id), timeout);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (message: string) => push(message, "success"),
  error: (message: string) => push(message, "error"),
  info: (message: string) => push(message, "info"),
};

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: "bg-white border-primary/30 text-neutral-800" },
  error: { icon: XCircle, className: "bg-white border-urgent/30 text-neutral-800" },
  info: { icon: Info, className: "bg-white border-neutral-200 text-neutral-800" },
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  success: "text-primary",
  error: "text-urgent",
  info: "text-neutral-400",
};

/** Dipasang SEKALI di app/layout.tsx — jangan dipasang ulang di halaman lain. */
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 sm:w-96 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const { icon: Icon, className } = VARIANT_STYLE[t.variant];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border shadow-lg p-3.5 text-sm ${className}`}
          >
            <Icon size={18} className={`shrink-0 mt-0.5 ${VARIANT_ICON_COLOR[t.variant]}`} />
            <p className="flex-1 leading-snug">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Tutup notifikasi"
              className="shrink-0 text-neutral-300 hover:text-neutral-600 -m-1 p-1 rounded-full hover:bg-neutral-100 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
