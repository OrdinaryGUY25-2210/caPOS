"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  Receipt,
  Coffee,
  Users,
  CreditCard,
  Settings,
  HelpCircle,
  Zap,
  LogOut,
  ShoppingCart,
  CalendarCheck,
  Gift,
  FileText,
  PackageSearch,
  Target,
  ClipboardCheck,
  Building2,
  ClipboardList,
  QrCode,
  CalendarClock,
  Bike,
  Percent,
  TrendingUp,
  Grid3x3,
  Truck,
  ShoppingBag,
  UserRound,
  Tag,
  LineChart,
  Trash2,
  Wheat,
  Layers,
  SlidersHorizontal,
  ChefHat,
  UploadCloud,
  Lock,
} from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, type Tier } from "@/lib/tier";
import { UserCog } from "lucide-react";

/**
 * Phase 2A.2 — Information Architecture audit.
 *
 * Previously this was a single flat 32-item list with no grouping, which made
 * the sidebar hard to scan and hid how modules relate to each other. Every
 * href below still maps 1:1 to an existing route under app/dashboard (cross
 * checked against the filesystem) — no page was renamed, moved, or removed.
 *
 * One gap found during the audit: /dashboard/cashiers existed as a real page
 * but had NO sidebar entry — it was only reachable via a link buried in the
 * FAQ page. It is restored here under "Cabang & Tim" next to Employees/
 * Attendance, since that's what it monitors.
 *
 * migration_16 update: /dashboard/cashiers no longer manages accounts (that
 * would duplicate /dashboard/employees, the single source of truth for all
 * roles). It is now view-only — active cashier shift monitoring.
 *
 * Sections intentionally omitted (per "only expose modules that actually
 * exist"): a standalone "Finance" group (Expenses/Budgets/Cash Control/
 * Reconciliation) was suggested by the Phase 2A.2 brief's reference IA, but
 * no such pages exist in this repo yet. Not added — see
 * docs/PHASE_2A2_UI_UX_AUDIT.md.
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: any; premiumOnly?: true }[] }[] = [
  {
    label: "Ringkasan",
    items: [
      { href: "/dashboard", label: "Laporan & Omzet", icon: BarChart3 },
      { href: "/dashboard/laporan-pdf", label: "Laporan PDF Otomatis", icon: FileText },
      { href: "/dashboard/target", label: "Target Bulanan", icon: Target },
      { href: "/dashboard/transactions", label: "Riwayat Transaksi", icon: Receipt },
    ],
  },
  {
    label: "Katalog Produk",
    items: [
      { href: "/dashboard/menu", label: "Kelola Menu & Stok", icon: Coffee },
      { href: "/dashboard/variants", label: "Varian Produk", icon: Layers },
      { href: "/dashboard/modifiers", label: "Modifier", icon: SlidersHorizontal },
      { href: "/dashboard/recipes", label: "Resep & HPP", icon: ChefHat },
      { href: "/dashboard/ingredients", label: "Bahan Baku", icon: Wheat },
    ],
  },
  {
    label: "Inventori",
    items: [
      { href: "/dashboard/stock", label: "Stok & HPP", icon: PackageSearch },
      { href: "/dashboard/stock-opname", label: "Stok Opname", icon: ClipboardList },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { href: "/dashboard/purchasing/suppliers", label: "Pemasok", icon: Truck },
      { href: "/dashboard/purchasing/purchase-orders", label: "Purchase Order", icon: ShoppingBag },
    ],
  },
  {
    label: "Operasional & Channel",
    items: [
      { href: "/dashboard/qr-tables", label: "QR Meja & Self-Order", icon: QrCode },
      { href: "/dashboard/reservations", label: "Reservasi Meja", icon: CalendarClock },
      { href: "/dashboard/online-orders", label: "Online Order Hub", icon: Bike },
      { href: "/dashboard/channel-pricing", label: "Harga per Kanal", icon: Percent },
    ],
  },
  {
    label: "Pelanggan",
    items: [
      { href: "/dashboard/crm/customers", label: "Pelanggan", icon: UserRound },
      { href: "/dashboard/promotions", label: "Promosi & Voucher", icon: Tag },
      { href: "/dashboard/membership", label: "Membership", icon: CreditCard },
      { href: "/dashboard/referral", label: "Program Referral", icon: Gift },
    ],
  },
  {
    label: "Analitik",
    items: [
      { href: "/dashboard/analytics/growth", label: "Analitik Pertumbuhan", icon: TrendingUp },
      { href: "/dashboard/analytics/menu-engineering", label: "Menu Engineering", icon: Grid3x3 },
      { href: "/dashboard/analytics/profitability", label: "Profitabilitas Produk", icon: LineChart },
      { href: "/dashboard/analytics/peak-hours", label: "Jam Sibuk", icon: BarChart3, premiumOnly: true },
      { href: "/dashboard/analytics/waste-loss", label: "Kerugian Barang", icon: Trash2 },
    ],
  },
  {
    label: "Cabang & Tim",
    items: [
      { href: "/dashboard/branches", label: "Manajemen Cabang", icon: Building2 },
      { href: "/dashboard/employees", label: "Manajemen Karyawan", icon: Users },
      { href: "/dashboard/cashiers", label: "Monitoring Kasir", icon: UserCog },
      { href: "/dashboard/cashier-evaluation", label: "Evaluasi Kasir", icon: ClipboardCheck },
      { href: "/dashboard/attendance", label: "Kehadiran Karyawan", icon: CalendarCheck },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { href: "/dashboard/settings", label: "Pengaturan Kafe", icon: Settings },
      { href: "/dashboard/settings/import", label: "Import / Migrasi Data", icon: UploadCloud },
      { href: "/dashboard/subscription", label: "Status Langganan", icon: Zap },
      { href: "/dashboard/faq", label: "FAQ & Helpdesk", icon: HelpCircle },
    ],
  },
];

const STORAGE_KEY = "capos:sidebar-collapsed-groups";

/**
 * `onNavigate` dipanggil setiap kali sebuah link diklik — dipakai oleh
 * DashboardShell untuk menutup drawer mobile begitu owner memilih menu,
 * supaya tidak perlu tap tombol tutup terpisah. Di desktop (sidebar statis)
 * prop ini tidak perlu diisi.
 *
 * Phase 2A.2 §2/§4 — sidebar sekarang punya identitas visual gelap terpisah
 * dari area konten dashboard (putih), dan tiap grup bisa di-collapse.
 * Grup yang berisi rute aktif SELALU otomatis terbuka (computed dari
 * pathname, bukan hanya state awal), jadi tidak mungkin halaman yang
 * sedang dibuka jadi tersembunyi di grup yang collapsed.
 */
export default function DashboardSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const activeGroupLabel = NAV_GROUPS.find((g) =>
    g.items.some((item) => pathname === item.href)
  )?.label;

  // Menyimpan grup yang MANUAL ditutup user (bukan yang terbuka) — supaya
  // "grup aktif selalu terbuka" tidak pernah bisa dikalahkan oleh state lama
  // yang tersimpan dari kunjungan sebelumnya.
  const [manuallyClosed, setManuallyClosed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  // §7 — Sisi sidebar dari perbaikan `PremiumFeatureLock`: item nav yang
  // ditandai `premiumOnly` dapat ikon gembok kalau tenant belum Supreme.
  // Ini murni indikator visual (§7 "locked features" harus terlihat) —
  // penegakan sebenarnya tetap di halaman tujuan lewat PremiumFeatureLock,
  // bukan di sini, supaya tidak ada dua sumber kebenaran untuk otorisasi.
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      if (profile.role === "super_admin") {
        setTier("supreme");
        return;
      }
      const { data: sub } = await createClient()
        .from("subscriptions")
        .select("status, plan")
        .eq("tenant_id", profile.tenant_id)
        .single();
      setTier(getTier(sub));
    })();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setManuallyClosed(new Set(JSON.parse(raw)));
    } catch {
      // localStorage tidak tersedia (mode privat dll) — lanjut dengan semua grup terbuka.
    }
    setHydrated(true);
  }, []);

  function toggleGroup(label: string) {
    setManuallyClosed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Persist bersifat opsional — gagal simpan tidak boleh mengganggu toggle itu sendiri.
      }
      return next;
    });
  }

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-72 sm:w-64 bg-sidebar flex flex-col h-full shrink-0">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border shrink-0">
        <img src="/logo.png" alt="caPOS" className="w-8 h-8 rounded-lg" />
        <span className="font-bold text-sidebar-text-active">caPOS</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_GROUPS.map((group) => {
          // Sebelum hydrate dari localStorage, anggap semua terbuka supaya tidak
          // ada "flash" grup tertutup lalu tiba-tiba terbuka.
          const isOpen = group.label === activeGroupLabel || !hydrated || !manuallyClosed.has(group.label);
          return (
            <div key={group.label} className="pb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-group-label hover:text-sidebar-text transition-colors"
              >
                {group.label}
                <ChevronDown
                  size={13}
                  className={cx("transition-transform duration-150", isOpen ? "rotate-0" : "-rotate-90")}
                />
              </button>
              {isOpen && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                          active
                            ? "bg-primary/15 text-primary-light border border-primary/20"
                            : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active"
                        )}
                      >
                        <Icon size={18} className={active ? "text-primary" : undefined} />
                        <span className="flex-1">{item.label}</span>
                        {item.premiumOnly && tier !== null && tier !== "supreme" && (
                          <Lock size={12} className="text-sidebar-group-label shrink-0" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="pt-3 mt-2 border-t border-sidebar-border">
          <Link
            href="/pos"
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
          >
            <ShoppingCart size={18} />
            Buka Halaman Kasir (POS)
          </Link>
        </div>
      </nav>

      <div className="p-3 border-t border-sidebar-border shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active"
        >
          <LogOut size={18} />
          Keluar
        </button>
      </div>
    </aside>
  );
}
