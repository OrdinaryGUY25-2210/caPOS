"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BranchTable } from "@/lib/types";

export default function ReservationFormModal({
  branchId,
  tables,
  onClose,
  onSaved,
}: {
  branchId: string;
  tables: BranchTable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("19:00");
  const [partySize, setPartySize] = useState("2");
  const [tableId, setTableId] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !phone.trim() || !date || !time) {
      setErrorMsg("Lengkapi nama, no. WhatsApp, tanggal, dan jam.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);

    const supabase = createClient();
    const { error } = await supabase.rpc("create_reservation", {
      p_branch_id: branchId,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_reservation_at: new Date(`${date}T${time}:00`).toISOString(),
      p_party_size: Number(partySize),
      p_deposit_amount: Number(deposit) || 0,
      p_notes: notes || null,
      p_table_id: tableId || null,
    });

    setSaving(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-neutral-900">Reservasi Baru</p>
          <button onClick={onClose} className="text-neutral-400">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600">Nama Pelanggan</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mtinput" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">No. WhatsApp</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mtinput" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-600">Tanggal</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mtinput" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600">Jam</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mtinput" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-600">Jumlah Tamu</label>
              <input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} className="mtinput" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600">DP (Rp)</label>
              <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="mtinput" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Alokasi Meja (opsional)</label>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)} className="mtinput">
              <option value="">Belum ditentukan</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  Meja {t.table_number} ({t.capacity} kursi)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Catatan</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mtinput resize-none" />
          </div>
        </div>

        {errorMsg && <p className="text-xs text-urgent mt-3">{errorMsg}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          Simpan Reservasi
        </button>

        <style jsx global>{`
          .mtinput {
            width: 100%;
            margin-top: 0.25rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.75rem;
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
          }
        `}</style>
      </div>
    </div>
  );
}
