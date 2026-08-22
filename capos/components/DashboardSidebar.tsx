"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Coffee,
  Users,
  CreditCard,
  Settings,
  HelpCircle,
  Zap,
  LogOut,
} from "lucide-react";
import { cx } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Laporan & Omzet", icon: BarChart3 },
  { href: "/dashboard/menu", label: "Kelola Menu & Stok", icon: Coffee },
  { href: "/dashboard/cashiers", label: "Manajemen Kasir", icon: Users },
  { href: "/dashboard/membership", label: "Membership", icon: CreditCard },
  { href: "/dashboard/settings", label: "Pengaturan Kafe", icon: Settings },
  { href: "/dashboard/faq", label: "FAQ & Helpdesk", icon: HelpCircle },
  { href: "/dashboard/subscription", label: "Status Langganan", icon: Zap },
];

export default function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white border-r border-neutral-200 flex flex-col h-screen shrink-0">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-neutral-200">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Coffee className="text-white" size={16} />
        </div>
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
      </nav>

      <div className="p-3 border-t border-neutral-200">
        <Link
          href="/login"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-500 hover:bg-neutral-100"
        >
          <LogOut size={18} />
          Keluar
        </Link>
      </div>
    </aside>
  );
}
