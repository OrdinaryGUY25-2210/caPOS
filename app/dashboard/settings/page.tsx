"use client";

import React from "react";
import Link from "next/link";
import { 
  Building2, 
  Store, 
  CreditCard, 
  Printer, 
  Receipt, 
  ShieldCheck, 
  Crown, 
  Users, 
  Globe, 
  HardDrive, 
  Bell, 
  HelpCircle 
} from "lucide-react";

// Array definisi kategori pengaturan
const SETTINGS_CATEGORIES = [
  {
    id: "business",
    label: "Business Profile",
    description: "Nama bisnis, logo, dan informasi kontak",
    icon: Building2,
    href: "/dashboard/settings/business",
    section: "Informasi Bisnis",
  },
  {
    id: "branch",
    label: "Pengaturan Cabang",
    description: "Kelola outlet, alamat, dan jam operasional",
    icon: Store,
    href: "/dashboard/settings/branch",
    section: "Informasi Bisnis",
  },
  {
    id: "payment",
    label: "Metode Pembayaran",
    description: "QRIS, EDC, Tunai, dan e-Wallet",
    icon: CreditCard,
    href: "/dashboard/settings/payment",
    section: "Transaksi & Hardware",
  },
  {
    id: "hardware",
    label: "Printer & Hardware",
    description: "Koneksi printer Bluetooth/USB dan kasir",
    icon: Printer,
    href: "/dashboard/settings/hardware",
    section: "Transaksi & Hardware",
  },
  {
    id: "receipt",
    label: "Desain Struk",
    description: "Header, footer, dan tampilan cetak struk",
    icon: Receipt,
    href: "/dashboard/settings/receipt",
    section: "Transaksi & Hardware",
  },
  {
    id: "security",
    label: "Keamanan & PIN",
    description: "PIN Otorisasi kasir dan hak akses",
    icon: ShieldCheck,
    href: "/dashboard/settings/security",
    section: "Sistem & Akses",
  },
  {
    id: "subscription",
    label: "Langganan Paket",
    description: "Paket caPOS dan riwayat pembayaran",
    icon: Crown,
    href: "/dashboard/settings/subscription",
    section: "Sistem & Akses",
  },
] as const;

export default function SettingsPage() {
  // FIX TYPESCRIPT BUILD ERROR:
  // Tentukan type eksplisit untuk Map agar TypeScript tidak menganggap [] sebagai empty tuple readonly []
  const grouped = new Map<string, typeof SETTINGS_CATEGORIES[number][]>();

  for (const cat of SETTINGS_CATEGORIES) {
    const section = cat.section;
    if (!grouped.has(section)) {
      grouped.set(section, []);
    }
    grouped.get(section)!.push(cat);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Pengaturan Sistem
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Kelola konfigurasi toko, periferal kasir, dan akun caPOS kamu.
        </p>
      </div>

      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([sectionName, items]) => (
          <div key={sectionName} className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              {sectionName}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md flex items-start gap-4 group"
                  >
                    <div className="p-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 group-hover:bg-blue-50 group-hover:text-blue-600 dark:group-hover:bg-blue-950/50 dark:group-hover:text-blue-400 transition-colors">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {item.label}
                      </h3>
                      <p className="text-xs text-zinc-500 line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
