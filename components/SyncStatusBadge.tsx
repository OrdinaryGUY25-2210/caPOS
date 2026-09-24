"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { getSyncStatus, subscribeSyncStatus, triggerSync, type SyncStatus } from "@/lib/offlineSync";

/**
 * Item #26 (PWA & Offline) — badge status koneksi + sinkronisasi tunggal,
 * dipakai di PosNavbar (kasir) dan DashboardShell (owner/manager) supaya
 * kondisinya konsisten di kedua area aplikasi.
 *
 * 5 state sesuai spesifikasi:
 *   🟢 Online        — terkoneksi, tidak ada antrian, tidak sedang sinkron.
 *   🟠 Syncing        — sedang mengirim transaksi/perubahan menu tertunda.
 *   🔵 Offline        — tidak ada koneksi (queue tetap ditampilkan kalau ada).
 *   ✓  Synced         — sinkron barusan berhasil (tampil sebentar lalu balik ke Online).
 *   ⚠  Sync Failed    — percobaan sinkron terakhir gagal → recovery UI (tombol "Coba Lagi").
 *
 * Tidak menyentuh Dexie/skema — murni membaca lib/offlineSync.ts yang sudah
 * menghitung antrian dari tabel yang sudah ada.
 */
export default function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const [isOnline, setIsOnline] = useState(true);
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [showSynced, setShowSynced] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  // "✓ Synced" tampil sekitar 4 detik setiap kali sinkron baru saja sukses,
  // lalu badge balik jadi "🟢 Online" biasa — bukan status permanen.
  useEffect(() => {
    if (status.state !== "success" || !status.lastSyncedAt) return;
    setShowSynced(true);
    const t = setTimeout(() => setShowSynced(false), 4000);
    return () => clearTimeout(t);
  }, [status.state, status.lastSyncedAt]);

  const hasQueue = status.pendingCount > 0;

  let label = "Online";
  let colorClasses = "bg-primary-light text-primary-dark";
  let Icon: typeof Wifi = Wifi;

  if (!isOnline) {
    label = "Offline";
    colorClasses = "bg-blue-50 text-blue-600";
    Icon = WifiOff;
  } else if (status.state === "syncing") {
    label = "Syncing";
    colorClasses = "bg-warning-light text-warning";
    Icon = RefreshCw;
  } else if (status.state === "error") {
    label = "Sync Failed";
    colorClasses = "bg-urgent-light text-urgent";
    Icon = AlertTriangle;
  } else if (showSynced) {
    label = "Synced";
    colorClasses = "bg-primary-light text-primary-dark";
    Icon = Check;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-full text-xs font-medium px-2.5 py-1 transition-colors ${colorClasses}`}
        title="Status koneksi & sinkronisasi"
      >
        <Icon size={12} className={status.state === "syncing" ? "animate-spin" : ""} />
        {!compact && <span>{label}</span>}
        {hasQueue && (
          <span
            className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-white/70 text-[10px] font-semibold"
            title={`${status.pendingCount} item menunggu disinkron`}
          >
            {status.pendingCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop tipis untuk menutup dropdown saat tap di luar — konsisten dengan pola Modal/dropdown lain di app ini. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 z-50 card p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-900">Status Sinkronisasi</span>
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${isOnline ? "text-primary-dark" : "text-blue-600"}`}>
                <Icon size={12} className={status.state === "syncing" ? "animate-spin" : ""} />
                {label}
              </span>
            </div>

            {hasQueue && (
              <p className="text-xs text-neutral-500">
                {status.pendingCount} item (transaksi/menu) masih menunggu dikirim ke server
                {!isOnline ? " — akan otomatis dicoba begitu koneksi kembali." : "."}
              </p>
            )}

            {status.state === "error" && (
              <div className="rounded-xl bg-urgent-light/60 border border-urgent/20 p-2.5 space-y-2">
                <p className="text-xs text-urgent">
                  {status.lastError ?? "Sinkronisasi terakhir gagal."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    triggerSync();
                  }}
                  className="btn-danger w-full text-xs py-1.5 inline-flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={12} /> Coba Lagi
                </button>
              </div>
            )}

            {!hasQueue && status.state !== "error" && (
              <p className="text-xs text-neutral-400">Semua data sudah tersinkron.</p>
            )}

            {status.lastSyncedAt && (
              <p className="text-[11px] text-neutral-400">
                Sinkron terakhir: {new Date(status.lastSyncedAt).toLocaleTimeString("id-ID")}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
