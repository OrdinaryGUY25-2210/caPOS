"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
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
} from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
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
 * (managing cashier accounts) but had NO sidebar entry — it was only reachable
 * via a link buried in the FAQ page. It is restored here under "Cabang & Tim"
 * next to Employees/Attendance, since that's what it manages.
 *
 * Sections intentionally omitted (per "only expose modules that actually
 * exist"): a standalone "Finance" group (Expenses/Budgets/Cash Control/
 * Reconciliation) was suggested by the Phase 2A.2 brief's reference IA, but
 * no such pages exist in this repo yet. Not added — see
 * docs/PHASE_2A2_UI_UX_AUDIT.md.
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: any }[] }[] = [
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
      { href: "/dashboard/analytics/peak-hours", label: "Jam Sibuk", icon: BarChart3 },
      { href: "/dashboard/analytics/waste-loss", label: "Kerugian Barang", icon: Trash2 },
    ],
  },
  {
    label: "Cabang & Tim",
    items: [
      { href: "/dashboard/branches", label: "Manajemen Cabang", icon: Building2 },
      { href: "/dashboard/employees", label: "Manajemen Karyawan", icon: Users },
      { href: "/dashboard/cashiers", label: "Akun Kasir", icon: UserCog },
      { href: "/dashboard/cashier-evaluation", label: "Evaluasi Kasir", icon: ClipboardCheck },
      { href: "/dashboard/attendance", label: "Kehadiran Karyawan", icon: CalendarCheck },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { href: "/dashboard/settings", label: "Pengaturan Kafe", icon: Settings },
      { href: "/dashboard/subscription", label: "Status Langganan", icon: Zap },
      { href: "/dashboard/faq", label: "FAQ & Helpdesk", icon: HelpCircle },
    ],
  },
];

/**
 * `onNavigate` dipanggil setiap kali sebuah link diklik — dipakai oleh
 * DashboardShell untuk menutup drawer mobile begitu owner memilih menu,
 * supaya tidak perlu tap tombol tutup terpisah. Di desktop (sidebar statis)
 * prop ini tidak perlu diisi.
 */
export default function DashboardSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="w-72 sm:w-64 bg-white flex flex-col h-full shrink-0">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-neutral-200 shrink-0">
        <img src="/logo.png" alt="caPOS" className="w-8 h-8 rounded-lg" />
        <span className="font-bold text-neutral-900">caPOS</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {group.label}
            </p>
            <div className="space-y-1">
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
                        ? "bg-primary-light text-primary-dark"
                        : "text-neutral-600 hover:bg-neutral-100"
                    )}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="pt-3 mt-1 border-t border-neutral-100">
          <Link
            href="/pos"
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-primary-dark bg-primary-light/60 hover:bg-primary-light transition-colors"
          >
            <ShoppingCart size={18} />
            Buka Halaman Kasir (POS)
          </Link>
        </div>
      </nav>

      <div className="p-3 border-t border-neutral-200 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:bg-neutral-100"
        >
          <LogOut size={18} />
          Keluar
        </button>
      </div>
    </aside>
  );
}
