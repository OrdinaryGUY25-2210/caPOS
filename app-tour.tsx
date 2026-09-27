"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { createClient } from "@/lib/supabase/client";

interface Step {
  /** Cocok dengan atribut data-tour="..." di elemen targetnya (lihat
   *  DashboardSidebar.tsx). Sengaja bukan `id` — sidebar dirender DUA KALI
   *  di DOM (instance desktop selalu ada + instance drawer mobile saat
   *  dibuka), jadi `id` yang sama dua kali akan invalid HTML dan
   *  document.getElementById() bisa mengambil instance yang lagi
   *  disembunyikan (ukurannya 0x0). data-tour + querySelectorAll yang
   *  memilih instance yang benar-benar terlihat menghindari itu. */
  target: string;
  title: string;
  description: string;
}

const TOUR_STEPS: Step[] = [
  {
    target: "dashboard-nav",
    title: "Navigasi Utama",
    description: "Gunakan menu samping ini untuk berpindah antara Laporan, Menu & Stok, dan modul lainnya.",
  },
  {
    target: "pos-quick-access",
    title: "Akses Kasir / POS",
    description: "Klik di sini kapan pun untuk langsung membuka halaman transaksi kasir.",
  },
  {
    target: "settings-nav",
    title: "Pengaturan Kafe",
    description: "Atur profil bisnis, printer struk, metode pembayaran, dan lainnya di sini.",
  },
];

const PADDING = 8;

function getVisibleTarget(name: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of candidates) {
    // offsetParent === null berarti elemen (atau leluhurnya) diberi
    // display:none — ini yang menyaring instance sidebar mobile yang
    // sedang disembunyikan lewat class "hidden md:block".
    if (el.offsetParent !== null) return el;
  }
  return null;
}

export default function AppTour({
  onRequestDrawerOpen,
  onRequestDrawerClose,
}: {
  /** Buka drawer sidebar mobile supaya target step ini kelihatan. Aman
   *  dipanggil di desktop juga (no-op secara visual — lihat DashboardShell). */
  onRequestDrawerOpen?: () => void;
  onRequestDrawerClose?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const userIdRef = useRef<string | null>(null);

  // 1) Cek status tur dari `profiles.onboarding_tour_completed_at`
  // (migration_019) — bukan localStorage lagi, supaya konsisten kalau
  // akun yang sama login di perangkat lain.
  useEffect(() => {
    (async () => {
      const { profile, userId } = await getCurrentProfile();
      if (!profile || !userId) return;
      userIdRef.current = userId;
      if (!profile.onboarding_tour_completed_at) {
        setCurrentStep(0);
      }
    })();
  }, []);

  // 2) Cari & lacak posisi elemen target tiap kali step berganti, dan
  // hitung ulang saat resize/scroll/layout berubah supaya spotlight tidak
  // pernah "meleset" dari elemen aslinya.
  const measure = useCallback(() => {
    if (currentStep === null) return;
    onRequestDrawerOpen?.();
    // Beri waktu 1 frame untuk drawer mobile selesai mount sebelum diukur.
    requestAnimationFrame(() => {
      const step = TOUR_STEPS[currentStep];
      const el = getVisibleTarget(step.target);
      if (!el) {
        setRect(null);
        setReady(true);
        return;
      }
      // Target bisa berada di bagian sidebar yang sedang di-scroll keluar
      // dari area terlihat (nav-nya sendiri scroll — grup menu cukup
      // banyak sampai "Buka Kasir (POS)" & "Pengaturan Kafe" di baris
      // paling bawah tidak otomatis kelihatan). Scroll dulu ke tengah,
      // baru ukur rect-nya di frame berikutnya setelah posisi settle.
      el.scrollIntoView({ block: "center", behavior: "auto" });
      requestAnimationFrame(() => {
        setRect(el.getBoundingClientRect());
        setReady(true);
      });
    });
  }, [currentStep, onRequestDrawerOpen]);

  useEffect(() => {
    setReady(false);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [measure]);

  async function persistCompleted() {
    onRequestDrawerClose?.();
    if (userIdRef.current) {
      await createClient()
        .from("profiles")
        .update({ onboarding_tour_completed_at: new Date().toISOString() })
        .eq("id", userIdRef.current);
    }
  }

  async function handleFinish() {
    setCurrentStep(null);
    await persistCompleted();
  }

  function handleNext() {
    if (currentStep === null) return;
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  }

  function handleBack() {
    if (currentStep !== null && currentStep > 0) setCurrentStep(currentStep - 1);
  }

  if (currentStep === null) return null;

  const step = TOUR_STEPS[currentStep];
  const hasSpotlight = ready && rect !== null;

  // Posisi kartu: tepat di bawah target kalau muat, kalau tidak di
  // atasnya; dijepit horizontal supaya tidak keluar layar di HP.
  let cardStyle: React.CSSProperties = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(340, vw - 32);
    // Perkiraan tinggi kartu (judul + deskripsi 2 baris + tombol) — cukup
    // untuk keputusan atas/bawah; posisi akhir tetap dijepit ke viewport
    // di bawah, jadi meleset beberapa px pun tidak bikin kartu kepotong.
    const cardHeight = 190;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    let top: number;
    if (spaceBelow >= cardHeight + 16) {
      // Muat di bawah target.
      top = rect.bottom + PADDING + 8;
    } else if (spaceAbove >= cardHeight + 16) {
      // Tidak muat di bawah, tapi muat di atas target (mis. target di
      // dekat dasar layar).
      top = rect.top - PADDING - 8 - cardHeight;
    } else {
      // Target lebih tinggi dari viewport (mis. seluruh sidebar yang
      // scroll sendiri) — rect.bottom-nya sendiri bisa di luar layar,
      // jadi JANGAN diposisikan relatif ke situ. Taruh dekat bagian atas
      // target yang kelihatan, lalu dijepit ke viewport di bawah.
      top = rect.top + 16;
    }
    top = Math.max(16, Math.min(top, vh - cardHeight - 16));
    const left = Math.min(Math.max(16, rect.left), vw - cardWidth - 16);
    cardStyle = { top, left, width: cardWidth };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Tur pengenalan aplikasi">
      {hasSpotlight && rect ? (
        <>
          {/* 4 panel gelap membentuk "bingkai" di sekitar target — sisa
              area target sendiri tetap terang & tidak tertutup apa pun. */}
          <div className="absolute inset-x-0 top-0 bg-black/60" style={{ height: Math.max(0, rect.top - PADDING) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/60" style={{ top: rect.bottom + PADDING }} />
          <div
            className="absolute bg-black/60"
            style={{ top: rect.top - PADDING, height: rect.height + PADDING * 2, left: 0, width: Math.max(0, rect.left - PADDING) }}
          />
          <div
            className="absolute bg-black/60"
            style={{ top: rect.top - PADDING, height: rect.height + PADDING * 2, left: rect.right + PADDING, right: 0 }}
          />
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: rect.top - PADDING,
              left: rect.left - PADDING,
              width: rect.width + PADDING * 2,
              height: rect.height + PADDING * 2,
              boxShadow: "0 0 0 2px #10b981, 0 0 0 6px rgba(16,185,129,0.25)",
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        className="fixed bg-white rounded-xl p-5 shadow-2xl border border-neutral-200 space-y-3"
        style={cardStyle}
      >
        <div className="flex items-center gap-1.5">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === currentStep ? "w-6 bg-primary" : "w-1.5 bg-neutral-200"}`}
            />
          ))}
        </div>
        <h3 className="font-bold text-neutral-900">{step.title}</h3>
        <p className="text-sm text-neutral-600 leading-relaxed">{step.description}</p>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleFinish}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-1 py-1"
          >
            Lewati tur
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="btn-outline px-3 py-1.5 text-sm"
              >
                Kembali
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="btn-primary px-4 py-1.5 text-sm"
            >
              {currentStep < TOUR_STEPS.length - 1 ? "Lanjut" : "Selesai"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
