"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, LogOut, Loader2, Gift, KeyRound, Plus, Ban, RefreshCw } from "lucide-react";
import { daysRemaining } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { generateReferralCode } from "@/lib/generateReferralCode";
import Modal from "@/components/Modal";
import { Skeleton, SkeletonStatGrid, SkeletonList } from "@/components/Skeleton";

interface TenantRow {
  id: string;
  name: string;
  status: "trial" | "active" | "past_due" | "expired";
  hasCustomWebsite: boolean;
  createdAt: string;
  trialEndsAt: string | null;
  daysLeft: number | null;
}

interface SpecialCodeRow {
  id: string;
  code: string;
  trialDays: number;
  discountPct: number;
  expiresAt: string;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  note: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  active: "badge-active",
  trial: "badge-warning",
  past_due: "badge-warning",
  expired: "badge-urgent",
};

export default function AdminPanel() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extendingId, setExtendingId] = useState<string | null>(null);

  const [missingReferrals, setMissingReferrals] = useState<{ id: string; name: string }[]>([]);
  const [generatingReferralId, setGeneratingReferralId] = useState<string | null>(null);

  const [specialCodes, setSpecialCodes] = useState<SpecialCodeRow[]>([]);
  const [showSpecialForm, setShowSpecialForm] = useState(false);
  const [savingSpecial, setSavingSpecial] = useState(false);
  const [togglingCodeId, setTogglingCodeId] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("id, name, has_custom_website, created_at, subscriptions(status, trial_ends_at)")
      .order("created_at", { ascending: false });

    const mappedTenants = (tenantRows ?? []).map((t: any) => {
      const sub = t.subscriptions?.[0];
      return {
        id: t.id,
        name: t.name,
        hasCustomWebsite: t.has_custom_website,
        createdAt: new Date(t.created_at).toLocaleDateString("id-ID"),
        status: sub?.status ?? "trial",
        trialEndsAt: sub?.trial_ends_at ?? null,
        daysLeft: sub?.trial_ends_at ? daysRemaining(sub.trial_ends_at) : null,
      };
    });
    setTenants(mappedTenants);

    // Cari tenant yang belum punya baris di tabel `referrals` (kode
    // referral tidak akan muncul di halaman mereka sampai ini diisi).
    const { data: referralRows } = await supabase.from("referrals").select("tenant_id");
    const tenantIdsWithReferral = new Set((referralRows ?? []).map((r: any) => r.tenant_id));
    setMissingReferrals(
      (tenantRows ?? [])
        .filter((t: any) => !tenantIdsWithReferral.has(t.id))
        .map((t: any) => ({ id: t.id, name: t.name }))
    );

    const { data: specialRows } = await supabase
      .from("admin_special_codes")
      .select("id, code, trial_days, discount_pct, expires_at, max_uses, used_count, is_active, note")
      .order("created_at", { ascending: false });

    setSpecialCodes(
      (specialRows ?? []).map((r: any) => ({
        id: r.id,
        code: r.code,
        trialDays: r.trial_days,
        discountPct: Number(r.discount_pct),
        expiresAt: r.expires_at,
        maxUses: r.max_uses,
        usedCount: r.used_count,
        isActive: r.is_active,
        note: r.note,
      }))
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function extendTrial(tenantId: string) {
    setExtendingId(tenantId);
    const supabase = createClient();
    const { error } = await supabase
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("tenant_id", tenantId);
    setExtendingId(null);

    if (error) {
      alert("Gagal perpanjang trial: " + error.message);
      return;
    }
    loadData();
  }

  async function activateTenant(tenantId: string) {
    if (!confirm("Jadikan tenant ini 'active' (bebas dari hitungan trial) selama 1 tahun?")) return;
    setExtendingId(tenantId);
    const supabase = createClient();
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("tenant_id", tenantId);
    setExtendingId(null);

    if (error) {
      alert("Gagal aktifkan tenant: " + error.message);
      return;
    }
    loadData();
  }

  async function generateMissingReferral(tenantId: string) {
    setGeneratingReferralId(tenantId);
    const supabase = createClient();
    let lastError: string | null = null;

    // Coba beberapa kali kalau kebetulan kodenya sudah dipakai tenant lain
    // (sangat jarang — 6 karakter dari 32 pilihan huruf/angka).
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode();
      const { error } = await supabase.rpc("admin_upsert_referral_code", {
        p_tenant_id: tenantId,
        p_code: code,
      });
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error.message;
    }

    setGeneratingReferralId(null);
    if (lastError) {
      alert("Gagal membuat kode referral: " + lastError);
      return;
    }
    loadData();
  }

  async function createSpecialCode(input: {
    code: string;
    trialDays: number;
    discountPct: number;
    expiresAt: string;
    maxUses: number | null;
    note: string;
  }) {
    setSavingSpecial(true);
    const { profile } = await getCurrentProfile();
    const supabase = createClient();
    const { error } = await supabase.from("admin_special_codes").insert({
      code: input.code,
      trial_days: input.trialDays,
      discount_pct: input.discountPct,
      expires_at: input.expiresAt,
      max_uses: input.maxUses,
      note: input.note || null,
      created_by: profile?.id ?? null,
    });
    setSavingSpecial(false);
    if (error) {
      alert("Gagal membuat kode khusus: " + error.message);
      return;
    }
    setShowSpecialForm(false);
    loadData();
  }

  async function toggleSpecialCode(row: SpecialCodeRow) {
    setTogglingCodeId(row.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("admin_special_codes")
      .update({ is_active: !row.isActive })
      .eq("id", row.id);
    setTogglingCodeId(null);
    if (error) {
      alert("Gagal mengubah status kode: " + error.message);
      return;
    }
    loadData();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-white">
            <Shield size={20} />
            <span className="font-bold">caPOS — Super Admin</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
          </div>
        </header>
        <div className="p-6 space-y-8 max-w-5xl mx-auto">
          <SkeletonStatGrid count={4} gridClassName="grid-cols-2 sm:grid-cols-4" />
          <section>
            <Skeleton className="h-4 w-48 mb-1" />
            <Skeleton className="h-3 w-full max-w-lg mb-4" />
            <SkeletonList rows={5} withAvatar={false} />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
        <div className="flex items-center gap-2 text-white">
          <Shield size={20} />
          <span className="font-bold">caPOS — Super Admin</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
        </div>
        <button onClick={handleLogout} className="text-neutral-400 hover:text-white flex items-center gap-1.5 text-sm">
          <LogOut size={16} /> Keluar
        </button>
      </header>

      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Total Tenant</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">{tenants.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Active (Subscribed)</p>
            <p className="text-2xl font-bold text-primary mt-1">
              {tenants.filter((t) => t.status === "active").length}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Trial</p>
            <p className="text-2xl font-bold text-warning mt-1">
              {tenants.filter((t) => t.status === "trial").length}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Expired / Past Due</p>
            <p className="text-2xl font-bold text-urgent mt-1">
              {tenants.filter((t) => t.status === "expired" || t.status === "past_due").length}
            </p>
          </div>
        </section>

        <section>
          <h1 className="text-lg font-bold text-neutral-900 mb-1">Daftar Tenant Kafe</h1>
          <p className="text-sm text-neutral-500 mb-4">
            Akses tak terbatas ke seluruh tenant untuk keperluan demo & konten. Registrasi
            terbuka untuk siapa saja lewat <code>/register</code> — tidak lagi memerlukan kode akses.
          </p>
          <div className="card divide-y divide-neutral-100">
            {tenants.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 text-sm truncate">{t.name}</p>
                  <p className="text-xs text-neutral-400">
                    Terdaftar {t.createdAt} {t.hasCustomWebsite && "· Website Custom Active"}
                    {t.status === "trial" && t.daysLeft !== null && (
                      <> · Sisa trial: {t.daysLeft > 0 ? `${t.daysLeft} hari` : "habis"}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={STATUS_STYLE[t.status]}>{t.status.replace("_", " ")}</span>
                  {t.status !== "active" && (
                    <>
                      <button
                        onClick={() => extendTrial(t.id)}
                        disabled={extendingId === t.id}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50 whitespace-nowrap"
                        title="Perpanjang trial 28 hari dari sekarang"
                      >
                        +28 hari
                      </button>
                      <button
                        onClick={() => activateTenant(t.id)}
                        disabled={extendingId === t.id}
                        className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-50 whitespace-nowrap"
                        title="Set jadi active, bebas hitungan trial"
                      >
                        Aktifkan
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {tenants.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada tenant terdaftar.</p>}
          </div>
        </section>

        {missingReferrals.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-neutral-900 mb-1 flex items-center gap-2">
              <Gift size={18} /> Kode Referral Bermasalah
            </h2>
            <p className="text-sm text-neutral-500 mb-4">
              Tenant di bawah ini belum punya kode referral (biasanya akun dibuat sebelum fitur ini ada, atau dibuat manual). Klik generate untuk membuatkan kode baru untuk mereka.
            </p>
            <div className="card divide-y divide-neutral-100">
              {missingReferrals.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-4 gap-3">
                  <p className="font-medium text-neutral-900 text-sm truncate">{t.name}</p>
                  <button
                    onClick={() => generateMissingReferral(t.id)}
                    disabled={generatingReferralId === t.id}
                    className="btn-outline text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {generatingReferralId === t.id ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                    Generate Kode
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
              <KeyRound size={18} /> Kode Khusus Admin
            </h2>
            <button onClick={() => setShowSpecialForm(true)} className="btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> Buat Kode Baru
            </button>
          </div>
          <p className="text-sm text-neutral-500 mb-4">
            Kode promo yang Anda buat & bagikan sendiri (misal ke partner/campaign tertentu) — beda dari kode referral tenant. Setiap kode punya masa berlaku, lama trial Supreme, diskon pendaftar, dan batas pemakaian sendiri.
          </p>
          <div className="card divide-y divide-neutral-100">
            {specialCodes.map((c) => {
              const expired = new Date(c.expiresAt) < new Date();
              const usedUp = c.maxUses !== null && c.usedCount >= c.maxUses;
              const statusLabel = !c.isActive ? "Nonaktif" : expired ? "Kedaluwarsa" : usedUp ? "Habis Kuota" : "Aktif";
              const statusStyle = statusLabel === "Aktif" ? "badge-active" : statusLabel === "Nonaktif" ? "badge-urgent" : "badge-warning";
              return (
                <div key={c.id} className="flex items-center justify-between p-4 gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-neutral-900 text-sm">{c.code}</p>
                    <p className="text-xs text-neutral-400">
                      Trial {c.trialDays} hari · Diskon {c.discountPct}% · Berlaku s/d {new Date(c.expiresAt).toLocaleDateString("id-ID")}
                      {" · "}Dipakai {c.usedCount}{c.maxUses !== null ? `/${c.maxUses}` : ""}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={statusStyle}>{statusLabel}</span>
                    <button
                      onClick={() => toggleSpecialCode(c)}
                      disabled={togglingCodeId === c.id}
                      className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-50 flex items-center gap-1"
                      title={c.isActive ? "Nonaktifkan kode" : "Aktifkan lagi kode"}
                    >
                      <Ban size={12} /> {c.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </div>
                </div>
              );
            })}
            {specialCodes.length === 0 && (
              <p className="p-6 text-center text-neutral-400 text-sm">Belum ada kode khusus dibuat.</p>
            )}
          </div>
        </section>
      </div>

      {showSpecialForm && (
        <SpecialCodeFormModal
          saving={savingSpecial}
          onClose={() => setShowSpecialForm(false)}
          onSave={createSpecialCode}
        />
      )}
    </div>
  );
}

function SpecialCodeFormModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    code: string;
    trialDays: number;
    discountPct: number;
    expiresAt: string;
    maxUses: number | null;
    note: string;
  }) => void;
}) {
  const [code, setCode] = useState(generateReferralCode());
  const [trialDays, setTrialDays] = useState("5");
  const [discountPct, setDiscountPct] = useState("2");
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [maxUses, setMaxUses] = useState("");
  const [note, setNote] = useState("");

  const valid = code.trim().length >= 4 && Number(trialDays) > 0 && expiresAt;

  return (
    <Modal
      title="Buat Kode Khusus Admin"
      onClose={onClose}
      footer={
        <button
          disabled={saving || !valid}
          onClick={() =>
            onSave({
              code: code.trim().toUpperCase(),
              trialDays: Number(trialDays),
              discountPct: discountPct === "" ? 0 : Number(discountPct),
              expiresAt: new Date(expiresAt + "T23:59:59").toISOString(),
              maxUses: maxUses === "" ? null : Number(maxUses),
              note,
            })
          }
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Kode
        </button>
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Kode</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            className="input-field font-mono"
            maxLength={12}
          />
        </div>
        <button
          type="button"
          onClick={() => setCode(generateReferralCode())}
          className="btn-outline shrink-0 px-3 py-2"
          title="Acak ulang kode"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Lama Trial Supreme (hari)</label>
          <input
            type="text" inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Diskon Pendaftar (%)</label>
          <input
            type="text" inputMode="numeric"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Berlaku Sampai</label>
          <input
            type="date"
            value={expiresAt}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Batas Pemakaian (opsional)</label>
          <input
            type="text" inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Kosongkan = tak terbatas"
            className="input-field"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan (opsional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Campaign IG Agustus" className="input-field" />
      </div>
    </Modal>
  );
}
