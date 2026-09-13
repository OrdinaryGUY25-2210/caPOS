"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cx } from "@/lib/utils";

interface IncomingOrder {
  id: string;
  order_number: string;
  table_number: string | null;
  channel: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  qr_self_order: "Pemesanan Mandiri (QR)",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
  website: "Website",
};

/**
 * Notifikasi suara + popup real-time saat pesanan baru masuk lewat QR
 * Self-Order atau Online Order Hub — dipasang di PosNavbar (POS) dan
 * layar KDS. Memakai Web Audio API (bukan file .mp3) supaya tidak perlu
 * menambah aset biner ke proyek. `orders` sudah terdaftar di publication
 * `supabase_realtime` sejak migration_012 (Phase 2), jadi tidak perlu
 * perubahan skema tambahan supaya ini berfungsi.
 */
export default function QrOrderAlert({ branchId }: { branchId: string | null }) {
  const [queue, setQueue] = useState<IncomingOrder[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  function playChime() {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      [880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
    } catch {
      // Audio otomatis diblokir browser sampai ada interaksi user pertama
      // kali — popup visual di bawah tetap tampil walau suara gagal.
    }
  }

  useEffect(() => {
    if (!branchId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`qr_order_alert:${branchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` },
        (payload) => {
          const row = payload.new as any;
          if (row.channel === "pos") return; // hanya alert untuk pesanan bukan dari kasir sendiri
          setQueue((prev) => [
            ...prev,
            { id: row.id, order_number: row.order_number, table_number: row.table_number, channel: row.channel },
          ]);
          playChime();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId]);

  if (queue.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 w-72">
      {queue.map((o) => (
        <div key={o.id} className="bg-white border border-primary rounded-2xl shadow-xl p-3 flex items-start gap-3 animate-in slide-in-from-right">
          <div className="bg-primary-light text-primary rounded-full p-2 shrink-0">
            <Bell size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-neutral-900">Pesanan Baru: {o.order_number}</p>
            <p className="text-xs text-neutral-500">
              {CHANNEL_LABEL[o.channel] ?? o.channel}
              {o.table_number ? ` · Meja ${o.table_number}` : ""}
            </p>
          </div>
          <button
            onClick={() => setQueue((prev) => prev.filter((q) => q.id !== o.id))}
            className={cx("text-neutral-300 hover:text-neutral-500 shrink-0")}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
