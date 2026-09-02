"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, Check, X, CalendarCheck } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner } from "@/lib/role";

interface AttendanceRow {
  id: string;
  type: string;
  date_start: string;
  date_end: string;
  reason: string | null;
  status: string;
  employee_name: string | null;
}

interface EmployeeOption {
  id: string;
  full_name: string | null;
}

const TYPE_LABEL: Record<string, string> = { izin: "Izin", sakit: "Sakit", cuti: "Cuti" };
const STATUS_STYLE: Record<string, string> = { pending: "badge-warning", approved: "badge-active", rejected: "badge-urgent" };

export default function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: "", type: "izin", date_start: "", date_end: "", reason: "" });

  async function loadData() {
    setLoading(true);
    const { profile, userId } = await getCurrentProfile();
    if (!profile || !userId) {
      setLoading(false);
      return;
    }
    const canReviewNow = isManagerOrOwner(profile.role) || profile.role === "super_admin";
    setCanReview(canReviewNow);
    setMyId(userId);
    setForm((f) => ({ ...f, employee_id: userId }));

    const supabase = createClient();
    const queries: any[] = [
      supabase
        .from("attendance")
        .select("id, type, date_start, date_end, reason, status, profiles(full_name)")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false }),
    ];
    // Manager/Owner boleh catatkan untuk karyawan lain — perlu daftar
    // nama karyawan tenant ini untuk dipilih di form.
    if (canReviewNow) {
      queries.push(
        supabase.from("profiles").select("id, full_name").eq("tenant_id", profile.tenant_id).order("full_name")
      );
    }
    const [{ data: attendanceData }, empResult] = await Promise.all(queries);

    setRows(
      (attendanceData ?? []).map((r: any) => ({
        id: r.id,
        type: r.type,
        date_start: r.date_start,
        date_end: r.date_end,
        reason: r.reason,
        status: r.status,
        employee_name: r.profiles?.full_name ?? null,
      }))
    );
    if (empResult?.data) setEmployees(empResult.data);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function submitRequest() {
    setSaving(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setSaving(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("attendance").insert({
      tenant_id: profile.tenant_id,
      employee_id: form.employee_id || myId,
      type: form.type,
      date_start: form.date_start,
      date_end: form.date_end || form.date_start,
      reason: form.reason || null,
    });
    setSaving(false);
    if (error) {
      alert("Gagal mengajukan: " + error.message);
      return;
    }
    setForm((f) => ({ ...f, type: "izin", date_start: "", date_end: "", reason: "" }));
    setShowForm(false);
    loadData();
  }

  async function review(id: string, approve: boolean) {
    const supabase = createClient();
    const { error } = await supabase
      .from("attendance")
      .update({ status: approve ? "approved" : "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      alert("Gagal memproses: " + error.message);
      return;
    }
    loadData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data kehadiran...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Kehadiran Karyawan</h1>
          <p className="text-sm text-neutral-500">
            {canReview ? "Catat & tinjau pengajuan izin/sakit/cuti karyawan" : "Ajukan izin, sakit, atau cuti"}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> {canReview ? "Catat Kehadiran" : "Ajukan"}
        </button>
      </div>

      <div className="card divide-y divide-neutral-100">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-4 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                <CalendarCheck size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900">
                  {r.employee_name ?? "Karyawan"} — {TYPE_LABEL[r.type] ?? r.type}
                </p>
                <p className="text-xs text-neutral-400 truncate">
                  {r.date_start === r.date_end ? r.date_start : `${r.date_start} s/d ${r.date_end}`}
                  {r.reason && <> · {r.reason}</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={STATUS_STYLE[r.status]}>{r.status}</span>
              {canReview && r.status === "pending" && (
                <>
                  <button onClick={() => review(r.id, true)} className="text-primary hover:bg-primary-light p-1.5 rounded-lg"><Check size={16} /></button>
                  <button onClick={() => review(r.id, false)} className="text-urgent hover:bg-urgent-light p-1.5 rounded-lg"><X size={16} /></button>
                </>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada pengajuan kehadiran.</p>}
      </div>

      {showForm && (
        <Modal
          title={canReview ? "Catat Kehadiran Karyawan" : "Ajukan Izin/Sakit/Cuti"}
          onClose={() => setShowForm(false)}
          footer={
            <button disabled={saving || !form.date_start} onClick={submitRequest} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving && <Loader2 className="animate-spin" size={16} />} Simpan
            </button>
          }
        >
          {canReview && (
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Karyawan</label>
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="input-field">
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.full_name || "(tanpa nama)"}{emp.id === myId ? " (saya)" : ""}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Jenis</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-field">
              <option value="izin">Izin</option>
              <option value="sakit">Sakit</option>
              <option value="cuti">Cuti</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Tanggal Mulai</label>
            <input type="date" value={form.date_start} onChange={(e) => setForm({ ...form, date_start: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Tanggal Selesai (opsional)</label>
            <input type="date" value={form.date_end} onChange={(e) => setForm({ ...form, date_end: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan</label>
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="input-field" rows={3} />
          </div>
        </Modal>
      )}
    </div>
  );
}
