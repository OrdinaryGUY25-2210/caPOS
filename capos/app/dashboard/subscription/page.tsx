"use client";

import { Zap, CheckCircle2 } from "lucide-react";
import { whatsappLink, daysRemaining } from "@/lib/utils";

// Demo trial end date — in production, pull from subscriptions.trial_ends_at
const DEMO_TRIAL_END = "2026-08-23T00:00:00Z";

const PLANS = [
  { name: "Bulanan", price: "Rp99.000", period: "/bulan", features: ["1 Outlet", "Unlimited Transaksi", "Laporan Dasar"] },
  { name: "Tahunan", price: "Rp999.000", period: "/tahun", features: ["1 Outlet", "Unlimited Transaksi", "Laporan Lengkap", "Prioritas Support"], highlight: true },
];

export default function SubscriptionPage() {
  const daysLeft = daysRemaining(DEMO_TRIAL_END);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Status Langganan</h1>
        <p className="text-sm text-neutral-500">Kelola masa aktif akun caPOS kafe Anda</p>
      </div>

      <div className="card p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center">
            <Zap className="text-warning" size={20} />
          </div>
          <div>
            <p className="font-semibold text-neutral-900 text-sm">Masa Trial</p>
            <p className="text-xs text-neutral-500">Berakhir dalam {daysLeft > 0 ? `${daysLeft} hari` : "hari ini"}</p>
          </div>
        </div>
        {daysLeft <= 3 && <span className="badge-urgent">Trial Hampir Habis</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLANS.map((plan) => (
          <div key={plan.name} className={plan.highlight ? "card p-5 border-2 border-primary relative" : "card p-5"}>
            {plan.highlight && (
              <span className="absolute -top-3 left-5 bg-primary text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                Paling Hemat
              </span>
            )}
            <p className="font-semibold text-neutral-900">{plan.name}</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">
              {plan.price}<span className="text-sm font-normal text-neutral-400">{plan.period}</span>
            </p>
            <ul className="mt-4 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-neutral-600">
                  <CheckCircle2 size={15} className="text-primary shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <a
              href={whatsappLink(`Halo Studio D13, saya ingin perpanjang langganan caPOS paket ${plan.name}.`)}
              target="_blank"
              rel="noreferrer"
              className={plan.highlight ? "btn-primary w-full mt-5 inline-block text-center" : "btn-outline w-full mt-5 inline-block text-center"}
            >
              Perpanjang Sekarang
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
