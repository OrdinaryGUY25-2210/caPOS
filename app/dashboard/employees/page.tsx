"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Loader2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { ROLE_LABEL } from "@/lib/role";
import { useBranch } from "@/lib/branchContext";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import PasswordInput from "@/components/PasswordInput";
import type { Profile } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import { toast } from "@/components/Toast";

const JOB_TITLE_SUGGESTIONS = ["Kasir", "Barista", "Kasir Utama", "Asisten Manager"];

/** Label singkat status order — dipakai di peringatan pesanan aktif sebelum nonaktifkan/hapus karyawan. */
const ORDER_STATUS_LABEL: Record<string, string> = {
  NEW: "Baru Masuk",
  ACCEPTED: "Diterima Dapur",
  PREPARING: "Sedang Disiapkan",
  READY: "Siap Disajikan",
  SERVED: "Sudah Disajikan, Belum Dibayar",
};

export default function EmployeesPage() {
  const { branches } = useBranch();
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  // BARU — peringatan pesanan aktif (KDS/belum dibayar) sebelum
  // nonaktifkan/hapus karyawan, supaya Owner tahu dulu ada pesanan
  // "menggantung" atas nama karyawan itu sebelum melanjutkan.
  const [activeOrdersWarning, setActiveOrdersWarning] = useState<{
    employee: Profile;
    action: "deactivate" | "delete";
    orders: { order_number: string; status: string; table_number: string | null }[];
  } | null>(null);
  const [checkingOrders, setCheckingOrders] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [warningBusy, setWarningBusy] = useState(false);
  const [warningError, setWarningError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "", email: "", password: "", confirmPassword: "", role: "cashier", jobTitle: "", branchId: "",
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
      supabase.from("profiles").select("*").eq("tenant_id", profile.tenant_id).in("role", ["cashier", "manager", "kitchen"]).order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
    ]);
    setEmployees((data as Profile[]) ?? []);
    setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
    setLoading(false);
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  const activeEmployeeCount = employees.filter((e) => e.is_active !== false).length;
  const atLimit = tier === "free" && activeEmployeeCount >= FREE_TIER_LIMITS.maxCashiers;

  function openForm() {
    if (atLimit) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    setFormError(null);
    // Default ke Cabang Utama (atau cabang pertama yang ada) supaya Owner
    // tidak wajib klik dropdown kalau tenant cuma punya 1 cabang.
    const defaultBranch = branches.find((b) => b.is_main)?.id ?? branches[0]?.id ?? "";
    setForm((f) => ({ ...f, branchId: defaultBranch }));
    setShowForm(true);
  }

  async function addEmployee() {
    setFormError(null);
    if (form.password !== form.confirmPassword) {
      setFormError("Konfirmasi password tidak cocok.");
      return;
    }
    if (!form.branchId) {
      setFormError("Pilih cabang penugasan karyawan ini.");
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
        branchId: form.branchId,
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

    setForm({ full_name: "", email: "", password: "", confirmPassword: "", role: "cashier", jobTitle: "", branchId: "" });
    setShowForm(false);
    loadEmployees();
  }

  async function reassignBranch(empId: string, branchId: string) {
    setReassigningId(empId);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_employee_branch", { p_employee_id: empId, p_branch_id: branchId });
    setReassigningId(null);
    if (error) {
      alert("Gagal memindahkan cabang: " + error.message);
      return;
    }
    setEmployees((prev) => prev.map((e) => (e.id === empId ? { ...e, branch_id: branchId } : e)));
  }

  /** Cari pesanan yang belum selesai (KDS) ATAU belum dibayar (bill terbuka) atas nama karyawan ini — status apa pun selain COMPLETED/CANCELLED. */
  async function findActiveOrders(employeeId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("orders")
      .select("order_number, status, table_number")
      .eq("cashier_id", employeeId)
      .not("status", "in", "(COMPLETED,CANCELLED)")
      .order("created_at", { ascending: false });
    return data ?? [];
  }

  async function toggleActive(emp: Profile) {
    const next = !emp.is_active;

    // Cuma cek pesanan aktif kalau arahnya MENONAKTIFKAN (bukan
    // mengaktifkan lagi) — kalau sudah nonaktif lalu diaktifkan lagi,
    // tidak ada yang perlu diperingatkan.
    if (!next) {
      setCheckingOrders(emp.id);
      const orders = await findActiveOrders(emp.id);
      setCheckingOrders(null);
      if (orders.length > 0) {
        setActiveOrdersWarning({ employee: emp, action: "deactivate", orders });
        return;
      }
    }

    try {
      await applyToggleActive(emp, next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status karyawan.");
    }
  }

  async function applyToggleActive(emp: Profile, next: boolean) {
    const supabase = createClient();
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, is_active: next } : e)));
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", emp.id);
    if (error) {
      setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, is_active: !next } : e)));
      throw new Error(error.message);
    }
  }

  async function removeEmployee(emp: Profile) {
    setCheckingOrders(emp.id);
    const orders = await findActiveOrders(emp.id);
    setCheckingOrders(null);
    if (orders.length > 0) {
      setActiveOrdersWarning({ employee: emp, action: "delete", orders });
      return;
    }
    // Item #28 — buka dialog Confirmation dulu; eksekusi sesungguhnya
    // (Processing/Success/Error) ditangani ConfirmDialog di bawah.
    setDeleteTarget(emp);
  }

  async function applyRemoveEmployee(id: string) {
    const res = await fetch(`/api/employees?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      setLimitReached(false);
    } else {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.message || "Gagal menghapus karyawan.");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>
        <SkeletonList rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Karyawan</h1>
          <p className="text-sm text-neutral-500">
            Satu-satunya tempat untuk membuat & mengelola akun Admin, Supervisor, Kasir, dan Dapur
            {/* BUG FIX (permintaan produk): sebelumnya kuota Free Trial
                menghitung SEMUA karyawan termasuk yang sudah dinonaktifkan
                — jadi Owner tidak pernah bisa tambah karyawan baru lagi
                walau staf lama sudah resign & dinonaktifkan, kecuali
                upgrade paket. Sekarang cuma karyawan AKTIF yang dihitung,
                karena karyawan nonaktif memang sudah tidak "memakai slot"
                (tidak bisa login sama sekali lagi sejak fix is_active). */}
            {tier === "free" && <> — {activeEmployeeCount}/{FREE_TIER_LIMITS.maxCashiers} karyawan aktif (paket {TIER_LABEL.free})</>}
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
            Paket {TIER_LABEL.free} maksimal {FREE_TIER_LIMITS.maxCashiers} akun karyawan aktif. Nonaktifkan karyawan lama atau upgrade ke Pro untuk tambah karyawan.
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
                {isOwner && branches.length > 1 ? (
                  <select
                    value={e.branch_id ?? ""}
                    disabled={reassigningId === e.id}
                    onChange={(ev) => reassignBranch(e.id, ev.target.value)}
                    className="text-xs mt-1 rounded-lg border border-neutral-200 px-2 py-1 text-neutral-600 disabled:opacity-50"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Cabang: {branches.find((b) => b.id === e.branch_id)?.name ?? "-"}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => toggleActive(e)} disabled={checkingOrders === e.id} className={e.is_active ? "badge-active" : "badge-urgent"}>
                {checkingOrders === e.id ? "Mengecek..." : e.is_active ? "Active" : "Nonaktif"}
              </button>
              {isOwner && (
                <button onClick={() => removeEmployee(e)} disabled={checkingOrders === e.id} className="text-neutral-300 hover:text-urgent disabled:opacity-50">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {employees.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada akun karyawan.</p>}
      </div>

      {/* BARU — peringatan pesanan aktif sebelum nonaktifkan/hapus karyawan */}
      {activeOrdersWarning && (
        <Modal
          title="Masih Ada Pesanan Aktif"
          onClose={() => !warningBusy && (setActiveOrdersWarning(null), setWarningError(null))}
          footer={
            <div className="flex gap-2 w-full">
              <button
                onClick={() => {
                  setActiveOrdersWarning(null);
                  setWarningError(null);
                }}
                disabled={warningBusy}
                className="btn-outline flex-1 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  const { employee, action } = activeOrdersWarning;
                  setWarningError(null);
                  setWarningBusy(true);
                  try {
                    if (action === "deactivate") await applyToggleActive(employee, false);
                    else await applyRemoveEmployee(employee.id);
                    setWarningBusy(false);
                    setActiveOrdersWarning(null);
                  } catch (e) {
                    setWarningBusy(false);
                    setWarningError(e instanceof Error ? e.message : "Gagal memproses. Silakan coba lagi.");
                  }
                }}
                disabled={warningBusy}
                className="btn-primary flex-1 !bg-urgent hover:!bg-red-600 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {warningBusy && <Loader2 className="animate-spin" size={16} />}
                {activeOrdersWarning.action === "deactivate" ? "Tetap Nonaktifkan" : "Tetap Hapus"}
              </button>
            </div>
          }
        >
          <p className="text-sm text-neutral-600 mb-3">
            <strong>{activeOrdersWarning.employee.full_name}</strong> masih tercatat sebagai kasir di{" "}
            {activeOrdersWarning.orders.length} pesanan yang belum selesai/belum dibayar. Pesanan ini tetap bisa
            diselesaikan kasir lain di cabang yang sama, tapi sebaiknya dicek dulu:
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {activeOrdersWarning.orders.map((o) => (
              <div key={o.order_number} className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-neutral-900">#{o.order_number}</p>
                  <p className="text-xs text-neutral-400">{o.table_number ? `Meja ${o.table_number}` : "Tanpa meja"}</p>
                </div>
                <span className="badge-active text-xs">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
            ))}
          </div>
          {warningError && (
            <div className="mt-3 rounded-xl bg-urgent-light/60 border border-urgent/20 p-2.5 text-xs text-urgent">
              {warningError}
            </div>
          )}
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Hapus Akun Karyawan?"
          description={
            <>
              Akun <strong>{deleteTarget.full_name}</strong> akan dihapus secara permanen dan tidak bisa dibatalkan.
            </>
          }
          confirmLabel="Ya, Hapus"
          successMessage="Karyawan dihapus."
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => applyRemoveEmployee(deleteTarget.id)}
        />
      )}

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
              <option value="manager">Supervisor — akses dashboard penuh + approval</option>
              <option value="kitchen">Dapur — akses tampilan dapur (KDS) saja</option>
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
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Cabang Penugasan</label>
            <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="input-field">
              <option value="">Pilih cabang...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.is_main ? " (Utama)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-400 mt-1">
              Karyawan ini hanya bisa mengakses & bertransaksi di cabang yang dipilih.
            </p>
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
