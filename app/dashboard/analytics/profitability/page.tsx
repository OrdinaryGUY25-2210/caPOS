"use client";

import { useEffect, useState } from "react";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { ProductProfitabilityAnalytics } from "@/components/analytics/AnalyticsComponents";

export default function ProfitabilityPage() {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let active = true;
    tenantHasNoActivity().then((noActivity) => {
      if (active) setIsDemo(noActivity);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Profitabilitas Produk</h1>
      {isDemo && <DemoBadge />}
      <p className="text-sm text-neutral-500 mb-6">
        Omzet, HPP, laba, dan margin per produk berdasarkan transaksi yang sudah tercatat.
      </p>
      <ProductProfitabilityAnalytics />
    </div>
  );
}
