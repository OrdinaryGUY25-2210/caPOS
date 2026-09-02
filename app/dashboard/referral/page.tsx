"use client";

import { useEffect, useState } from "react";
import { Gift, Copy, Check, Loader2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";

interface RedemptionRow {
  id: string;
  created_at: string;
  reward_granted: boolean;
}

export default function ReferralPage() {
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [accumulatedUses, setAccumulatedUses] = useState(0);
  const [pendingSignupDiscount, setPendingSignupDiscount] = useState(0);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const [{ data: referral }, { data: sub }, { data: redemptionRows }] = await Promise.all([
        supabase.from("referrals").select("code, accumulated_uses").eq("tenant_id", profile.tenant_id).single(),
        supabase.from("subscriptions").select("pending_signup_discount_pct").eq("tenant_id", profile.tenant_id).single(),
        supabase.from("referral_redemptions").select("id, created_at, reward_granted").eq("referrer_tenant_id", profile.tenant_id).order("created_at", { ascending: false }),
      ]);

      if (referral) {
        setCode(referral.code);
        setAccumulatedUses(referral.accumulated_uses);
      }
      if (sub) setPendingSignupDiscount(Number(sub.pending_signup_discount_pct) || 0);
      setRedemptions(redemptionRows ?? []);
      setLoading(false);
    })();
  }, []);

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const accumulatedDiscountPct = accumulatedUses * 3;
  const maxComboPct = pendingSignupDiscount + 15;
  const progressPct = (accumulatedUses / 5) * 100;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat program referral...
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Program Referral</h1>
        <p className="text-sm text-neutral-500">Bagikan kode Anda, dapatkan diskon perpanjangan langganan</p>
      </div>

      <div className="card p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
          <Gift className="text-primary-dark" size={24} />
        </div>
        <p className="text-sm text-neutral-500">Kode Referral Anda</p>
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl font-bold font-mono tracking-[0.2em] text-neutral-900">{code}</span>
          <button onClick={copyCode} className="text-neutral-400 hover:text-primary p-2" title="Salin kode">
            {copied ? <Check size={18} className="text-primary" /> : <Copy size={18} />}
          </button>
        </div>
        <p className="text-xs text-neutral-400">
          Bagikan kode ini ke pemilik kafe lain — begitu mereka daftar & bayar langganan pertama, Anda dapat +3% diskon.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-neutral-900 text-sm">Akumulasi Diskon</p>
          <span className="text-lg font-bold text-primary">{accumulatedDiscountPct}%</span>
        </div>
        <div className="h-3 rounded-full bg-neutral-100 overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>{accumulatedUses}/5 orang top-up</span>
          <span>Maks 15% (5 orang)</span>
        </div>
        <p className="text-xs text-neutral-400 pt-2 border-t border-neutral-100">
          Diskon ini otomatis kepakai saat <strong>Anda</strong> membayar perpanjangan langganan berikutnya —
          berapa pun akumulasinya saat itu (tidak perlu menunggu penuh 5/5). Begitu Anda top up,
          akumulasi otomatis reset ke 0/5 dan bisa dikumpulkan lagi dari awal.
        </p>
        {pendingSignupDiscount > 0 && (
          <div className="bg-primary-light/50 rounded-xl p-3 text-xs text-primary-dark">
            Anda juga masih punya diskon <strong>{pendingSignupDiscount}%</strong> pendaftar baru,
            berlaku untuk pembayaran pertama Anda. Kombinasi maksimal: <strong>{maxComboPct}%</strong>.
          </div>
        )}
      </div>

      <div className="card divide-y divide-neutral-100">
        <div className="p-4 flex items-center gap-2 font-semibold text-neutral-900 text-sm">
          <Users size={16} /> Riwayat Pemakaian Kode ({redemptions.length})
        </div>
        {redemptions.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-4">
            <p className="text-sm text-neutral-600">{new Date(r.created_at).toLocaleDateString("id-ID")}</p>
            <span className={r.reward_granted ? "badge-active" : "badge-warning"}>
              {r.reward_granted ? "Sudah top-up (+3%)" : "Belum top-up"}
            </span>
          </div>
        ))}
        {redemptions.length === 0 && (
          <p className="p-6 text-center text-neutral-400 text-sm">Belum ada yang pakai kode Anda.</p>
        )}
      </div>
    </div>
  );
}
