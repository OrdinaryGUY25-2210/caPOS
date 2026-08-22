"use client";

import { useEffect, useState } from "react";
import { RotateCw, X } from "lucide-react";

/**
 * Bukan pemblokir — ini cuma saran ringan. Chart/tabel laporan tetap bisa
 * dibaca di portrait (sudah dibuat scroll & responsive), tapi pengalamannya
 * jelas lebih lega di landscape untuk layar yang sangat sempit. Jadi kalau
 * ada yang tidak mau memutar HP-nya, dia tetap bisa memakai app seperti
 * biasa — notifikasi ini cukup ditutup sekali per sesi (tidak akan muncul
 * lagi sampai halaman di-refresh).
 */
export default function LandscapeNotice() {
  const [isNarrowPortrait, setIsNarrowPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function check() {
      setIsNarrowPortrait(window.innerWidth < 768 && window.innerHeight > window.innerWidth);
    }
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  if (!isNarrowPortrait || dismissed) return null;

  return (
    <div className="bg-neutral-900 text-white text-xs px-4 py-2 flex items-center justify-between gap-3 shrink-0">
      <span className="flex items-center gap-2">
        <RotateCw size={14} className="shrink-0" />
        Putar layar ke landscape untuk tampilan laporan yang lebih nyaman.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Tutup notifikasi"
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
