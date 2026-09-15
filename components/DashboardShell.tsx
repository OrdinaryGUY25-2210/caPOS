"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, User, CreditCard, Building2, Settings, Zap, LogOut, ChevronDown, type LucideIcon } from "lucide-react";
import DashboardSidebar from "./DashboardSidebar";
import TrialBanner from "./TrialBanner";
import LandscapeNotice from "./LandscapeNotice";
import AccessDeniedNotice from "./AccessDeniedNotice";
import NotificationBell from "./NotificationBell";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner, ROLE_LABEL } from "@/lib/role";
import { getTier, TIER_LABEL } from "@/lib/tier";
import { createClient } from "@/lib/supabase/client";
import { BranchProvider } from "@/lib/branchContext";
import BranchSwitcher from "./BranchSwitcher";

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
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string>("owner");
  const [tierLabel, setTierLabel] = useState<string | null>(null);
  const [showBell, setShowBell] = useState(false);

  // Profil kanan-atas — Phase 2A.2 §3: sekarang berupa dropdown, bukan
  // sekadar tampilan statis nama+role.
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      setTenantId(profile.tenant_id);
      setName(profile.full_name || "");
      setEmail(profile.email);
      setRole(profile.role);
      // Bell cuma untuk Manager/Owner — kasir yang MENGAJUKAN, bukan yang
      // MENYETUJUI, jadi tidak perlu lihat lonceng ini (mereka tidak akses
      // dashboard sama sekali).
      setShowBell(isManagerOrOwner(profile.role));

      if (profile.role === "super_admin") {
        setTierLabel(TIER_LABEL.supreme);
        return;
      }
      const { data: sub } = await createClient()
        .from("subscriptions")
        .select("status, plan")
        .eq("tenant_id", profile.tenant_id)
        .single();
      setTierLabel(TIER_LABEL[getTier(sub)]);
    })();
  }, []);

  // Tutup dropdown saat klik di luar area, atau saat Escape ditekan —
  // dua-duanya diperlukan supaya dropdown "berperilaku wajar" (§3) dan
  // aksesibel lewat keyboard (§13).
  useEffect(() => {
    if (!profileOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileOpen]);

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <BranchProvider>
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
              <img src="/logo.png" alt="caPOS" className="w-6 h-6 rounded-md" />
              <span className="font-bold text-neutral-900 text-sm">caPOS</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Filter/pilihan cabang — hanya render sesuatu untuk Owner
                yang punya lebih dari 1 cabang (lihat BranchSwitcher). */}
            <BranchSwitcher />
            {showBell && tenantId && <NotificationBell tenantId={tenantId} />}

            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                className="flex items-center gap-2 rounded-xl px-1.5 py-1 -mx-1.5 hover:bg-neutral-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-xs font-bold shrink-0">
                  {(name || "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="hidden sm:flex flex-col leading-tight">
                  <span className="text-sm font-medium text-neutral-700">{name}</span>
                  <span className="text-[10px] text-neutral-400 uppercase tracking-wide">
                    {ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role}
                  </span>
                </div>
                <ChevronDown size={14} className="text-neutral-400 hidden sm:block" />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] card py-2 z-50"
                >
                  <div className="px-4 py-2 border-b border-neutral-100">
                    <p className="font-semibold text-neutral-900 truncate">{name || "—"}</p>
                    <p className="text-xs text-neutral-400 uppercase tracking-wide">
                      {ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role}
                    </p>
                  </div>

                  <div className="py-1">
                    <ProfileMenuItem icon={User} label="Informasi Akun" onClick={() => setProfileOpen(false)}>
                      {email && <span className="block text-xs text-neutral-400 truncate mt-0.5">{email}</span>}
                    </ProfileMenuItem>
                    <ProfileMenuLink
                      icon={Zap}
                      label="Paket Saat Ini"
                      href="/dashboard/subscription"
                      badge={tierLabel ?? undefined}
                      onClick={() => setProfileOpen(false)}
                    />
                    <ProfileMenuLink
                      icon={Building2}
                      label="Cabang / Workspace"
                      href="/dashboard/branches"
                      onClick={() => setProfileOpen(false)}
                    />
                    <ProfileMenuLink
                      icon={Settings}
                      label="Pengaturan"
                      href="/dashboard/settings"
                      onClick={() => setProfileOpen(false)}
                    />
                    <ProfileMenuLink
                      icon={CreditCard}
                      label="Langganan"
                      href="/dashboard/subscription"
                      onClick={() => setProfileOpen(false)}
                    />
                  </div>

                  <div className="pt-1 border-t border-neutral-100">
                    <button
                      role="menuitem"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-urgent hover:bg-urgent-light transition-colors"
                    >
                      <LogOut size={16} />
                      Keluar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <TrialBanner daysLeft={daysLeft} />
        <LandscapeNotice />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
    </BranchProvider>
  );
}

/** Baris info statis di dropdown profil (bukan navigasi) — dipakai untuk "Informasi Akun". */
function ProfileMenuItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="px-4 py-2 text-sm text-neutral-700">
      <span className="flex items-center gap-2.5 font-medium">
        <Icon size={16} />
        {label}
      </span>
      {children}
    </div>
  );
}

/** Baris navigasi di dropdown profil — link biasa (`<a>`) supaya otomatis
    fokus/keyboard-accessible tanpa handler tambahan (§13). */
function ProfileMenuLink({
  icon: Icon,
  label,
  href,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onClick}
      className="flex items-center justify-between gap-2.5 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
    >
      <span className="flex items-center gap-2.5">
        <Icon size={16} />
        {label}
      </span>
      {badge && <span className="badge-active">{badge}</span>}
    </Link>
  );
}
