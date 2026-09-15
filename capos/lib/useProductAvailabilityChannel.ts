"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MenuAvailabilityBroadcast } from "@/lib/types";

/**
 * Satu channel Supabase Realtime per tenant (`products-<tenant_id>`),
 * dipakai bersama oleh POS dan KDS untuk toggle "Sold Out / Menu 86":
 *
 *  - `postgres_changes` di tabel `products` — supaya kasir/dapur lain
 *    yang sedang login (RLS tenant-scoped berlaku normal) langsung lihat
 *    status berubah tanpa refresh, dari perangkat manapun yang menyentuh
 *    tabel ini (termasuk toggle dari /dashboard/menu).
 *  - `broadcast` — dikirim manual setelah update ke DB berhasil, supaya
 *    halaman publik /order/[branch]/[table] (anon, tidak kena RLS
 *    `postgres_changes` di atas) tetap bisa memblokir pemesanan item
 *    yang baru saja ditandai habis secara instan. Lihat migration_020
 *    untuk kenapa jalurnya dipisah begini.
 *
 * `onRemoteChange` dipanggil untuk EVENT `postgres_changes` apa pun (INSERT/
 * UPDATE/DELETE) di `products` milik tenant ini — termasuk perubahan dari
 * tab/perangkat sendiri (echo), jadi konsumen sebaiknya melakukan merge
 * idempotent (by id), bukan assume selalu perubahan dari luar.
 */
export function useProductAvailabilityChannel(
  tenantId: string | null,
  onRemoteChange: (payload: { eventType: string; new: any; old: any }) => void
) {
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`products-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", filter: `tenant_id=eq.${tenantId}` },
        (payload) => onRemoteChange(payload as any)
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  /** Kirim broadcast — dipanggil SETELAH update `products.is_available` ke
   * DB sukses (bukan pengganti update DB, cuma notifikasi tambahan untuk
   * halaman anon yang tidak bisa dijangkau postgres_changes). */
  const broadcastAvailability = useCallback((product: MenuAvailabilityBroadcast) => {
    channelRef.current?.send({ type: "broadcast", event: "availability_changed", payload: product });
  }, []);

  return { broadcastAvailability };
}
