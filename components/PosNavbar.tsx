"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Wifi, WifiOff, Clock, LayoutDashboard } from "lucide-react";
import Modal from "./Modal";
import QrOrderAlert from "./pos/QrOrderAlert";

export default function PosNavbar({
  cashierName,
  roleLabel,
  email,
  cafeName,
  branchName,
  branchId,
  shiftStartedAt,
  showDashboardLink,
  onLogout,
}: {
  cashierName: string;
  /** Label peran akun yang login — "Kasir" atau "Owner" — biar jelas siapa yang sedang jaga. */
  roleLabel?: string;
  /** Email akun yang login, ditampilkan di modal info akun (kalau ada). */
  email?: string | null;
  /** Nama kafe/tenant, ditampilkan di modal info akun (kalau ada). */
  cafeName?: string | null;
  /** Nama cabang tempat kasir ini bertugas (migration_011), kalau ada. */
  branchName?: string | null;
  /** BARU (Phase 4) — id cabang, dipakai QrOrderAlert untuk subscribe realtime pesanan QR/online masuk. */
  branchId?: string | null;
  /** Jam mulai shift saat ini (ISO string), kalau ada. */
  shiftStartedAt?: string | null;
  /** Phase 2A.2 §1 — hanya true untuk owner/manager: mereka datang dari
      Dashboard dan perlu jalan pulang tanpa logout. Cashier TIDAK dapat link
      ini — otorisasi rute /dashboard tetap sepenuhnya ditentukan middleware,
      tombol ini murni navigasi, bukan sumber izin. */
  showDashboardLink?: boolean;
  onLogout: () => void;
}) {
  const [isOnline, setIsOnline] = useState(true);
  const [now, setNow] = useState(new Date());
  // Modal info akun — dibuka dengan tap ikon profil di navbar kasir, supaya
  // kasir bisa cek cepat "ini akun/shift siapa" tanpa perlu buka Dashboard.
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(clock);
    };
  }, []);

  return (
    <header className="h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="caPOS" className="w-9 h-9 rounded-xl" />
        <span className="font-bold text-neutral-900 hidden sm:inline">caPOS</span>
        {isOnline ? (
          <span className="badge-active">
            <Wifi size={12} /> Online
          </span>
        ) : (
          <span className="badge-urgent">
            <WifiOff size={12} /> Offline
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {showDashboardLink && (
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-primary-dark hover:bg-neutral-100 rounded-lg px-2.5 py-1.5 -my-1.5 transition-colors"
            title="Kembali ke Dashboard"
          >
            <LayoutDashboard size={16} />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        )}
        <span className="text-sm font-mono text-neutral-500 hidden sm:inline">
          {now.toLocaleTimeString("id-ID")}
        </span>

        {shiftStartedAt && (
          <span className="hidden md:flex items-center gap-1 text-xs text-neutral-400" title="Shift dimulai">
            <Clock size={12} />
            Shift {new Date(shiftStartedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}

        {/* Akun yang sedang login — supaya jelas ini "shift siapa" saat
            dilihat sekilas, terutama kalau HP dipakai bergantian antar
            kasir dalam satu kafe. Ikon profil bisa di-tap untuk lihat
            info akun lebih lengkap. */}
        <button
          onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 rounded-full hover:bg-neutral-100 pr-1 -mr-1 transition-colors"
          title="Info Akun"
        >
          <div className="w-8 h-8 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-xs font-bold">
            {cashierName.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden md:flex flex-col leading-tight text-left">
            <span className="text-sm font-medium text-neutral-700">{cashierName}</span>
            {roleLabel && <span className="text-[10px] text-neutral-400 uppercase tracking-wide">{roleLabel}</span>}
          </div>
        </button>
        <button onClick={onLogout} aria-label="Logout" className="text-neutral-400 hover:text-urgent transition-colors" title="Logout">
          <LogOut size={18} />
        </button>
      </div>

      {showProfile && (
        <Modal title="Info Akun" onClose={() => setShowProfile(false)}>
          <div className="flex items-center gap-3 pb-1">
            <div className="w-12 h-12 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-base font-bold shrink-0">
              {cashierName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-neutral-900 truncate">{cashierName}</p>
              {roleLabel && <p className="text-xs text-neutral-400 uppercase tracking-wide">{roleLabel}</p>}
            </div>
          </div>

          <div className="space-y-2.5 text-sm border-t border-neutral-100 pt-3">
            {email && (
              <div className="flex justify-between gap-3">
                <span className="text-neutral-500">Email</span>
                <span className="font-medium text-neutral-900 text-right truncate">{email}</span>
              </div>
            )}
            {cafeName && (
              <div className="flex justify-between gap-3">
                <span className="text-neutral-500">Kafe</span>
                <span className="font-medium text-neutral-900 text-right truncate">{cafeName}</span>
              </div>
            )}
            {branchName && (
              <div className="flex justify-between gap-3">
                <span className="text-neutral-500">Cabang</span>
                <span className="font-medium text-neutral-900 text-right truncate">{branchName}</span>
              </div>
            )}
            {shiftStartedAt && (
              <div className="flex justify-between gap-3">
                <span className="text-neutral-500">Shift Dimulai</span>
                <span className="font-medium text-neutral-900">
                  {new Date(shiftStartedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-neutral-500">Status Koneksi</span>
              <span className={isOnline ? "font-medium text-primary-dark" : "font-medium text-urgent"}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Phase 4 — notifikasi pesanan baru dari QR Self-Order / Online Order Hub */}
      <QrOrderAlert branchId={branchId ?? null} />
    </header>
  );
}
