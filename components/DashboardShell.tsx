"use client";

import { useState, Suspense } from "react";
import { Menu, Coffee } from "lucide-react";
import DashboardSidebar from "./DashboardSidebar";
import TrialBanner from "./TrialBanner";
import LandscapeNotice from "./LandscapeNotice";
import AccessDeniedNotice from "./AccessDeniedNotice";

/**
 * Layout dashboard yang responsif di semua ukuran layar:
 *  - Desktop (≥ md): sidebar statis di kiri, seperti sebelumnya.
 *  - Mobile (< md): sidebar disembunyikan secara default. Topbar kecil
 *    dengan tombol hamburger memicu sidebar muncul sebagai OVERLAY
 *    (mengambang di atas konten dengan backdrop gelap di belakangnya),
 *    bukan mendorong/menambah frame baru ke tata letak — jadi konten
 *    utama tidak pernah ikut menyempit atau ter-geser aneh.
 *  - Tap di area gelap (backdrop) atau pilih salah satu menu akan
 *    otomatis menutup drawer-nya.
 */
export default function DashboardShell({
  daysLeft,
  children,
}: {
  daysLeft: number;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="h-screen flex overflow-hidden bg-neutral-50">
      <Suspense fallback={null}>
        <AccessDeniedNotice />
      </Suspense>

      {/* Sidebar statis — hanya tampil di layar medium ke atas */}
      <div className="hidden md:block border-r border-neutral-200">
        <DashboardSidebar />
      </div>

      {/* Drawer overlay — hanya untuk layar kecil, dan hanya dirender saat dibuka */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            <DashboardSidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar mobile — cuma ikon hamburger, tidak ada nav lain di sini
            supaya tidak menambah frame baru; navigasi tetap satu tempat
            (drawer) untuk menghindari duplikasi & kebingungan. */}
        <div className="md:hidden h-14 bg-white border-b border-neutral-200 flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Buka menu navigasi"
            className="text-neutral-600 hover:bg-neutral-100 p-1.5 -m-1.5 rounded-lg"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <Coffee className="text-white" size={13} />
            </div>
            <span className="font-bold text-neutral-900 text-sm">caPOS</span>
          </div>
        </div>

        <TrialBanner daysLeft={daysLeft} />
        <LandscapeNotice />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
