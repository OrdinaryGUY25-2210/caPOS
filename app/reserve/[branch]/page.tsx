"use client";

import { useEffect, useState } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Loader2, CalendarCheck, CheckCircle2 } from "lucide-react";
import { formatRupiah } from "@/lib/utils";

/**
 * Form reservasi publik — capos.id/reserve/[branch_slug]. Tidak butuh
 * login (lihat middleware.ts). Memanggil get_branch_public_info() lalu
 * create_reservation() lewat anon key — status awal 'pending' menunggu
 * konfirmasi Manager/Owner (lihat phase4_schema.sql bagian 2b).
 */
export default function PublicReservationPage({ params }: { params: { branch: string } }) {
  const [branch, setBranch] = useState<{ id: string; name: string; address: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [deposit, setDeposit] = useState("0");
  const [notes, setNotes] = useState("");

  const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_branch_public_info", { p_branch_slug: params.branch });
      if (!data || data.error) {
        setNotFound(true);
      } else {
        setBranch(data);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.branch]);

  async function submit() {
    if (!branch) return;
    if (!name.trim() || !phone.trim() || !date || !time) {
      setErrorMsg("Lengkapi nama, no. WhatsApp, tanggal, dan jam reservasi.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);

    const reservationAt = new Date(`${date}T${time}:00`).toISOString();
    const { error } = await supabase.rpc("create_reservation", {
      p_branch_id: branch.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_reservation_at: reservationAt,
      p_party_size: Number(partySize),
      p_deposit_amount: Number(deposit) || 0,
      p_notes: notes || null,
      p_table_id: null,
    });

    setSubmitting(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setDone(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-300" size={28} />
      </div>
    );
  }

  if (notFound || !branch) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6 text-center">
        <p className="text-neutral-500 text-sm">Halaman reservasi tidak ditemukan.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6 text-center">
        <div>
          <CheckCircle2 className="text-primary mx-auto mb-3" size={44} />
          <h1 className="font-bold text-neutral-900 text-lg">Reservasi Terkirim!</h1>
          <p className="text-sm text-neutral-500 mt-2 max-w-xs">
            Tim {branch.name} akan menghubungi Anda lewat WhatsApp untuk konfirmasi jadwal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <CalendarCheck className="text-primary mx-auto mb-2" size={32} />
          <h1 className="font-bold text-neutral-900 text-lg">Reservasi Meja — {branch.name}</h1>
          {branch.address && <p className="text-xs text-neutral-500 mt-1">{branch.address}</p>}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
          <Field label="Nama Lengkap">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Nama Anda" />
          </Field>
          <Field label="No. WhatsApp">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="08xxxxxxxxxx" inputMode="tel" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tanggal">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </Field>
            <Field label="Jam">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
            </Field>
          </div>
          <Field label="Jumlah Tamu">
            <input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} className="input" />
          </Field>
          <Field label="Uang Muka / DP (opsional)">
            <input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="input" />
            {Number(deposit) > 0 && <p className="text-[11px] text-neutral-400 mt-1">{formatRupiah(Number(deposit))}</p>}
          </Field>
          <Field label="Catatan (opsional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" />
          </Field>
        </div>

        {errorMsg && <p className="text-xs text-urgent text-center mt-3">{errorMsg}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full bg-primary text-white rounded-xl py-3.5 font-semibold text-sm mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          Kirim Reservasi
        </button>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-neutral-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
