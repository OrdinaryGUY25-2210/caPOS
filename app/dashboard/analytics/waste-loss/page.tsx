"use client";

import { WasteLossReport } from "@/components/analytics/AnalyticsComponents";

export default function WasteLossPage() {
  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Kerugian Barang (Waste/Loss)</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Catat & pantau barang yang expired, rusak, atau hilang.
      </p>
      <WasteLossReport />
    </div>
  );
}
