"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Phone, Users, Wallet, Check, X as XIcon, LogIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { formatRupiah, cx } from "@/lib/utils";
import type { BranchTable, ReservationCalendarRow, ReservationStatus } from "@/lib/types";
import ReservationFormModal from "@/components/reservations/ReservationFormModal";
import TableStatusBoard from "@/components/tables/TableStatusBoard";

const STATUS_STYLE: Record<ReservationStatus, string> = {
  pending: "bg-warning-light text-warning",
  confirmed: "bg-primary-light text-primary",
  seated: "bg-neutral-900 text-white",
  completed: "bg-neutral-100 text-neutral-500",
  cancelled: "bg-urgent-light text-urgent",
  no_show: "bg-urgent-light text-urgent",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Menunggu Konfirmasi",
  confirmed: "Terkonfirmasi",
  seated: "Sudah Datang",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  no_show: "Tidak Datang",
};

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReservationsPage() {
  const { selectedBranchId, branches } = useBranch();
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [reservations, setReservations] = useState<ReservationCalendarRow[]>([]);
  const [tables, setTables] = useState<BranchTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const effectiveBranchId = selectedBranchId === ALL_BRANCHES ? branches[0]?.id : selectedBranchId;

  useEffect(() => {
    if (!effectiveBranchId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId, date]);

  async function load() {
    setLoading(true);
    const supabase = createClient();

    const dayStart = new Date(`${date}T00:00:00`).toISOString();
    const dayEnd = new Date(`${date}T23:59:59`).toISOString();

    const [{ data: res }, { data: tbl }] = await Promise.all([
      supabase
        .from("reservation_calendar")
        .select("*")
        .eq("branch_id", effectiveBranchId)
        .gte("reservation_at", dayStart)
        .lte("reservation_at", dayEnd)
        .order("reservation_at", { ascending: true }),
      supabase.from("branch_tables").select("*").eq("branch_id", effectiveBranchId).eq("is_active", true),
    ]);

    setReservations((res as ReservationCalendarRow[]) ?? []);
    setTables((tbl as BranchTable[]) ?? []);
    setLoading(false);
  }

  async function updateStatus(id: string, status: ReservationStatus, tableId?: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("update_reservation_status", {
      p_reservation_id: id,
      p_new_status: status,
      p_table_id: tableId ?? null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  async function seat(id: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("seat_reservation", { p_reservation_id: id });
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  function shiftDate(days: number) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    setDate(toDateInput(d));
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Reservasi Meja</h1>
          <p className="text-sm text-neutral-500 mt-1">Kalender & timeline reservasi harian per cabang.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary text-white text-sm font-medium rounded-xl px-4 py-2.5"
        >
          <Plus size={16} /> Reservasi Baru
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 mb-6 bg-white rounded-2xl border border-neutral-200 p-3">
        <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg hover:bg-neutral-100">
          <ChevronLeft size={18} />
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm font-semibold text-neutral-900 border-none focus:outline-none" />
        <button onClick={() => shiftDate(1)} className="p-2 rounded-lg hover:bg-neutral-100">
          <ChevronRight size={18} />
        </button>
      </div>

      {effectiveBranchId && <TableStatusBoard branchId={effectiveBranchId} />}

      {loading ? (
        <p className="text-center text-sm text-neutral-400 py-10">Memuat...</p>
      ) : reservations.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-10">Tidak ada reservasi di tanggal ini.</p>
      ) : (
        <div className="space-y-3">
          {reservations.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-neutral-900 text-sm">
                    {new Date(r.reservation_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · {r.customer_name}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Users size={12} /> {r.party_size} tamu
                    </span>
                    <span className="flex items-center gap-1">
                      <Phone size={12} /> {r.customer_phone}
                    </span>
                    {r.table_number && <span>Meja {r.table_number}</span>}
                    {r.deposit_amount > 0 && (
                      <span className="flex items-center gap-1">
                        <Wallet size={12} /> DP {formatRupiah(r.deposit_amount)} ({r.deposit_status})
                      </span>
                    )}
                  </div>
                  {r.notes && <p className="text-xs text-neutral-400 mt-1 italic">"{r.notes}"</p>}
                </div>
                <span className={cx("text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0", STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {r.status === "pending" && (
                  <>
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && updateStatus(r.id, "confirmed", e.target.value)}
                      className="text-xs border border-neutral-200 rounded-lg px-2 py-1.5"
                    >
                      <option value="" disabled>
                        Pilih meja &amp; konfirmasi
                      </option>
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          Meja {t.table_number}
                        </option>
                      ))}
                    </select>
                    <ActionBtn onClick={() => updateStatus(r.id, "cancelled")} icon={XIcon} label="Tolak" tone="urgent" />
                  </>
                )}
                {r.status === "confirmed" && (
                  <>
                    <ActionBtn onClick={() => seat(r.id)} icon={LogIn} label="Tamu Tiba (Check-in)" tone="primary" />
                    <ActionBtn onClick={() => updateStatus(r.id, "cancelled")} icon={XIcon} label="Batalkan" tone="urgent" />
                  </>
                )}
                {r.status === "seated" && (
                  <ActionBtn onClick={() => updateStatus(r.id, "completed")} icon={Check} label="Selesaikan" tone="primary" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && effectiveBranchId && (
        <ReservationFormModal
          branchId={effectiveBranchId}
          tables={tables}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ActionBtn({
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  onClick: () => void;
  icon: any;
  label: string;
  tone: "primary" | "urgent";
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5",
        tone === "primary" ? "bg-primary text-white" : "bg-urgent-light text-urgent"
      )}
    >
      <Icon size={13} /> {label}
    </button>
  );
}
