"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, MapPin, Loader2, Lock, CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, TIER_LABEL, BRANCH_LIMIT, type Tier } from "@/lib/tier";
import { useBranch } from "@/lib/branchContext";
import Modal from "@/components/Modal";
import type { Branch } from "@/lib/types";

/**
 * Manajemen Cabang (Owner only). Manager/Kasir tidak bisa membuka halaman
 * ini secara berarti — RLS "Branches: owner insert/update" di
 * migration_011 menolak tulis dari mereka walau URL diakses langsung.
 */
export default function BranchesPage() {
  const { branches, refreshBranches } = useBranch();
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<Tier>("free");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      setIsOwner(profile.role === "owner" || profile.role === "super_admin");

      const supabase = createClient();
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, plan")
        .eq("tenant_id", profile.tenant_id)
        .single();
      setTier(getTier(sub));
      setLoading(false);
    })();
  }, []);

  const limit = BRANCH_LIMIT[tier];
  const atLimit = limit !== null && branches.length >= limit;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_branch", {
      p_name: name.trim(),
      p_address: address.trim() || null,
    });

    setSaving(false);
    if (rpcError) {
      // Pesan dari trigger enforce_branch_limit() sudah dalam Bahasa
      // Indonesia dan langsung enak dibaca, jadi cukup diteruskan apa
      // adanya (dibuang prefix kode error teknis di depan pesan).
      setError(rpcError.message.replace(/^[A-Z_]+:\s*/, ""));
      return;
    }

    setName("");
    setAddress("");
    setShowForm(false);
    await refreshBranches();
  }

  async function toggleActive(branch: Branch) {
    setTogglingId(branch.id);
    const supabase = createClient();
    await supabase.from("branches").update({ is_active: !branch.is_active }).eq("id", branch.id);
    setTogglingId(null);
    await refreshBranches();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto mt-10">
        <Lock className="mx-auto text-neutral-300 mb-3" size={36} />
        <h2 className="font-semibold text-neutral-900 mb-1">Khusus Owner</h2>
        <p className="text-sm text-neutral-500">
          Manajemen cabang & tagihan cabang hanya bisa diatur oleh akun Owner utama.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Cabang</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Kelola semua cabang dalam 1 akun — semua cabang berada di bawah 1 tagihan Owner.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={atLimit}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
          title={atLimit ? `Paket ${TIER_LABEL[tier]} sudah mencapai batas cabang` : undefined}
        >
          <Plus size={16} /> Tambah Cabang
        </button>
      </div>

      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500">Paket Anda</p>
          <p className="font-semibold text-neutral-900">{TIER_LABEL[tier]}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-neutral-500">Cabang Terpakai</p>
          <p className="font-semibold text-neutral-900">
            {branches.length} / {limit === null ? "Tanpa Batas" : limit}
          </p>
        </div>
      </div>

      {atLimit && (
        <div className="rounded-xl bg-warning-light text-warning text-sm px-4 py-3">
          Paket <strong>{TIER_LABEL[tier]}</strong> Anda sudah mencapai batas maksimal cabang.{" "}
          <a href="/dashboard/subscription" className="underline font-medium">
            Upgrade paket
          </a>{" "}
          untuk menambah cabang lagi.
        </div>
      )}

      <div className="space-y-2">
        {branches.map((b) => (
          <div key={b.id} className="card p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                <Building2 size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-neutral-900 truncate">{b.name}</p>
                  {b.is_main && <span className="badge-active shrink-0">Cabang Utama</span>}
                </div>
                {b.address && (
                  <p className="text-xs text-neutral-400 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin size={11} /> {b.address}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={() => toggleActive(b)}
              disabled={b.is_main || togglingId === b.id}
              title={b.is_main ? "Cabang Utama tidak bisa dinonaktifkan" : "Aktifkan/nonaktifkan cabang ini"}
              className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 ${
                b.is_active ? "badge-active" : "badge-urgent"
              }`}
            >
              {togglingId === b.id ? (
                <Loader2 size={13} className="animate-spin" />
              ) : b.is_active ? (
                <CheckCircle2 size={13} />
              ) : (
                <XCircle size={13} />
              )}
              {b.is_active ? "Aktif" : "Nonaktif"}
            </button>
          </div>
        ))}
      </div>

      {showForm && (
        <Modal title="Tambah Cabang Baru" onClose={() => setShowForm(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Cabang</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Cabang Kemang"
                className="input-field"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Alamat (opsional)</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Jl. Kemang Raya No. 1, Jakarta Selatan"
                className="input-field"
              />
            </div>
            {error && <p className="text-sm text-urgent">{error}</p>}
            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Simpan Cabang
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
