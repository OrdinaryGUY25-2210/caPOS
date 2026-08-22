"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";
import type { Profile } from "@/lib/types";

export default function CashiersPage() {
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });

  async function loadCashiers() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .eq("role", "cashier")
      .order("created_at", { ascending: false });
    setCashiers((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCashiers();
  }, []);

  async function addCashier() {
    setFormError(null);
    setSaving(true);
    const res = await fetch("/api/cashiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: form.full_name, email: form.email, password: form.password }),
    });
    const result = await res.json();
    setSaving(false);

    if (!res.ok) {
      setFormError(result.message || "Gagal membuat akun kasir.");
      return;
    }

    setForm({ full_name: "", email: "", password: "" });
    setShowForm(false);
    loadCashiers();
  }

  async function toggleActive(cashier: Profile) {
    const supabase = createClient();
    const next = !cashier.is_active;
    setCashiers((prev) => prev.map((c) => (c.id === cashier.id ? { ...c, is_active: next } : c)));
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", cashier.id);
    if (error) {
      setCashiers((prev) => prev.map((c) => (c.id === cashier.id ? { ...c, is_active: !next } : c)));
    }
  }

  async function removeCashier(id: string) {
    if (!confirm("Hapus akun kasir ini secara permanen?")) return;
    const res = await fetch(`/api/cashiers?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setCashiers((prev) => prev.filter((c) => c.id !== id));
    } else {
      const result = await res.json();
      alert(result.message || "Gagal menghapus kasir.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data kasir...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Kasir</h1>
          <p className="text-sm text-neutral-500">Kelola akun staf kasir kafe Anda</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Tambah Kasir
        </button>
      </div>

      <div className="card divide-y divide-neutral-100">
        {cashiers.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-light text-primary-dark flex items-center justify-center font-bold text-sm">
                {(c.full_name || c.email || "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{c.full_name}</p>
                <p className="text-xs text-neutral-500">{c.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleActive(c)}
                className={c.is_active ? "badge-active" : "badge-urgent"}
              >
                {c.is_active ? "Active" : "Nonaktif"}
              </button>
              <button onClick={() => removeCashier(c.id)} className="text-neutral-300 hover:text-urgent">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {cashiers.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada akun kasir.</p>}
      </div>

      {showForm && (
        <Modal
          title="Tambah Akun Kasir"
          onClose={() => setShowForm(false)}
          footer={
            <button
              disabled={saving}
              onClick={addCashier}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={16} />}
              Buat Akun Kasir
            </button>
          }
        >
          {formError && (
            <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{formError}</div>
          )}
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Lengkap</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field" maxLength={80} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Password Sementara</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input-field" minLength={8} />
            <p className="text-xs text-neutral-400 mt-1">Minimal 8 karakter, kombinasi huruf & angka.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
