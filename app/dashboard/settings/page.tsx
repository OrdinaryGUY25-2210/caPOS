"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  UserRound,
  MapPin,
  FileText,
  Printer,
  Coffee,
  CreditCard,
  QrCode,
  Star,
  Upload,
  Lock,
  Smartphone,
  ArrowRight,
} from "lucide-react";

/**
 * Settings Hub / Router Page
 * Location: app/dashboard/settings/page.tsx
 *
 * This page serves as the main entry point for settings,
 * displaying all available settings categories with navigation
 * to individual setting pages. No actual settings forms here—
 * this is purely navigation.
 */

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
    id: "profile",
    label: "Akun Saya",
    description: "Data akun pribadi, password, dan avatar",
    icon: UserRound,
    href: "/dashboard/settings/profile",
    section: "Informasi Bisnis",
  },
  {
    id: "branch",
    label: "Cabang & Lokasi",
    description: "Kelola beberapa lokasi bisnis",
    icon: MapPin,
    href: "/dashboard/settings/branch",
    section: "Konfigurasi",
  },
  {
    id: "receipt",
    label: "Format Struk",
    description: "Tata letak, footer, dan logo di struk",
    icon: FileText,
    href: "/dashboard/settings/receipt",
    section: "Konfigurasi",
  },
  {
    id: "printer",
    label: "Printer Thermal",
    description: "Lebar kertas (58mm/80mm) dan koneksi",
    icon: Printer,
    href: "/dashboard/settings/printer",
    section: "Konfigurasi",
  },
  {
    id: "menu",
    label: "Menu & Kategori",
    description: "Pengaturan tampilan dan kategori produk",
    icon: Coffee,
    href: "/dashboard/settings/menu",
    section: "Konfigurasi",
  },
  {
    id: "payment",
    label: "Metode Pembayaran",
    description: "Midtrans, QRIS, dan payment gateway lainnya",
    icon: CreditCard,
    href: "/dashboard/settings/payment",
    section: "Pembayaran",
  },
  {
    id: "qr",
    label: "QR Dinamis",
    description: "Konfigurasi QR meja dan QR order",
    icon: QrCode,
    href: "/dashboard/settings/qr",
    section: "Pembayaran",
  },
  {
    id: "subscription",
    label: "Paket & Berlangganan",
    description: "Paket saat ini, penggunaan, dan upgrade",
    icon: Star,
    href: "/dashboard/settings/subscription",
    section: "Berlangganan",
  },
  {
    id: "import",
    label: "Import Data",
    description: "Migrasi menu dari POS/aplikasi lain",
    icon: Upload,
    href: "/dashboard/settings/import",
    section: "Data",
  },
  {
    id: "security",
    label: "Keamanan",
    description: "2FA, sesi, dan hapus akun",
    icon: Lock,
    href: "/dashboard/settings/security",
    section: "Keamanan",
  },
  {
    id: "pwa",
    label: "Offline & PWA",
    description: "Mode offline dan instalasi aplikasi",
    icon: Smartphone,
    href: "/dashboard/settings/pwa",
    section: "Aplikasi",
  },
] as const;

/**
 * Group categories by section for better organization
 */
function groupBySection(
  categories: typeof SETTINGS_CATEGORIES
): Map<string, typeof SETTINGS_CATEGORIES> {
  const grouped = new Map<string, typeof SETTINGS_CATEGORIES>();
  for (const cat of categories) {
    const section = cat.section;
    if (!grouped.has(section)) {
      grouped.set(section, []);
    }
    grouped.get(section)!.push(cat);
  }
  return grouped;
}

/**
 * Settings Category Card Component
 */
function SettingsCategoryCard({
  label,
  description,
  icon: Icon,
  href,
}: {
  label: string;
  description: string;
  icon: React.ComponentType<{ size: number; className: string }>;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group card p-4 hover:shadow-md transition-all hover:bg-neutral-50 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={18} className="text-primary" />
            <h3 className="font-semibold text-neutral-900 text-sm">{label}</h3>
          </div>
          <p className="text-xs text-neutral-500">{description}</p>
        </div>
        <ArrowRight
          size={16}
          className="text-neutral-400 group-hover:text-primary transition-colors mt-1 flex-shrink-0"
        />
      </div>
    </Link>
  );
}

/**
 * Settings Section Component
 */
function SettingsSection({
  section,
  categories,
}: {
  section: string;
  categories: typeof SETTINGS_CATEGORIES;
}) {
  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-neutral-900 text-sm px-1">
        {section}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {categories.map((cat) => (
          <SettingsCategoryCard key={cat.id} {...cat} />
        ))}
      </div>
    </div>
  );
}

export default function SettingsHubPage() {
  const grouped = groupBySection(SETTINGS_CATEGORIES);
  const sections = Array.from(grouped.entries());

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Pengaturan</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Kelola konfigurasi bisnis, sistem, dan preferensi Anda
        </p>
      </div>

      {/* Settings Sections */}
      <div className="space-y-8">
        {sections.map(([sectionName, categories]) => (
          <SettingsSection
            key={sectionName}
            section={sectionName}
            categories={categories}
          />
        ))}
      </div>

      {/* Help Footer */}
      <div className="card p-4 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-xs text-blue-700">
          💡 <strong>Tip:</strong> Jika ada pertanyaan tentang pengaturan ini,
          cek FAQ atau hubungi support melalui menu Bantuan.
        </p>
      </div>
    </div>
  );
}
