"use client";

import { useEffect, useState } from "react";
import { CreditCard, Sparkles, Plus, Loader2 } from "lucide-react";
import { whatsappLink } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";
import type { Membership } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";

export default function MembershipPage() {
  const [loading, setLoading] = useState(true);
  const [hasCustomWebsite, setHasCustomWebsite] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
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
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="max-w-lg mx-auto mt-10">
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
    );
  }

  if (!hasCustomWebsite) {
    return (
      <div className="max-w-lg mx-auto mt-10">
        <div className="card p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
            <Sparkles className="text-primary-dark" size={26} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Fitur Membership Eksklusif</h1>
          <p className="text-sm text-neutral-500">
            Fitur Membership terintegrasi langsung dengan Website Custom Kafe Anda —
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

  return <MembershipPanel tenantId={tenantId!} />;
}

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
          <h1 className="text-xl font-bold text-neutral-900">Membership</h1>
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
