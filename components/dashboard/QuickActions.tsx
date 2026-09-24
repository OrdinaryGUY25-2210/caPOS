"use client";

import Link from "next/link";
import {
  PlusCircle,
  PackagePlus,
  ClipboardList,
  Truck,
  CalendarPlus,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Tailwind classes untuk warna ikon — beda warna per aksi supaya cepat dikenali di grid. */
  tone: string;
}

/**
 * Dashboard §9 (Owner Command Center) — baris "Quick Actions" yang selama
 * ini belum ada di /dashboard. Owner/manager sering butuh langsung lompat
 * ke satu dari 6 alur kerja ini tanpa muter lewat sidebar dulu.
 *
 * Semua rute di bawah sudah ada di codebase (bukan halaman baru) — ini
 * cuma jalan pintas ke masing-masing.
 */
const ACTIONS: QuickAction[] = [
  { label: "Order Baru", href: "/pos", icon: PlusCircle, tone: "bg-primary-light text-primary-dark" },
  { label: "Tambah Produk", href: "/dashboard/menu", icon: PackagePlus, tone: "bg-blue-50 text-blue-600" },
  { label: "Stock Opname", href: "/dashboard/stock-opname", icon: ClipboardList, tone: "bg-amber-50 text-amber-600" },
  { label: "Purchase Order", href: "/dashboard/purchasing", icon: Truck, tone: "bg-purple-50 text-purple-600" },
  { label: "Reservasi", href: "/dashboard/reservations", icon: CalendarPlus, tone: "bg-pink-50 text-pink-600" },
  { label: "Lihat Laporan", href: "/dashboard/analytics", icon: BarChart3, tone: "bg-neutral-100 text-neutral-700" },
];

export default function QuickActions() {
  return (
    <div className="card p-5">
      <p className="font-semibold text-neutral-900 mb-3">Aksi Cepat</p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ACTIONS.map(({ label, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-200 px-2 py-3 text-center hover:border-primary/40 hover:-translate-y-0.5 transition-all"
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone}`}>
              <Icon size={17} />
            </div>
            <span className="text-[11px] font-medium text-neutral-700 leading-tight">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
