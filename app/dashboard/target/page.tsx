"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Target, Loader2, TrendingUp, TrendingDown, Pencil } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";
import { Skeleton, SkeletonStatGrid } from "@/components/Skeleton";

const MONTH_LABEL = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

interface DayPoint { day: number; omzet: number }
interface HistoryRow { year: number; month: number; target: number; actual: number }

export default function TargetPage() {
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [target, setTarget] = useState<number>(0);
  const [dayPoints, setDayPoints] = useState<DayPoint[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDate = now.getDate();

  const achieved = useMemo(() => dayPoints.reduce((s, d) => s + d.omzet, 0), [dayPoints]);
  const progressPct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const remainingDays = Math.max(1, daysInMonth - todayDate + 1);
  const remainingAmount = Math.max(0, target - achieved);
  const dailyPaceNeeded = target > 0 ? Math.ceil(remainingAmount / remainingDays) : 0;
  const onTrack = target === 0 ? null : achieved / Math.max(1, todayDate) >= target / daysInMonth;

  async function loadAll() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setIsOwner(profile.role === "owner" || profile.role === "manager" || profile.role === "super_admin");

    const supabase = createClient();

    const monthStart = new Date(year, month - 1, 1);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    const [{ data: targetRow }, { data: dailyRows }, { data: targetHistory }] = await Promise.all([
      supabase
        .from("monthly_targets")
        .select("target_amount")
        .eq("tenant_id", profile.tenant_id)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),
      supabase
        .from("daily_sales_analytics")
        .select("sale_date, total_revenue")
        .eq("tenant_id", profile.tenant_id)
        .gte("sale_date", monthStartStr),
      supabase
        .from("monthly_targets")
        .select("year, month, target_amount")
        .eq("tenant_id", profile.tenant_id)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(6),
    ]);

    setTarget(targetRow?.target_amount ? Number(targetRow.target_amount) : 0);

    const points: DayPoint[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const found = (dailyRows ?? []).find((r: any) => r.sale_date === dateStr);
      points.push({ day: d, omzet: found ? Number(found.total_revenue) : 0 });
    }
    setDayPoints(points);

    // Ambil omzet aktual tiap bulan di history lewat daily_sales_analytics
    // (dibatasi ke bulan-bulan yang punya target supaya query tetap ringan).
    const historyRows: HistoryRow[] = [];
    for (const row of targetHistory ?? []) {
      const hYear = row.year;
      const hMonth = row.month;
      const start = new Date(hYear, hMonth - 1, 1).toISOString().slice(0, 10);
      const end = new Date(hYear, hMonth, 0).toISOString().slice(0, 10);
      const { data: monthRows } = await supabase
        .from("daily_sales_analytics")
        .select("total_revenue")
        .eq("tenant_id", profile.tenant_id)
        .gte("sale_date", start)
        .lte("sale_date", end);
      const actual = (monthRows ?? []).reduce((s: number, r: any) => s + Number(r.total_revenue), 0);
      historyRows.push({ year: hYear, month: hMonth, target: Number(row.target_amount), actual });
    }
    setHistory(historyRows);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTarget(amount: number) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_monthly_target", {
      p_year: year,
      p_month: month,
      p_target_amount: amount,
    });
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan target: " + error.message);
      return;
    }
    setShowForm(false);
    loadAll();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3 w-full rounded-full" />
        </div>
        <SkeletonStatGrid count={3} />
        <div className="card p-5 space-y-4">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const dailyTargetLine = target > 0 ? target / daysInMonth : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Target Bulanan Owner</h1>
          <p className="text-sm text-neutral-500">{MONTH_LABEL[month - 1]} {year}</p>
        </div>
        {isOwner && (
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
            <Pencil size={16} /> {target > 0 ? "Ubah Target" : "Atur Target"}
          </button>
        )}
      </div>

      {target === 0 ? (
        <div className="card p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
            <Target className="text-primary-dark" size={22} />
          </div>
          <div>
            <p className="font-semibold text-neutral-900">Belum ada target bulan ini</p>
            <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto">
              Atur target omzet bulan {MONTH_LABEL[month - 1]} supaya progres tercapai/tidaknya bisa dipantau di sini.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-neutral-500">Progres Omzet vs Target</p>
              <span className="font-bold text-neutral-900">{progressPct}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className={cx("h-full rounded-full", progressPct >= 100 ? "bg-primary" : progressPct >= 60 ? "bg-primary" : "bg-warning")}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-neutral-500 mt-2">
              <span>{formatRupiah(achieved)} tercapai</span>
              <span>Target {formatRupiah(target)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-5">
              <p className="text-sm text-neutral-500">Sisa Target</p>
              <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(remainingAmount)}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-neutral-500">Perlu / Hari (sisa {remainingDays} hari)</p>
              <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(dailyPaceNeeded)}</p>
            </div>
            <div className="card p-5 flex items-center gap-3">
              {onTrack ? (
                <TrendingUp className="text-primary-dark shrink-0" size={28} />
              ) : (
                <TrendingDown className="text-urgent shrink-0" size={28} />
              )}
              <div>
                <p className="text-sm text-neutral-500">Status Pace</p>
                <p className={cx("font-bold", onTrack ? "text-primary-dark" : "text-urgent")}>
                  {onTrack ? "Sesuai Jalur" : "Perlu Dikejar"}
                </p>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-neutral-900 mb-4">Omzet Harian vs Target Harian</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dayPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="day" stroke="#64748B" fontSize={11} />
                <YAxis stroke="#64748B" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip formatter={(v: number) => formatRupiah(v)} labelFormatter={(d) => `Tanggal ${d}`} />
                <ReferenceLine y={dailyTargetLine} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: "Target/hari", position: "insideTopRight", fontSize: 11, fill: "#F59E0B" }} />
                <Bar dataKey="omzet" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {history.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="p-4 border-b border-neutral-100">
            <h2 className="font-semibold text-neutral-900">Riwayat Target vs Realisasi</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="p-3 font-medium">Bulan</th>
                <th className="p-3 font-medium">Target</th>
                <th className="p-3 font-medium">Realisasi</th>
                <th className="p-3 font-medium">Capaian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {history.map((h) => {
                const pct = h.target > 0 ? Math.round((h.actual / h.target) * 100) : 0;
                return (
                  <tr key={`${h.year}-${h.month}`}>
                    <td className="p-3">{MONTH_LABEL[h.month - 1]} {h.year}</td>
                    <td className="p-3">{formatRupiah(h.target)}</td>
                    <td className="p-3">{formatRupiah(h.actual)}</td>
                    <td className="p-3">
                      <span className={pct >= 100 ? "badge-active" : "badge-warning"}>{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <TargetFormModal
          initial={target}
          saving={saving}
          monthLabel={`${MONTH_LABEL[month - 1]} ${year}`}
          onClose={() => setShowForm(false)}
          onSave={saveTarget}
        />
      )}
    </div>
  );
}

function TargetFormModal({
  initial,
  saving,
  monthLabel,
  onClose,
  onSave,
}: {
  initial: number;
  saving: boolean;
  monthLabel: string;
  onClose: () => void;
  onSave: (amount: number) => void;
}) {
  const [input, setInput] = useState(initial > 0 ? String(initial) : "");
  const amount = input === "" ? 0 : Number(input);

  return (
    <Modal
      title={`Target Omzet — ${monthLabel}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving || amount <= 0}
          onClick={() => onSave(amount)}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Target
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Target Omzet Bulan Ini</label>
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="Contoh: 30000000"
          className="input-field"
          autoFocus
        />
      </div>
    </Modal>
  );
}
