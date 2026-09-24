"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import type { OrderItem, TableLiveStatus } from "@/lib/types";
import PosSplitBillModal from "@/components/pos/SplitBillModal";

/**
 * Table Management §4 — "Split Bill" dari papan meja (dashboard), bukan
 * dari /pos. Order items belum tersedia di TableLiveStatus (view itu cuma
 * bawa total & jumlah order), jadi komponen ini memuatnya sendiri lalu
 * mendelegasikan UI split-nya ke <PosSplitBillModal> yang sudah teruji di
 * /pos — satu logika split & checkout untuk kedua tempat, tidak dobel.
 */
export default function SplitBillModal({
  table,
  onClose,
  onSettled,
}: {
  table: TableLiveStatus;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [items, setItems] = useState<OrderItem[] | null>(null);

  useEffect(() => {
    if (!table.active_order_id) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", table.active_order_id!)
        .order("created_at", { ascending: true });
      setItems((data as OrderItem[]) ?? []);
    })();
  }, [table.active_order_id]);

  if (!table.active_order_id) return null;

  if (!items) {
    return (
      <Modal title="Split Bill" onClose={onClose} maxWidth="sm:max-w-md">
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-neutral-400" size={22} />
        </div>
      </Modal>
    );
  }

  return (
    <PosSplitBillModal
      orderId={table.active_order_id}
      items={items}
      totalDue={table.active_order_total}
      onClose={onClose}
      onSettled={onSettled}
    />
  );
}
