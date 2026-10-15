"use client";

import { useEffect, useState } from "react";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { PeakHoursAnalytics } from "@/components/analytics/AnalyticsComponents";

export default function PeakHoursPage() {
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
      <h1 className="text-xl font-bold text-neutral-900 mb-1">Jam Sibuk (Peak Hours)</h1>
      {isDemo && <DemoBadge />}
      <p className="text-sm text-neutral-500 mb-6">
        Heatmap transaksi per jam (30 hari terakhir) — dipakai untuk perencanaan shift & stok.
      </p>
      <PeakHoursAnalytics />
    </div>
  );
}
