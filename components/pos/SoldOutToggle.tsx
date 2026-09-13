"use client";

import { Ban, RotateCcw, Loader2 } from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * Tombol quick-toggle "Sold Out / Menu 86" — dipakai di kartu produk POS
 * (app/pos/page.tsx) dan panel Kelola Ketersediaan Menu di KDS
 * (components/kitchen/MenuAvailabilityPanel.tsx). Sengaja dibuat sebagai
 * elemen <button> TERPISAH dari kartu produk (bukan bagian dari onClick
 * kartu) supaya tap "tandai habis" tidak ikut menambahkan produk ke
 * keranjang — pemanggil WAJIB memanggil e.stopPropagation() di
 * onClick-nya sendiri kalau tombol ini diletakkan di dalam elemen yang
 * juga punya onClick (lihat pemakaian di app/pos/page.tsx).
 */
export default function SoldOutToggle({
  isAvailable,
  saving,
  onToggle,
  size = "md",
  className,
}: {
  isAvailable: boolean;
  /** true selagi request update ke server berjalan — tombol nonaktif sementara supaya tidak double-tap. */
  saving?: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "sm" ? "w-6 h-6" : "w-8 h-8";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!saving) onToggle();
      }}
      disabled={saving}
      title={isAvailable ? "Tandai Habis (Sold Out)" : "Tandai Tersedia Lagi"}
      aria-label={isAvailable ? "Tandai Habis" : "Tandai Tersedia Lagi"}
      aria-pressed={!isAvailable}
      className={cx(
        dim,
        "rounded-full flex items-center justify-center shrink-0 shadow-sm transition-colors disabled:opacity-60",
        isAvailable
          ? "bg-white/90 text-neutral-500 hover:bg-urgent hover:text-white border border-neutral-200"
          : "bg-neutral-900 text-white hover:bg-neutral-700",
        className
      )}
    >
      {saving ? (
        <Loader2 className="animate-spin" size={iconSize} />
      ) : isAvailable ? (
        <Ban size={iconSize} />
      ) : (
        <RotateCcw size={iconSize} />
      )}
    </button>
  );
}
