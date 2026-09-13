"use client";

import { ProductProfitabilityAnalytics } from "@/components/analytics/AnalyticsComponents";

export default function ProfitabilityPage() {
  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Profitabilitas Produk</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Omzet, HPP, laba, dan margin per produk berdasarkan transaksi yang sudah tercatat.
      </p>
      <ProductProfitabilityAnalytics />
    </div>
  );
}
