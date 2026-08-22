"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Plus, Copy, LogOut, Loader2 } from "lucide-react";
import { cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";

interface TenantRow {
  id: string;
  name: string;
  status: "trial" | "active" | "past_due" | "expired";
  hasCustomWebsite: boolean;
  createdAt: string;
}

interface CodeRow {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
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
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", maxUses: 100 });

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    // RLS mengizinkan super_admin melihat SEMUA tenant lewat is_super_admin()
    // — bukan karena query ini spesial, tapi karena kebijakan di schema.sql.
    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("id, name, has_custom_website, created_at, subscriptions(status)")
      .order("created_at", { ascending: false });

    setTenants(
      (tenantRows ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        hasCustomWebsite: t.has_custom_website,
        createdAt: new Date(t.created_at).toLocaleDateString("id-ID"),
        status: t.subscriptions?.[0]?.status ?? "trial",
      }))
    );

    const { data: codeRows } = await supabase
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });

    setCodes(
      (codeRows ?? []).map((c) => ({
        id: c.id,
        code: c.code,
        maxUses: c.max_uses,
        usedCount: c.used_count,
        isActive: c.is_active,
      }))
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createCode() {
    setCodeError(null);
    const codeValue = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(codeValue)) {
      setCodeError("Kode harus 4-32 karakter: huruf/angka/-/_ saja.");
      return;
    }
    if (form.maxUses < 1 || form.maxUses > 100) {
      setCodeError("Maksimal penggunaan harus antara 1-100.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("invite_codes").insert({
      code: codeValue,
      max_uses: form.maxUses,
    });
    setSaving(false);

    if (error) {
      setCodeError(error.message.includes("duplicate") ? "Kode ini sudah ada." : "Gagal membuat kode.");
      return;
    }

    setForm({ code: "", maxUses: 100 });
    setShowCodeForm(false);
    loadData();
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data admin...
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
        <section>
          <h1 className="text-lg font-bold text-neutral-900 mb-1">Daftar Tenant Kafe</h1>
          <p className="text-sm text-neutral-500 mb-4">Akses tak terbatas ke seluruh tenant untuk keperluan demo & konten</p>
          <div className="card divide-y divide-neutral-100">
            {tenants.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-neutral-900 text-sm">{t.name}</p>
                  <p className="text-xs text-neutral-400">Terdaftar {t.createdAt} {t.hasCustomWebsite && "· Website Custom Active"}</p>
                </div>
                <span className={STATUS_STYLE[t.status]}>{t.status.replace("_", " ")}</span>
              </div>
            ))}
            {tenants.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada tenant terdaftar.</p>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-neutral-900">Kode Akses Registrasi</h1>
              <p className="text-sm text-neutral-500">Kuota trial dibatasi maksimal 100 pendaftaran per kode</p>
            </div>
            <button onClick={() => setShowCodeForm(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} /> Generate Kode
            </button>
          </div>

          <div className="card divide-y divide-neutral-100">
            {codes.map((c) => {
              const pct = Math.min(100, Math.round((c.usedCount / c.maxUses) * 100));
              return (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-neutral-900">{c.code}</span>
                      <button onClick={() => copyCode(c.code)} className="text-neutral-400 hover:text-primary">
                        <Copy size={13} />
                      </button>
                    </div>
                    <span className={c.isActive ? "badge-active" : "badge-urgent"}>
                      {c.isActive ? "Active" : "Kuota Penuh"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={cx("h-full rounded-full", pct >= 100 ? "bg-urgent" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-neutral-500 font-mono">{c.usedCount}/{c.maxUses}</span>
                  </div>
                </div>
              );
            })}
            {codes.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada kode akses.</p>}
          </div>
        </section>
      </div>

      {showCodeForm && (
        <Modal
          title="Generate Kode Akses"
          onClose={() => setShowCodeForm(false)}
          footer={
            <button
              disabled={saving}
              onClick={createCode}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={16} />}
              Buat Kode
            </button>
          }
        >
          {codeError && (
            <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{codeError}</div>
          )}
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Kode</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="CAPOSVIRAL2"
              className="input-field font-mono uppercase"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Maksimal Penggunaan</label>
            <input
              type="number"
              max={100}
              min={1}
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: Math.min(100, Number(e.target.value)) })}
              className="input-field"
            />
            <p className="text-xs text-neutral-400 mt-1">Kuota trial massal dibatasi maksimal 100 tenant.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
