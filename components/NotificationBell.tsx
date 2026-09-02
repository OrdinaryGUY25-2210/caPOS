"use client";

import { useEffect, useState } from "react";
import { Bell, Check, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/utils";

interface ApprovalRow {
  id: string;
  type: string;
  target_id: string | null;
  payload: any;
  created_at: string;
  requester_name: string | null;
}

/**
 * Lonceng notifikasi pengajuan (menu baru / ubah harga) dari kasir.
 * Real-time via Supabase Realtime — Manager/Owner tidak perlu refresh
 * halaman untuk lihat pengajuan baru. Approve/reject memanggil RPC
 * `review_approval_request()` di server, bukan update tabel `products`
 * langsung dari sini — supaya validasi "siapa boleh approve" tetap
 * ditegakkan di database, bukan cuma di UI.
 */
export default function NotificationBell({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<ApprovalRow[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function loadRequests() {
    const supabase = createClient();
    const { data } = await supabase
      .from("approval_requests")
      .select("id, type, target_id, payload, created_at, profiles(full_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    setRequests(
      (data ?? []).map((r: any) => ({
        id: r.id,
        type: r.type,
        target_id: r.target_id,
        payload: r.payload,
        created_at: r.created_at,
        requester_name: r.profiles?.full_name ?? null,
      }))
    );
  }

  useEffect(() => {
    loadRequests();

    const supabase = createClient();
    const channel = supabase
      .channel(`approval_requests:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approval_requests", filter: `tenant_id=eq.${tenantId}` },
        () => loadRequests()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function review(id: string, approve: boolean) {
    setProcessingId(id);
    const supabase = createClient();
    const { error } = await supabase.rpc("review_approval_request", {
      p_request_id: id,
      p_approve: approve,
    });
    setProcessingId(null);

    if (error) {
      alert("Gagal memproses: " + error.message);
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  function describe(req: ApprovalRow) {
    if (req.type === "new_menu") {
      return `Usulan menu baru: "${req.payload.name}" — ${formatRupiah(Number(req.payload.price))}`;
    }
    if (req.type === "price_change") {
      return `Usulan ubah harga menjadi ${formatRupiah(Number(req.payload.price))}`;
    }
    return "Pengajuan tidak dikenal";
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-full p-2 transition-colors"
        aria-label="Notifikasi persetujuan"
      >
        <Bell size={20} />
        {requests.length > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-urgent text-white text-[10px] font-bold flex items-center justify-center">
            {requests.length > 9 ? "9+" : requests.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-2xl shadow-xl border border-neutral-200 z-50">
            <div className="p-3 border-b border-neutral-100 font-semibold text-sm text-neutral-900">
              Pengajuan Persetujuan
            </div>
            {requests.length === 0 ? (
              <p className="p-6 text-center text-sm text-neutral-400">Tidak ada pengajuan pending.</p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {requests.map((req) => (
                  <div key={req.id} className="p-3">
                    <p className="text-xs text-neutral-400">
                      {req.requester_name ?? "Kasir"} · {new Date(req.created_at).toLocaleString("id-ID")}
                    </p>
                    <p className="text-sm text-neutral-800 mt-1">{describe(req)}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => review(req.id, true)}
                        disabled={processingId === req.id}
                        className="flex-1 bg-primary text-white text-xs font-medium rounded-lg py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {processingId === req.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Setujui
                      </button>
                      <button
                        onClick={() => review(req.id, false)}
                        disabled={processingId === req.id}
                        className="flex-1 bg-neutral-100 text-neutral-600 text-xs font-medium rounded-lg py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        <X size={12} /> Tolak
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
