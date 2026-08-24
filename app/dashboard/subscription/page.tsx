"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { Zap, CheckCircle2, Loader2 } from "lucide-react";
import { whatsappLink, daysRemaining } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        callbacks: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
        }
      ) => void;
    };
  }
}

const PLANS = [
  { key: "monthly", name: "Bulanan", price: "Rp99.000", period: "/bulan", features: ["1 Outlet", "Unlimited Transaksi", "Laporan Dasar"], highlight: false },
  { key: "yearly", name: "Tahunan", price: "Rp999.000", period: "/tahun", features: ["1 Outlet", "Unlimited Transaksi", "Laporan Lengkap", "Prioritas Support"], highlight: true },
] as const;

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("trial");
  const [daysLeft, setDaysLeft] = useState<number>(0);
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  async function loadSubscription() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status, trial_ends_at, valid_until")
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (sub) {
      setStatus(sub.status);
      const relevantDate = sub.status === "trial" ? sub.trial_ends_at : sub.valid_until;
      setDaysLeft(relevantDate ? daysRemaining(relevantDate) : 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadSubscription();
  }, []);

  async function handlePay(planKey: string) {
    setPaymentError(null);
    setPayingPlan(planKey);

    try {
      const res = await fetch("/api/midtrans/create-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const result = await res.json();

      if (!res.ok) {
        setPaymentError(result.message || "Gagal membuat transaksi.");
        setPayingPlan(null);
        return;
      }

      if (!window.snap) {
        setPaymentError("Modul pembayaran belum siap, coba muat ulang halaman.");
        setPayingPlan(null);
        return;
      }

      window.snap.pay(result.token, {
        onSuccess: () => {
          setPayingPlan(null);
          // Webhook akan mengupdate subscriptions di background — refresh
          // data lokal setelah jeda singkat supaya sinkron.
          setTimeout(loadSubscription, 2000);
        },
        onPending: () => {
          setPayingPlan(null);
          alert("Pembayaran tercatat pending. Status akan otomatis update begitu pembayaran dikonfirmasi.");
        },
        onError: () => {
          setPayingPlan(null);
          setPaymentError("Pembayaran gagal. Silakan coba lagi.");
        },
        onClose: () => {
          setPayingPlan(null);
        },
      });
    } catch {
      setPaymentError("Terjadi kesalahan jaringan.");
      setPayingPlan(null);
    }
  }

  const isProduction = process.env.NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION === "true";

  return (
    <div className="max-w-2xl space-y-6">
      {/* Snap.js dari Midtrans — URL sandbox/production beda, dan
          data-client-key WAJIB diisi client key (bukan server key —
          client key aman ditaruh di frontend, server key tidak). */}
      <Script
        src={isProduction ? "https://app.midtrans.com/snap/snap.js" : "https://app.sandbox.midtrans.com/snap/snap.js"}
        data-client-key={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY}
        strategy="afterInteractive"
      />

      <div>
        <h1 className="text-xl font-bold text-neutral-900">Status Langganan</h1>
        <p className="text-sm text-neutral-500">Kelola masa aktif akun caPOS kafe Anda</p>
      </div>

      {loading ? (
        <div className="card p-5 flex items-center gap-2 text-neutral-400 text-sm">
          <Loader2 className="animate-spin" size={16} /> Memuat status langganan...
        </div>
      ) : (
        <div className="card p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center">
              <Zap className="text-warning" size={20} />
            </div>
            <div>
              <p className="font-semibold text-neutral-900 text-sm">
                {status === "active" ? "Langganan Aktif" : status === "trial" ? "Masa Trial" : "Langganan Tidak Aktif"}
              </p>
              <p className="text-xs text-neutral-500">
                {status === "active"
                  ? `Berakhir dalam ${daysLeft} hari`
                  : status === "trial"
                  ? `Berakhir dalam ${daysLeft > 0 ? `${daysLeft} hari` : "hari ini"}`
                  : "Perpanjang untuk mengaktifkan kembali"}
              </p>
            </div>
          </div>
          {status !== "active" && daysLeft <= 3 && <span className="badge-urgent">Trial Hampir Habis</span>}
          {status === "active" && <span className="badge-active">Active</span>}
        </div>
      )}

      {paymentError && (
        <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{paymentError}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLANS.map((plan) => (
          <div key={plan.key} className={plan.highlight ? "card p-5 border-2 border-primary relative" : "card p-5"}>
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
            <button
              onClick={() => handlePay(plan.key)}
              disabled={payingPlan !== null}
              className={
                (plan.highlight ? "btn-primary" : "btn-outline") +
                " w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-60"
              }
            >
              {payingPlan === plan.key && <Loader2 className="animate-spin" size={16} />}
              Perpanjang Sekarang
            </button>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-neutral-400">
        Ada kendala pembayaran?{" "}
        <a
          href={whatsappLink("Halo Studio D13, saya ada kendala pembayaran langganan caPOS.")}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Hubungi via WhatsApp
        </a>
      </p>
    </div>
  );
}
