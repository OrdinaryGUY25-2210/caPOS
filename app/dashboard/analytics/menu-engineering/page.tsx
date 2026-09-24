"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, Cell } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { formatRupiah } from "@/lib/utils";
import type { MenuEngineeringRow, MenuEngineeringClass } from "@/lib/types";
import { Skeleton, SkeletonBlock, SkeletonTableRows } from "@/components/Skeleton";
import PremiumFeatureLock from "@/components/PremiumFeatureLock";

const CLASS_COLOR: Record<MenuEngineeringClass, string> = {
  STAR: "#10B981",
  PLOWHORSE: "#F59E0B",
  PUZZLE: "#3B82F6",
  DOG: "#EF4444",
};

const CLASS_LABEL: Record<MenuEngineeringClass, string> = {
  STAR: "Stars",
  PLOWHORSE: "Plowhorses",
  PUZZLE: "Puzzles",
  DOG: "Dogs",
};

/**
 * Rekomendasi Menu Berbasis Data — Matriks Menu Engineering (Boston
 * Matrix): sumbu-X = volume penjualan, sumbu-Y = margin (profitabilitas).
 * Setiap menu diklasifikasikan relatif terhadap rata-rata menu tenant
 * yang sama (dihitung server-side lewat RPC menu_engineering_report()).
 */
export default function MenuEngineeringPage() {
  return (
    <PremiumFeatureLock featureName="Menu Terlaris (Menu Engineering)" minTier="pro">
      <MenuEngineeringContent />
    </PremiumFeatureLock>
  );
}

function MenuEngineeringContent() {
  const [rows, setRows] = useState<MenuEngineeringRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) return;
    const supabase = createClient();
    const { data } = await supabase.rpc("menu_engineering_report", { p_tenant_id: profile.tenant_id });
    setRows((data as MenuEngineeringRow[]) ?? []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-96" />
        </div>
        <div className="card p-4">
          <SkeletonBlock className="h-[360px] w-full" />
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <SkeletonTableRows rows={6} cols={5} />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const avgQty = rows[0]?.avg_qty_sold ?? 0;
  const avgMargin = rows[0]?.avg_margin_amount ?? 0;

  const chartData = rows.map((r) => ({ ...r, x: r.qty_sold, y: r.margin_amount }));

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-neutral-900">Menu Engineering Matrix</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6">
        Kuadran popularitas (volume terjual) vs profitabilitas (margin HPP) — dibandingkan rata-rata seluruh menu.
      </p>

      <div className="card p-4 mb-6">
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
            <XAxis type="number" dataKey="x" name="Qty Terjual" label={{ value: "Volume Penjualan →", position: "insideBottom", offset: -10, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="Margin" label={{ value: "Margin (Rp) →", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <ZAxis range={[80, 80]} />
            <ReferenceLine x={avgQty} stroke="#CBD5E1" strokeDasharray="4 4" />
            <ReferenceLine y={avgMargin} stroke="#CBD5E1" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0].payload as MenuEngineeringRow;
                return (
                  <div className="bg-white border border-neutral-200 rounded-lg p-2.5 text-xs shadow-lg">
                    <p className="font-bold text-neutral-900">{d.product_name}</p>
                    <p className="text-neutral-500">Terjual: {d.qty_sold}</p>
                    <p className="text-neutral-500">Margin: {formatRupiah(d.margin_amount)} ({d.margin_pct}%)</p>
                    <p className="font-semibold mt-1" style={{ color: CLASS_COLOR[d.classification] }}>
                      {CLASS_LABEL[d.classification]}
                    </p>
                  </div>
                );
              }}
            />
            <Scatter data={chartData}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={CLASS_COLOR[d.classification]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 justify-center mt-2">
          {(Object.keys(CLASS_LABEL) as MenuEngineeringClass[]).map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLASS_COLOR[c] }} />
              {CLASS_LABEL[c]}
            </span>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-400">
            Belum cukup data penjualan untuk menghitung matriks menu engineering.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Menu</th>
                <th className="text-right px-4 py-3 font-medium">Terjual</th>
                <th className="text-right px-4 py-3 font-medium">Margin</th>
                <th className="text-left px-4 py-3 font-medium">Klasifikasi</th>
                <th className="text-left px-4 py-3 font-medium">Rekomendasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{r.product_name}</td>
                  <td className="px-4 py-3 text-right text-neutral-600">{r.qty_sold}</td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {formatRupiah(r.margin_amount)} <span className="text-neutral-400">({r.margin_pct}%)</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: CLASS_COLOR[r.classification] + "20", color: CLASS_COLOR[r.classification] }}
                    >
                      {CLASS_LABEL[r.classification]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 max-w-xs">{r.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
