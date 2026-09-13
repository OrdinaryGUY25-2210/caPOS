"use client";

import { SupplierManagement } from "@/components/purchasing/SupplierManagement";

export default function SuppliersPage() {
  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Pemasok (Supplier)</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Kelola daftar pemasok bahan baku — data ini dipakai saat membuat Purchase Order.
      </p>
      <SupplierManagement />
    </div>
  );
}
