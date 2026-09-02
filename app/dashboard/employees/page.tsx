"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Loader2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { ROLE_LABEL } from "@/lib/role";
import Modal from "@/components/Modal";
import PasswordInput from "@/components/PasswordInput";
import type { Profile } from "@/lib/types";

const JOB_TITLE_SUGGESTIONS = ["Kasir", "Barista", "Kasir Utama", "Asisten Manager"];

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [form, setForm] = useState({
    full_name: "", email: "", password: "", confirmPassword: "", role: "cashier", jobTitle: "",
  });

  async function loadEmployees() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setIsOwner(profile.role === "owner" || profile.role === "super_admin");

    const supabase = createClient();
    const [{ data }, { data: sub }] = await Promise.all([
      supabase.from("profiles").select("*").eq("tenant_id", profile.tenant_id).in("role", ["cashier", "manager"]).order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
    ]);
    setEmployees((data as Profile[]) ?? []);
    setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
    setLoading(false);
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  const atLimit = tier === "free" && employees.length >= FREE_TIER_LIMITS.maxCashiers;

  function openForm() {
    if (atLimit) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    setFormError(null);
    setShowForm(true);
  }

  async function addEmployee() {
    setFormError(null);
    if (form.password !== form.confirmPassword) {
      setFormError("Konfirmasi password tidak cocok.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.full_name,
        email: form.email,
        password: form.password,
        confirmPassword: form.confirmPassword,
        role: form.role,
        jobTitle: form.jobTitle,
      }),
    });
    const result = await res.json();
    setSaving(false);

    if (!res.ok) {
      if (result.reason === "FREE_TIER_CASHIER_LIMIT") {
        setShowForm(false);
        setLimitReached(true);
      } else {
        setFormError(result.message || "Gagal membuat akun karyawan.");
      }
      return;
    }

    setForm({ full_name: "", email: "", password: "", confirmPassword: "", role: "cashier", jobTitle: "" });
    setShowForm(false);
    loadEmployees();
  }

  async function toggleActive(emp: Profile) {
    const supabase = createClient();
    const next = !emp.is_active;
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, is_active: next } : e)));
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", emp.id);
    if (error) setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, is_active: !next } : e)));
  }

  async function removeEmployee(id: string) {
    if (!confirm("Hapus akun karyawan ini secara permanen?")) return;
    const res = await fetch(`/api/employees?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      setLimitReached(false);
    } else {
      const result = await res.json();
      alert(result.message || "Gagal menghapus karyawan.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data karyawan...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Karyawan</h1>
          <p className="text-sm text-neutral-500">
            Kelola akun Manager & Kasir kafe Anda
            {tier === "free" && <> — {employees.length}/{FREE_TIER_LIMITS.maxCashiers} karyawan terpakai (paket {TIER_LABEL.free})</>}
          </p>
        </div>
        {isOwner && (
          <button onClick={openForm} className="btn-primary flex items-center gap-2">
            {atLimit ? <Lock size={16} /> : <Plus size={16} />} Tambah Karyawan
          </button>
        )}
      </div>

      {limitReached && (
        <div className="card p-4 flex items-center justify-between gap-3 border-warning bg-warning-light">
          <p className="text-sm text-neutral-800">
            Paket {TIER_LABEL.free} maksimal {FREE_TIER_LIMITS.maxCashiers} akun karyawan tambahan. Upgrade ke Pro untuk unlimited.
          </p>
          <Link href="/dashboard/subscription" className="btn-primary text-sm whitespace-nowrap">Lihat Paket</Link>
        </div>
      )}

      <div className="card divide-y divide-neutral-100">
        {employees.map((e) => (
          <div key={e.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-light text-primary-dark flex items-center justify-center font-bold text-sm">
                {(e.full_name || e.email || "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{e.full_name}</p>
                <p className="text-xs text-neutral-500">
                  {e.email} · <span className="font-medium">{ROLE_LABEL[e.role]}</span>
                  {e.job_title && <> · {e.job_title}</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => toggleActive(e)} className={e.is_active ? "badge-active" : "badge-urgent"}>
                {e.is_active ? "Active" : "Nonaktif"}
              </button>
              {isOwner && (
                <button onClick={() => removeEmployee(e.id)} className="text-neutral-300 hover:text-urgent">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {employees.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada akun karyawan.</p>}
      </div>

      {showForm && (
        <Modal
          title="Tambah Karyawan"
          onClose={() => setShowForm(false)}
          footer={
            <button disabled={saving} onClick={addEmployee} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving && <Loader2 className="animate-spin" size={16} />}
              Buat Akun Karyawan
            </button>
          }
        >
          {formError && <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{formError}</div>}

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Lengkap</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field" maxLength={80} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Jabatan/Role Sistem</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field">
              <option value="cashier">Kasir — akses POS saja</option>
              <option value="manager">Manager — akses dashboard penuh + approval</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Jabatan (label bebas, opsional)</label>
            <input
              list="job-title-suggestions"
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              placeholder="mis. Barista"
              className="input-field"
            />
            <datalist id="job-title-suggestions">
              {JOB_TITLE_SUGGESTIONS.map((j) => <option key={j} value={j} />)}
            </datalist>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Password</label>
            <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} minLength={8} autoComplete="new-password" />
            <p className="text-xs text-neutral-400 mt-1">Minimal 8 karakter, kombinasi huruf & angka. Ini password ASLI karyawan, bukan sementara.</p>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Konfirmasi Password</label>
            <PasswordInput value={form.confirmPassword} onChange={(v) => setForm({ ...form, confirmPassword: v })} minLength={8} autoComplete="new-password" />
          </div>
        </Modal>
      )}
    </div>
  );
}
