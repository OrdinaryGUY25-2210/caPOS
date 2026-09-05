"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { Zap, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { whatsappLink, daysRemaining, formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, type Tier } from "@/lib/tier";
import { Skeleton } from "@/components/Skeleton";

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
  {
    key: "free", name: "Free Trial", price: "Rp0", period: "/28 hari", rawAmount: 0,
    features: ["1 Owner + 2 Kasir", "Maks 10 Menu", "Riwayat 7 Hari", "Laporan Dasar"],
    highlight: false, payable: false,
  },
  {
    key: "monthly", name: "Pro", price: "Rp99.000", period: "/bulan", rawAmount: 99000,
    features: ["Kasir Unlimited", "Menu Unlimited", "Riwayat Lengkap", "Kesehatan Penjualan"],
    highlight: true, payable: true,
  },
  {
    key: "yearly", name: "Supreme", price: "Rp999.000", period: "/tahun", rawAmount: 999000,
    features: ["Semua fitur Pro", "Laporan Lengkap (Jam Ramai, Menu Terlaris)", "Export Excel & PDF", "Prioritas Support"],
    highlight: false, payable: true,
  },
] as const;

const COMPARISON_ROWS: { label: string; free: string | boolean; pro: string | boolean; supreme: string | boolean }[] = [
  { label: "Akun Kasir Tambahan", free: "Maks 2", pro: "Unlimited", supreme: "Unlimited" },
  { label: "Jumlah Menu", free: "Maks 10", pro: "Unlimited", supreme: "Unlimited" },
  { label: "Jumlah Cabang", free: "Maks 1 Cabang", pro: "Maks 3 Cabang", supreme: "Unlimited" },
  { label: "Riwayat Transaksi", free: "14 Hari Terakhir", pro: "30 Hari Terakhir", supreme: "Lengkap" },
  { label: "Grafik Omzet Harian", free: true, pro: true, supreme: true },
  { label: "Kesehatan Penjualan", free: false, pro: true, supreme: true },
  { label: "Jam Ramai (Peak Hours)", free: false, pro: false, supreme: true },
  { label: "Menu Terlaris", free: false, pro: false, supreme: true },
  { label: "Export CSV Sederhana", free: true, pro: true, supreme: true },
  { label: "Export Excel Multi-sheet + PDF", free: false, pro: false, supreme: true },
  { label: "Prioritas Support", free: false, pro: false, supreme: true },
  { label: "Laporan PDF Otomatis", free: "Riwayat 14 Hari", pro: "Riwayat 30 Hari", supreme: "Riwayat Lengkap" },
  { label: "Stok & HPP", free: true, pro: true, supreme: true },
  { label: "Stok Opname (Multi-Cabang)", free: true, pro: true, supreme: true },
  { label: "Target Bulanan Owner", free: true, pro: true, supreme: true },
  { label: "Evaluasi Kasir", free: true, pro: true, supreme: true },
  { label: "Kehadiran & Izin Karyawan", free: true, pro: true, supreme: true },
  { label: "Persetujuan Menu/Harga (Approval)", free: true, pro: true, supreme: true },
  { label: "Membership Pelanggan", free: true, pro: true, supreme: true },
  { label: "Program Referral", free: true, pro: true, supreme: true },
];

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("trial");
  const [currentTier, setCurrentTier] = useState<Tier>("free");
  const [daysLeft, setDaysLeft] = useState<number>(0);
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [availableDiscountPct, setAvailableDiscountPct] = useState(0);

  async function loadSubscription() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const [{ data: sub }, { data: referral }] = await Promise.all([
      supabase.from("subscriptions").select("status, plan, trial_ends_at, valid_until, pending_signup_discount_pct").eq("tenant_id", profile.tenant_id).single(),
      supabase.from("referrals").select("accumulated_uses").eq("tenant_id", profile.tenant_id).single(),
    ]);

    const signupPct = Number(sub?.pending_signup_discount_pct) || 0;
    const referralPct = Math.min((referral?.accumulated_uses ?? 0) * 3, 15);
    setAvailableDiscountPct(Math.min(signupPct + referralPct, 17));

    if (sub) {
      setStatus(sub.status);
      setCurrentTier(getTier(sub));
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
        setPaymentError(
          "⚠️ Modul Midtrans tidak siap. Penyebab kemungkinan: (1) NEXT_PUBLIC_MIDTRANS_CLIENT_KEY kosong di env hosting, (2) Jaringan terputus saat load script snap.js. Muat ulang halaman & coba lagi."
        );
        setPayingPlan(null);
        return;
      }

      window.snap.pay(result.token, {
        onSuccess: () => {
          setPayingPlan(null);
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
  const midtransClientKeyMissing = !process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;

  useEffect(() => {
    if (midtransClientKeyMissing && !loading) {
      setPaymentError(
        "⚠️ Konfigurasi Midtrans belum lengkap. Hubungi admin: pastikan NEXT_PUBLIC_MIDTRANS_CLIENT_KEY & MIDTRANS_SERVER_KEY diisi di environment hosting, lalu redeploy."
      );
    }
  }, [loading, midtransClientKeyMissing]);

  return (
    <div className="max-w-3xl space-y-6">
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
        <div className="card p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-11 h-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ) : (
        <div className="card p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center">
              <Zap className="text-warning" size={20} />
            </div>
            <div>
              <p className="font-semibold text-neutral-900 text-sm">
                Paket saat ini: {currentTier === "free" ? "Free Trial" : currentTier === "pro" ? "Pro" : "Supreme"}
              </p>
              <p className="text-xs text-neutral-500">
                {status === "active"
                  ? `Berakhir dalam ${daysLeft} hari`
                  : status === "trial"
                  ? `Trial berakhir dalam ${daysLeft > 0 ? `${daysLeft} hari` : "hari ini"}`
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

      {availableDiscountPct > 0 && (
        <div className="card p-4 bg-primary-light/40 border-primary/20 text-sm text-neutral-700 flex items-center justify-between">
          <span>
            🎉 Anda punya diskon <strong>{availableDiscountPct}%</strong> yang akan otomatis kepakai untuk pembayaran berikutnya.
          </span>
          <Link href="/dashboard/referral" className="text-primary-dark text-xs font-medium hover:underline whitespace-nowrap">
            Lihat detail
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const discountedPrice = plan.payable && availableDiscountPct > 0
            ? Math.round(plan.rawAmount * (1 - availableDiscountPct / 100))
            : null;
          return (
          <div key={plan.key} className={plan.highlight ? "card p-5 border-2 border-primary relative" : "card p-5"}>
            {plan.highlight && (
              <span className="absolute -top-3 left-5 bg-primary text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                Paling Populer
              </span>
            )}
            <p className="font-semibold text-neutral-900">{plan.name}</p>
            {discountedPrice !== null ? (
              <div className="mt-1">
                <span className="text-sm text-neutral-400 line-through mr-2">{plan.price}</span>
                <p className="text-2xl font-bold text-primary">
                  {formatRupiah(discountedPrice)}<span className="text-sm font-normal text-neutral-400">{plan.period}</span>
                </p>
              </div>
            ) : (
              <p className="text-2xl font-bold text-neutral-900 mt-1">
                {plan.price}<span className="text-sm font-normal text-neutral-400">{plan.period}</span>
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-neutral-600">
                  <CheckCircle2 size={15} className="text-primary shrink-0" /> {f}
                </li>
              ))}
            </ul>
            {plan.payable ? (
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
            ) : (
              <div className="w-full mt-5 text-center text-xs text-neutral-400 py-2.5">
                {currentTier === "free" ? "Paket Anda saat ini" : "Paket awal (sudah dilewati)"}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {/* Tabel perbandingan fitur — supaya keputusan upgrade lebih jelas
          daripada cuma baca daftar singkat di tiap kartu. */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-neutral-100">
          <h2 className="font-semibold text-neutral-900 text-sm">Perbandingan Fitur Lengkap</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-neutral-500">
                <th className="text-left font-medium py-2.5 px-4">Fitur</th>
                <th className="text-center font-medium py-2.5 px-3">Free Trial</th>
                <th className="text-center font-medium py-2.5 px-3 text-primary-dark">Pro</th>
                <th className="text-center font-medium py-2.5 px-3">Supreme</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-neutral-50 last:border-0">
                  <td className="py-2.5 px-4 text-neutral-700">{row.label}</td>
                  <ComparisonCell value={row.free} />
                  <ComparisonCell value={row.pro} highlight />
                  <ComparisonCell value={row.supreme} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function ComparisonCell({ value, highlight }: { value: string | boolean; highlight?: boolean }) {
  return (
    <td className={"text-center py-2.5 px-3" + (highlight ? " bg-primary-light/30" : "")}>
      {typeof value === "boolean" ? (
        value ? (
          <CheckCircle2 size={16} className="text-primary inline" />
        ) : (
          <XCircle size={16} className="text-neutral-300 inline" />
        )
      ) : (
        <span className="text-neutral-700">{value}</span>
      )}
    </td>
  );
}
