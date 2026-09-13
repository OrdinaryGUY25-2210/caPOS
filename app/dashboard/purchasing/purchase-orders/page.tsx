"use client";

import { PurchaseOrderDashboard } from "@/components/purchasing/PurchaseOrderDashboard";

export default function PurchaseOrdersPage() {
  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Purchase Order & Penerimaan Barang</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Buat PO ke pemasok, lalu catat penerimaan barang (GRN) — stok cabang & HPP (rata-rata
        tertimbang) ter-update otomatis.
      </p>
      <PurchaseOrderDashboard />
    </div>
  );
}
