"use client";

import { useEffect, useState } from "react";
import { CreditCard, Sparkles, Plus, Loader2, Award, Gift, History, User, IdCard } from "lucide-react";
import { whatsappLink, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";
import type { Membership, CustomerTier, MemberCard as MemberCardType } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import { getCustomers, getCustomerProfile } from "@/app/actions/purchasing-loyalty-actions";
import { getCustomerTiers, getMemberCard } from "@/app/actions/customer-membership-actions";
import MemberCardModal from "@/components/crm/MemberCardModal";

/**
 * Halaman Membership — dua bagian:
 *  1. "Member & Loyalty" (BARU): daftar pelanggan dengan tier/poin, info
 *     reward per tier, kartu member digital (QR), dan profil + riwayat
 *     transaksi per pelanggan. Dibangun di atas modul CRM Loyalty yang
 *     sudah ada (customer_tiers/customer_points, migration_16 bagian H) —
 *     tidak menduplikasi logic, hanya menyusun ulang UI-nya di sini.
 *  2. "Kartu Diskon Website" (LAMA, tidak diubah): kartu member sederhana
 *     (nama, HP, diskon%) yang terhubung ke Website Custom Kafe.
 */
export default function MembershipPage() {
  const [tab, setTab] = useState<"loyalty" | "website">("loyalty");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [hasCustomWebsite, setHasCustomWebsite] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoadingProfile(false);
        return;
      }
      setTenantId(profile.tenant_id);

      const supabase = createClient();
      const { data: tenant } = await supabase
        .from("tenants")
        .select("has_custom_website")
        .eq("id", profile.tenant_id)
        .single();

      setHasCustomWebsite(tenant?.has_custom_website ?? false);
      setLoadingProfile(false);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Membership</h1>
        <p className="text-sm text-neutral-500">
          Kelola tier, poin, kartu member, dan kartu diskon pelanggan kafe Anda
        </p>
      </div>

      <div className="flex gap-1 border-b border-neutral-200">
        <TabButton active={tab === "loyalty"} onClick={() => setTab("loyalty")}>
          Member &amp; Loyalty
        </TabButton>
        <TabButton active={tab === "website"} onClick={() => setTab("website")}>
          Kartu Diskon Website
        </TabButton>
      </div>

      {tab === "loyalty" &&
        (loadingProfile ? (
          <SkeletonList rows={4} />
        ) : tenantId ? (
          <LoyaltyMembershipPanel tenantId={tenantId} />
        ) : (
          <p className="text-sm text-neutral-400 text-center py-10">Gagal memuat profil pengguna.</p>
        ))}

      {tab === "website" && (
        <>
          {loadingProfile ? (
            <div className="max-w-lg mx-auto mt-4">
              <div className="card p-8 text-center space-y-4">
                <Skeleton className="w-14 h-14 rounded-2xl mx-auto" />
                <Skeleton className="h-5 w-56 mx-auto" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3 mx-auto" />
                </div>
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            </div>
          ) : !hasCustomWebsite ? (
            <WebsiteUpgradeNotice />
          ) : (
            <MembershipPanel tenantId={tenantId!} />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active ? "border-primary text-primary-dark" : "border-transparent text-neutral-400 hover:text-neutral-600"
      )}
    >
      {children}
    </button>
  );
}

function WebsiteUpgradeNotice() {
  return (
    <div className="max-w-lg mx-auto mt-4">
      <div className="card p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
          <Sparkles className="text-primary-dark" size={26} />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">Fitur Kartu Diskon Website</h1>
        <p className="text-sm text-neutral-500">
          Fitur ini terintegrasi langsung dengan Website Custom Kafe Anda —
          pelanggan bisa mendaftar, melihat diskon, dan mengecek riwayat member secara online.
          Upgrade paket Anda untuk membuka fitur ini.
        </p>
        <a
          href={whatsappLink("Halo Studio D13, saya ingin upgrade ke Website Custom untuk membuka fitur Membership caPOS.")}
          target="_blank"
          rel="noreferrer"
          className="btn-primary w-full inline-block"
        >
          Hubungi Developer (Studio D13) via WhatsApp
        </a>
        <p className="text-xs text-neutral-400">
          Sudah upgrade? Minta Studio D13 mengaktifkan kolom <code>has_custom_website</code> di tenant Anda.
        </p>
      </div>
    </div>
  );
}

/* =========================================================
 * BARU — Member & Loyalty (Tier, Poin, Kartu Member, Riwayat)
 * ========================================================= */

interface CustomerRow {
  id: string;
  customer_code: string;
  customer_name: string;
  phone_number: string | null;
  email: string | null;
  lifetime_spend: number;
  is_active: boolean;
  customer_tiers: { tier_name: string } | { tier_name: string }[] | null;
}

function tierNameOf(row: CustomerRow): string | null {
  const t = row.customer_tiers;
  if (!t) return null;
  return Array.isArray(t) ? t[0]?.tier_name ?? null : t.tier_name;
}

function LoyaltyMembershipPanel({ tenantId }: { tenantId: string }) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [tiers, setTiers] = useState<CustomerTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRewards, setShowRewards] = useState(false);
  const [cardCustomerId, setCardCustomerId] = useState<string | null>(null);
  const [memberCard, setMemberCard] = useState<MemberCardType | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [profileCustomer, setProfileCustomer] = useState<CustomerRow | null>(null);

  async function load() {
    setLoading(true);
    const [custRes, tierRes] = await Promise.all([getCustomers(100), getCustomerTiers()]);
    if (custRes.success) setCustomers((custRes.data as CustomerRow[]) ?? []);
    if (tierRes.data) setTiers(tierRes.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function openCard(customerId: string) {
    setCardCustomerId(customerId);
    setCardLoading(true);
    const res = await getMemberCard(customerId);
    setCardLoading(false);
    if (res.error || !res.data) {
      alert("Gagal memuat kartu member: " + (res.error ?? "data tidak ditemukan"));
      setCardCustomerId(null);
      return;
    }
    setMemberCard(res.data);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Reward information per tier */}
      <div className="card p-4">
        <button
          onClick={() => setShowRewards((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="flex items-center gap-2 font-semibold text-sm text-neutral-900">
            <Gift size={16} className="text-primary" /> Info Tier &amp; Reward
          </span>
          <span className="text-xs text-neutral-400">{showRewards ? "Sembunyikan" : "Lihat semua"}</span>
        </button>
        {showRewards && (
          <div className="mt-3 space-y-2">
            {tiers.length === 0 ? (
              <p className="text-xs text-neutral-400">Belum ada tier member yang dikonfigurasi.</p>
            ) : (
              tiers.map((t) => (
                <div key={t.id} className="bg-neutral-50 rounded-xl p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-900 flex items-center gap-1.5">
                      <Award size={14} className="text-primary-dark" /> {t.tier_name}
                    </span>
                    <span className="text-xs text-neutral-500">
                      Diskon {t.discount_percentage}% · Poin {t.points_multiplier}x
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Min. belanja Rp {t.min_spend_monthly.toLocaleString("id-ID")}/bulan
                  </p>
                  {t.benefits?.length > 0 && (
                    <ul className="list-disc list-inside text-xs text-neutral-500 mt-1 space-y-0.5">
                      {t.benefits.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Member list */}
      <div className="card divide-y divide-neutral-100">
        {customers.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 p-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                <User size={18} />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-neutral-900 text-sm truncate">{c.customer_name}</p>
                <p className="text-xs text-neutral-500 font-mono truncate">
                  {c.customer_code} {c.phone_number ? `· ${c.phone_number}` : ""}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="badge-active text-[10px]">{tierNameOf(c) ?? "Reguler"}</span>
                  <span className="text-[10px] text-neutral-400">
                    Total belanja Rp {c.lifetime_spend.toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setProfileCustomer(c)}
                className="text-xs font-medium text-neutral-600 border border-neutral-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1"
              >
                <History size={12} /> Profil &amp; Riwayat
              </button>
              <button
                onClick={() => openCard(c.id)}
                disabled={cardLoading && cardCustomerId === c.id}
                className="text-xs font-medium bg-primary text-white rounded-lg px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-60"
              >
                {cardLoading && cardCustomerId === c.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <IdCard size={12} />
                )}
                Kartu Member
              </button>
            </div>
          </div>
        ))}
        {customers.length === 0 && (
          <p className="p-6 text-center text-neutral-400 text-sm">
            Belum ada pelanggan terdaftar. Tambahkan pelanggan lewat menu CRM saat transaksi di POS.
          </p>
        )}
      </div>

      {memberCard && (
        <MemberCardModal
          card={memberCard}
          onClose={() => {
            setMemberCard(null);
            setCardCustomerId(null);
          }}
          onTierChanged={() => {
            load();
            if (cardCustomerId) openCard(cardCustomerId);
          }}
        />
      )}

      {profileCustomer && (
        <CustomerProfileModal customer={profileCustomer} onClose={() => setProfileCustomer(null)} />
      )}
    </div>
  );
}

function CustomerProfileModal({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ loyaltyBalance: number; recentTransactions: any[] } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await getCustomerProfile(customer.id);
      if (!res.error && res.data) {
        setProfile({
          loyaltyBalance: res.data.loyaltyBalance ?? 0,
          recentTransactions: res.data.recentTransactions ?? [],
        });
      }
      setLoading(false);
    })();
  }, [customer.id]);

  return (
    <Modal title="Profil Pelanggan" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="font-semibold text-neutral-900">{customer.customer_name}</p>
          <p className="text-xs text-neutral-500 font-mono mt-0.5">{customer.customer_code}</p>
          <div className="text-xs text-neutral-500 mt-2 space-y-0.5">
            {customer.phone_number && <p>Telp: {customer.phone_number}</p>}
            {customer.email && <p>Email: {customer.email}</p>}
            <p>Tier: {tierNameOf(customer) ?? "Reguler"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-neutral-50 rounded-xl p-3">
            <p className="text-neutral-400 text-xs">Total Belanja</p>
            <p className="font-semibold text-neutral-900">Rp {customer.lifetime_spend.toLocaleString("id-ID")}</p>
          </div>
          <div className="bg-neutral-50 rounded-xl p-3">
            <p className="text-neutral-400 text-xs">Saldo Poin</p>
            <p className="font-semibold text-neutral-900">
              {loading ? "…" : (profile?.loyaltyBalance ?? 0).toLocaleString("id-ID")}
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-neutral-700 mb-2 flex items-center gap-1.5">
            <History size={14} /> Riwayat Transaksi Terakhir
          </p>
          {loading ? (
            <SkeletonList rows={3} />
          ) : !profile?.recentTransactions.length ? (
            <p className="text-xs text-neutral-400">Belum ada transaksi tercatat untuk pelanggan ini.</p>
          ) : (
            <div className="space-y-2">
              {profile.recentTransactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-xs bg-neutral-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium text-neutral-800">{tx.invoice_number}</p>
                    <p className="text-neutral-400">{new Date(tx.created_at).toLocaleDateString("id-ID")}</p>
                  </div>
                  <p className="font-semibold text-neutral-900">Rp {Number(tx.total_amount).toLocaleString("id-ID")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
 * LAMA — Kartu Diskon Website (tidak diubah, hanya dipindah
 * jadi komponen terpisah supaya bisa dipanggil dari tab kedua)
 * ========================================================= */

function MembershipPanel({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", discount_percentage: 10 });

  async function loadMembers() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("memberships")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setMembers((data as Membership[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addMember() {
    if (!form.customer_name.trim() || !form.customer_phone.trim()) return;
    setSaving(true);
    const supabase = createClient();

    // member_code, valid_until (via default di kolom) di-generate otomatis
    // oleh database (lihat DEFAULT di supabase/schema.sql), jadi cukup kirim
    // data pelanggan + diskon. Beri validitas 1 tahun dari sekarang.
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    const { error } = await supabase.from("memberships").insert({
      tenant_id: tenantId,
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      discount_percentage: form.discount_percentage,
      valid_until: validUntil.toISOString(),
    });

    if (error) {
      alert("Gagal menambah member: " + error.message);
      setSaving(false);
      return;
    }

    setForm({ customer_name: "", customer_phone: "", discount_percentage: 10 });
    setShowForm(false);
    setSaving(false);
    loadMembers();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-neutral-900">Kartu Diskon Website</h2>
          <p className="text-sm text-neutral-500">Kelola kartu langganan pelanggan kafe Anda</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Tambah Member
        </button>
      </div>

      <div className="card divide-y divide-neutral-100">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center">
                <CreditCard size={18} />
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{m.customer_name}</p>
                <p className="text-xs text-neutral-500 font-mono">{m.member_code} · {m.customer_phone}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="badge-active">Diskon {m.discount_percentage}%</span>
              <p className="text-xs text-neutral-400 mt-1">
                Berlaku s/d {new Date(m.valid_until).toLocaleDateString("id-ID")}
              </p>
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="p-6 text-center text-neutral-400 text-sm">Belum ada member terdaftar.</p>
        )}
      </div>

      {showForm && (
        <Modal
          title="Tambah Member Baru"
          onClose={() => setShowForm(false)}
          footer={
            <button
              disabled={saving}
              onClick={addMember}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={16} />}
              Buat Kartu Member
            </button>
          }
        >
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Pelanggan</label>
            <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="input-field" maxLength={80} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">No. HP</label>
            <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} className="input-field" maxLength={20} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Diskon Member (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.discount_percentage}
              onChange={(e) => setForm({ ...form, discount_percentage: Number(e.target.value) })}
              className="input-field"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
