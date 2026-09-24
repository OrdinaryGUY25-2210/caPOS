"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, User, Utensils, RotateCcw } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/utils";
import RefundModal from "@/components/pos/RefundModal";
import type { TxRow } from "./TransactionRow";

interface OrderInfo {
  order_number: string;
  order_type: string;
  channel: string;
  table_number: string | null;
  customer_name: string | null;
}

interface ItemRow {
  id: string;
  product_name: string;
  variant_notes: string | null;
  qty: number;
  unit_price: number;
  subtotal: number;
}

const ORDER_TYPE_LABEL: Record<string, string> = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

/**
 * Transactions §10 — "Transaction detail", "Receipt", "Customer", "Table",
 * "Variant/modifier". Sebelumnya tidak ada tampilan detail sama sekali —
 * baris transaksi cuma menampilkan total & metode bayar. Detail item +
 * variant/modifier diambil dari order_items lewat order yang
 * transaction_id-nya = transaksi ini (order 1:1 dengan transaksi di
 * checkout_order_v2).
 */
export default function TransactionDetailModal({ tx, onClose, onRefunded }: { tx: TxRow; onClose: () => void; onRefunded: () => void }) {
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [showRefund, setShowRefund] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: orderRow } = await supabase
        .from("orders")
        .select("id, order_number, order_type, channel, table_number, customer_name")
        .eq("transaction_id", tx.id)
        .maybeSingle();

      if (!orderRow) {
        setItems([]);
        return;
      }
      setOrder(orderRow as OrderInfo);
      const { data: itemRows } = await supabase
        .from("order_items")
        .select("id, product_name, variant_notes, qty, unit_price, subtotal")
        .eq("order_id", (orderRow as any).id)
        .order("created_at", { ascending: true });
      setItems((itemRows as ItemRow[]) ?? []);
    })();
  }, [tx.id]);

  if (showRefund) {
    return (
      <RefundModal
        transactionId={tx.id}
        invoiceNumber={tx.invoice_number}
        totalAmount={tx.total_amount}
        onClose={() => {
          setShowRefund(false);
          onRefunded();
        }}
      />
    );
  }

  return (
    <Modal title={`Struk — ${tx.invoice_number}`} onClose={onClose} maxWidth="sm:max-w-md">
      <div className="text-sm text-neutral-500 space-y-1">
        <p>{new Date(tx.created_at).toLocaleString("id-ID")}</p>
        <p>Kasir: {tx.cashier_name ?? "-"}</p>
        {order && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <span className="flex items-center gap-1">
              <Utensils size={12} /> {ORDER_TYPE_LABEL[order.order_type] ?? order.order_type}
              {order.table_number ? ` · Meja ${order.table_number}` : ""}
            </span>
            {order.customer_name && (
              <span className="flex items-center gap-1">
                <User size={12} /> {order.customer_name}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-neutral-200 pt-3">
        {items === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-neutral-400" size={20} />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-4">Detail item tidak tersedia untuk transaksi ini.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="flex justify-between text-sm">
                <div>
                  <p className="text-neutral-900">
                    {it.qty}x {it.product_name}
                  </p>
                  {it.variant_notes && <p className="text-xs text-neutral-400">{it.variant_notes}</p>}
                </div>
                <p className="text-neutral-700 shrink-0">{formatRupiah(it.subtotal)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-neutral-200 pt-3 flex justify-between font-bold text-neutral-900">
        <span>Total</span>
        <span>{formatRupiah(tx.total_amount)}</span>
      </div>
      <p className="text-xs text-neutral-400 uppercase">Dibayar via {tx.payment_method}</p>

      <div className="flex gap-2 pt-2">
        <button onClick={() => window.print()} className="btn-outline flex-1 flex items-center justify-center gap-2 text-sm">
          <Printer size={15} /> Cetak Struk
        </button>
        <button onClick={() => setShowRefund(true)} className="btn-outline flex-1 flex items-center justify-center gap-2 text-sm text-urgent border-urgent/30">
          <RotateCcw size={15} /> Refund
        </button>
      </div>
    </Modal>
  );
}
