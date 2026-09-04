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
} from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Laporan & Omzet", icon: BarChart3 },
  { href: "/dashboard/laporan-pdf", label: "Laporan PDF Otomatis", icon: FileText },
  { href: "/dashboard/target", label: "Target Bulanan", icon: Target },
  { href: "/dashboard/transactions", label: "Riwayat Transaksi", icon: Receipt },
  { href: "/dashboard/menu", label: "Kelola Menu & Stok", icon: Coffee },
  { href: "/dashboard/stock", label: "Stok & HPP", icon: PackageSearch },
  { href: "/dashboard/stock-opname", label: "Stok Opname", icon: ClipboardList },
  { href: "/dashboard/branches", label: "Manajemen Cabang", icon: Building2 },
  { href: "/dashboard/employees", label: "Manajemen Karyawan", icon: Users },
  { href: "/dashboard/cashier-evaluation", label: "Evaluasi Kasir", icon: ClipboardCheck },
  { href: "/dashboard/attendance", label: "Kehadiran Karyawan", icon: CalendarCheck },
  { href: "/dashboard/membership", label: "Membership", icon: CreditCard },
  { href: "/dashboard/referral", label: "Program Referral", icon: Gift },
  { href: "/dashboard/settings", label: "Pengaturan Kafe", icon: Settings },
  { href: "/dashboard/faq", label: "FAQ & Helpdesk", icon: HelpCircle },
  { href: "/dashboard/subscription", label: "Status Langganan", icon: Zap },
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

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
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

        <div className="pt-3 mt-3 border-t border-neutral-100">
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
