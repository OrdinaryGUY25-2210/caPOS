"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Lock, MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/utils";
import { startBackgroundSyncListener } from "@/lib/offlineSync";

/**
 * Auto-Cutoff (Modul Subscription SaaS, requirement #1) — komponen BARU
 * dan terisolasi (tidak mengubah DashboardShell/PosNavbar yang sudah
 * stabil). Dipasang membungkus konten utama lewat app/dashboard/layout.tsx
 * dan app/pos/layout.tsx (file layout baru, lihat berkas itu).
 *
 * Ini lapis pertahanan PERTAMA (UX) — lapis KEDUA ada di database lewat
 * trigger enforce_subscription_cutoff() (migration_16 bagian F2) yang
 * tetap menolak INSERT ke tabel transactions apa pun jalurnya, bahkan
 * kalau overlay ini berhasil dilewati/di-bypass di client.
 *
 * /dashboard/subscription SENGAJA dikecualikan dari blokir supaya Owner
 * yang sudah expired tetap bisa membuka halaman itu untuk membayar.
 *
 * BUG FIX (sinkronisasi offline): komponen ini juga jadi tempat paling
 * pas untuk memasang startBackgroundSyncListener() SEKALI untuk seluruh
 * aplikasi — karena membungkus /pos MAUPUN /dashboard, sinkronisasi
 * transaksi kasir & perubahan menu yang tertunda tetap jalan otomatis
 * begitu koneksi kembali, di halaman mana pun pengguna berada saat itu.
 */
export default function SubscriptionCutoffGate({
  status,
  variant = "dashboard",
  children,
}: {
  status: string | null | undefined;
  /** "dashboard" = Owner/Manager (link ke halaman langganan). "pos" = Kasir (tidak punya akses ke halaman langganan, diarahkan hubungi Owner/Studio D13). */
  variant?: "dashboard" | "pos";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isSubscriptionPage = pathname?.startsWith("/dashboard/subscription");
  const isExpired = status === "expired";

  useEffect(() => startBackgroundSyncListener(), []);

  if (!isExpired || isSubscriptionPage) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none blur-sm opacity-40">
        {children}
      </div>
      <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-neutral-900/40 rounded-2xl">
        <div className="card max-w-sm w-full p-6 text-center space-y-3 bg-white">
          <div className="w-12 h-12 rounded-2xl bg-urgent-light flex items-center justify-center mx-auto">
            <Lock className="text-urgent" size={22} />
          </div>
          <h2 className="font-bold text-neutral-900">Langganan Sudah Kedaluwarsa</h2>
          <p className="text-sm text-neutral-500">
            {variant === "pos"
              ? "Akses kasir dibatasi sementara sampai langganan kafe ini diperpanjang. Hubungi Owner/Admin kafe untuk memperpanjang paket."
              : "Fitur ini dibatasi otomatis sampai paket langganan diperpanjang. Transaksi baru juga tidak bisa diproses sampai paket aktif kembali."}
          </p>
          {variant === "dashboard" ? (
            <Link href="/dashboard/subscription" className="btn-primary w-full inline-block">
              Perpanjang Sekarang
            </Link>
          ) : (
            <a
              href={whatsappLink("Halo, langganan caPOS kafe kami sudah kedaluwarsa dan saya butuh bantuan memperpanjang.")}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              <MessageCircle size={16} /> Hubungi Admin via WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
