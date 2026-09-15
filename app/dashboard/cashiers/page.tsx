"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Radio, CircleDot, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { cx } from "@/lib/utils";

/**
 * Manajemen Kasir — MIGRATION_16: halaman ini TIDAK LAGI membuat/mengedit
 * akun. Manajemen Karyawan (/dashboard/employees) adalah satu-satunya
 * Single Source of Truth untuk membuat & mengelola semua akun/peran
 * (Admin, Supervisor, Kasir, Dapur) — lihat migration_16.sql bagian A.
 *
 * Halaman ini murni MONITORING: siapa saja kasir yang sedang bertugas
 * (shift status = open) saat ini, dibaca dari view v_active_cashier_shifts.
 */
interface ShiftRow {
  cashier_id: string;
  full_name: string | null;
  email: string | null;
  branch_name: string | null;
  account_active: boolean;
  shift_id: string | null;
  opened_at: string | null;
  is_on_shift: boolean;
}

export default function CashiersMonitorPage() {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("v_active_cashier_shifts")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("is_on_shift", { ascending: false })
      .order("full_name", { ascending: true });
    setRows((data as ShiftRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Refresh berkala supaya status shift (buka/tutup) terasa "live" tanpa
    // perlu reload manual — cocok untuk dipantau sambil berjalan sepanjang hari.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const onShiftCount = rows.filter((r) => r.is_on_shift).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat status kasir...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Kasir</h1>
          <p className="text-sm text-neutral-500">
            Monitoring kasir yang sedang bertugas (shift aktif). Untuk membuat, mengedit, atau menghapus akun kasir,
            gunakan{" "}
            <Link href="/dashboard/employees" className="text-primary font-medium hover:underline">
              Manajemen Karyawan
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-primary-light text-primary-dark px-4 py-2 text-sm font-semibold">
          <Radio size={16} /> {onShiftCount} kasir sedang bertugas
        </div>
      </div>

      <div className="card divide-y divide-neutral-100">
        {rows.map((r) => (
          <div key={r.cashier_id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-light text-primary-dark flex items-center justify-center font-bold text-sm">
                {(r.full_name || r.email || "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{r.full_name}</p>
                <p className="text-xs text-neutral-500">
                  {r.email} · Cabang: {r.branch_name ?? "-"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!r.account_active && <span className="badge-urgent">Akun Nonaktif</span>}
              {r.is_on_shift ? (
                <span className="flex items-center gap-1.5 badge-active">
                  <CircleDot size={12} className="animate-pulse" /> Shift Aktif
                  {r.opened_at && (
                    <span className="font-normal opacity-80">
                      · sejak {new Date(r.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </span>
              ) : (
                <span className={cx("text-xs px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-500")}>Tidak Bertugas</span>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-6 text-center text-neutral-400 text-sm flex flex-col items-center gap-2">
            <Users size={24} className="text-neutral-300" />
            Belum ada akun kasir. Tambahkan lewat halaman Manajemen Karyawan.
          </p>
        )}
      </div>
    </div>
  );
}
