"use client";

import { useEffect, useState, Suspense } from "react";
import { Menu, Coffee } from "lucide-react";
import DashboardSidebar from "./DashboardSidebar";
import TrialBanner from "./TrialBanner";
import LandscapeNotice from "./LandscapeNotice";
import AccessDeniedNotice from "./AccessDeniedNotice";
import NotificationBell from "./NotificationBell";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner, ROLE_LABEL } from "@/lib/role";

/**
 * Layout dashboard yang responsif di semua ukuran layar:
 *  - Desktop (≥ md): sidebar statis di kiri + top bar tipis berisi
 *    lonceng notifikasi & profil akun di kanan.
 *  - Mobile (< md): sidebar disembunyikan default, hamburger di topbar.
 */
export default function DashboardShell({
  daysLeft,
  children,
}: {
  daysLeft: number;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("owner");
  const [showBell, setShowBell] = useState(false);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      setTenantId(profile.tenant_id);
      setName(profile.full_name || "");
      setRole(profile.role);
      // Bell cuma untuk Manager/Owner — kasir yang MENGAJUKAN, bukan yang
      // MENYETUJUI, jadi tidak perlu lihat lonceng ini (mereka tidak akses
      // dashboard sama sekali).
      setShowBell(isManagerOrOwner(profile.role));
    })();
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-neutral-50">
      <Suspense fallback={null}>
        <AccessDeniedNotice />
      </Suspense>

      <div className="hidden md:block border-r border-neutral-200">
        <DashboardSidebar />
      </div>

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
        {/* Top bar — tampil di SEMUA ukuran layar. Hamburger cuma muncul
            di mobile; lonceng + profil selalu di kanan. */}
        <div className="h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu navigasi"
              className="md:hidden text-neutral-600 hover:bg-neutral-100 p-1.5 -m-1.5 rounded-lg"
            >
              <Menu size={22} />
            </button>
            <div className="md:hidden flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
                <Coffee className="text-white" size={13} />
              </div>
              <span className="font-bold text-neutral-900 text-sm">caPOS</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {showBell && tenantId && <NotificationBell tenantId={tenantId} />}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-xs font-bold shrink-0">
                {(name || "?").slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden sm:flex flex-col leading-tight">
                <span className="text-sm font-medium text-neutral-700">{name}</span>
                <span className="text-[10px] text-neutral-400 uppercase tracking-wide">
                  {ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role}
                </span>
              </div>
            </div>
          </div>
        </div>

        <TrialBanner daysLeft={daysLeft} />
        <LandscapeNotice />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
