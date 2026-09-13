"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, Repeat, Wallet, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { formatRupiah } from "@/lib/utils";
import type { GrowthSummary, CustomerVisitStats } from "@/lib/types";

/**
 * Proyeksi Tren & Retensi Pelanggan — Repeat Visit Rate, Customer Lifetime
 * Value (LTV), dan daftar pelanggan tidak aktif >30 hari (kandidat kirim
 * voucher lewat WhatsApp) sesuai spesifikasi Phase 4.
 */
export default function GrowthAnalyticsPage() {
  const [summary, setSummary] = useState<GrowthSummary | null>(null);
  const [inactive, setInactive] = useState<CustomerVisitStats[]>([]);
  const [topCustomers, setTopCustomers] = useState<CustomerVisitStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) return;

    const supabase = createClient();
    const [{ data: growth }, { data: inactiveCustomers }, { data: top }] = await Promise.all([
      supabase.rpc("growth_summary", { p_tenant_id: profile.tenant_id }),
      supabase
        .from("inactive_customers")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .order("days_since_last_visit", { ascending: false })
        .limit(20),
      supabase
        .from("customer_visit_stats")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .order("lifetime_value", { ascending: false })
        .limit(10),
    ]);

    setSummary((growth as GrowthSummary[])?.[0] ?? null);
    setInactive((inactiveCustomers as CustomerVisitStats[]) ?? []);
    setTopCustomers((top as CustomerVisitStats[]) ?? []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-neutral-300" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-neutral-900">Analitik Pertumbuhan Pelanggan</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6">
        Repeat Visit Rate, Customer Lifetime Value, dan deteksi pelanggan tidak aktif — berbasis data Membership.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard icon={Users} label="Total Pelanggan" value={String(summary?.total_customers ?? 0)} />
        <StatCard icon={Repeat} label="Repeat Visit Rate" value={`${summary?.repeat_visit_rate ?? 0}%`} tone="primary" />
        <StatCard icon={Wallet} label="Rata-rata LTV" value={formatRupiah(summary?.avg_ltv ?? 0)} />
        <StatCard icon={AlertTriangle} label="Tidak Aktif >30 Hari" value={String(summary?.inactive_customers_count ?? 0)} tone="urgent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-bold text-neutral-900 mb-3 text-sm">Pelanggan Bernilai Tertinggi (LTV)</h2>
          <div className="card divide-y divide-neutral-100">
            {topCustomers.length === 0 && <p className="p-4 text-xs text-neutral-400 text-center">Belum ada data.</p>}
            {topCustomers.map((c) => (
              <div key={c.member_id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-neutral-900">{c.customer_name}</p>
                  <p className="text-xs text-neutral-400">{c.visit_count}x kunjungan</p>
                </div>
                <p className="font-bold text-primary text-sm">{formatRupiah(c.lifetime_value)}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-bold text-neutral-900 mb-3 text-sm">
            Pelanggan Tidak Aktif <span className="text-neutral-400 font-normal">— kandidat voucher comeback</span>
          </h2>
          <div className="card divide-y divide-neutral-100">
            {inactive.length === 0 && <p className="p-4 text-xs text-neutral-400 text-center">Semua pelanggan aktif. 🎉</p>}
            {inactive.map((c) => (
              <div key={c.member_id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-neutral-900">{c.customer_name}</p>
                  <p className="text-xs text-urgent">{c.days_since_last_visit} hari tidak berkunjung</p>
                </div>
                <a
                  href={`https://wa.me/${c.customer_phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                    `Halo ${c.customer_name}, kami rindu kedatangan Anda! Ada promo spesial menanti 🎉`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium bg-primary text-white rounded-lg px-3 py-1.5"
                >
                  Kirim Voucher
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "primary" | "urgent" }) {
  return (
    <div className="card p-4">
      <Icon size={16} className={tone === "primary" ? "text-primary" : tone === "urgent" ? "text-urgent" : "text-neutral-400"} />
      <p className="text-xs text-neutral-500 mt-2">{label}</p>
      <p className="text-lg font-bold text-neutral-900 mt-0.5">{value}</p>
    </div>
  );
}
