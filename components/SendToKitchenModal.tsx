"use client";

import { useState } from "react";
import { Loader2, Utensils, ShoppingBag, Bike } from "lucide-react";
import Modal from "@/components/Modal";
import TablePicker from "@/components/pos/TablePicker";
import { createClient } from "@/lib/supabase/client";
import { cx } from "@/lib/utils";
import { printAllStationTickets } from "@/lib/kitchenPrinter";
import type { KitchenStation, OrderType, OrderWithItems, TableLiveStatus } from "@/lib/types";

interface KitchenCartItem {
  product_id: string;
  name: string;
  qty: number;
}

/**
 * Dipanggil dari /pos SEBELUM pembayaran — mengirim keranjang saat ini
 * ke dapur sebagai order KDS baru (status NEW), lalu mencetak tiket ke
 * printer stasiun yang relevan secara otomatis. Order yang dihasilkan
 * BELUM dianggap "terjual" (tidak masuk transactions) sampai dibayar
 * lewat MultiPaymentModal + checkout_order_v2 setelah kitchen menandai
 * READY/SERVED.
 */
export default function SendToKitchenModal({
  tenantId,
  branchId,
  shiftId,
  cashierId,
  cashierName,
  cart,
  stations,
  onSent,
  onClose,
}: {
  tenantId: string;
  branchId: string | null;
  shiftId: string;
  cashierId: string;
  cashierName: string;
  cart: KitchenCartItem[];
  stations: KitchenStation[];
  onSent: (orderId: string, orderNumber: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [selectedTable, setSelectedTable] = useState<TableLiveStatus | null>(null);
  const [tableNumber, setTableNumber] = useState(""); // fallback teks bebas — dipakai HANYA kalau cabang belum punya meja terdaftar
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [variantNotes, setVariantNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSend() {
    if (cart.length === 0) return;
    if (orderType === "dine_in" && !selectedTable && !tableNumber.trim()) {
      alert("Pilih meja untuk pesanan dine-in.");
      return;
    }

    setSaving(true);
    const { data: orderId, error } = await supabase.rpc("create_kitchen_order", {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_shift_id: shiftId,
      p_cashier_id: cashierId,
      p_order_type: orderType,
      p_table_id: selectedTable?.table_id ?? null,
      p_table_number: selectedTable ? null : tableNumber || null,
      p_customer_name: customerName || null,
      p_notes: notes || null,
      p_items: cart.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
        variant_notes: variantNotes[i.product_id] || null,
      })),
    });

    if (error) {
      setSaving(false);
      if (error.message.includes("TABLE_OCCUPIED")) {
        alert("Meja ini baru saja digunakan kasir lain — pilih meja lain.");
      } else if (error.message.includes("TABLE_CLEANING")) {
        alert("Meja ini masih menunggu dibersihkan.");
      } else {
        alert("Gagal mengirim pesanan ke dapur: " + error.message);
      }
      return;
    }

    // Ambil kembali order lengkap (dengan snapshot station_id per item)
    // untuk keperluan cetak tiket per stasiun.
    const { data: fullOrder } = await supabase.from("orders").select("*, order_items(*)").eq("id", orderId).single();
    setSaving(false);

    if (fullOrder) {
      const { printed, skipped } = await printAllStationTickets(fullOrder as unknown as OrderWithItems, stations, cashierName);
      if (skipped.length > 0) {
        alert(
          `Pesanan ${fullOrder.order_number} terkirim ke dapur.\n` +
            (printed.length > 0 ? `Tercetak: ${printed.join(", ")}.\n` : "") +
            `Belum tercetak (printer belum tersambung): ${skipped.join(", ")}.`
        );
      }
    }

    onSent(orderId as string, (fullOrder as any)?.order_number ?? "");
  }

  return (
    <Modal
      title="Kirim Pesanan ke Dapur"
      onClose={onClose}
      footer={
        <button disabled={saving || cart.length === 0} onClick={handleSend} className="btn-primary w-full flex items-center justify-center gap-2">
          {saving && <Loader2 className="animate-spin" size={16} />} Kirim ke Dapur & Cetak Tiket
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {[
          { value: "dine_in" as OrderType, label: "Dine-in", icon: Utensils },
          { value: "takeaway" as OrderType, label: "Takeaway", icon: ShoppingBag },
          { value: "delivery" as OrderType, label: "Delivery", icon: Bike },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setOrderType(t.value)}
            className={cx(
              "py-2.5 rounded-xl text-xs font-semibold flex flex-col items-center gap-1",
              orderType === t.value ? "bg-primary text-white" : "border border-neutral-200 text-neutral-600 hover:bg-neutral-100"
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {orderType === "dine_in" ? (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Pilih Meja</label>
          <TablePicker
            branchId={branchId}
            selectedTableId={selectedTable?.table_id}
            onSelectAvailable={(t) => setSelectedTable(t)}
          />
          {/* Fallback teks bebas — hanya relevan kalau TablePicker di atas
              tidak menampilkan meja apa pun (cabang belum daftar meja). */}
          <div className="mt-2">
            <input
              value={tableNumber}
              onChange={(e) => {
                setTableNumber(e.target.value);
                if (e.target.value) setSelectedTable(null);
              }}
              className="input-field text-sm"
              placeholder="Atau ketik nomor meja manual (cabang belum daftar meja)"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Pelanggan (opsional)</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="input-field" placeholder="Contoh: Budi" />
        </div>
      )}

      <div className="space-y-2 border-t border-neutral-100 pt-3">
        <p className="text-xs font-semibold text-neutral-500 uppercase">Varian / Catatan per Item</p>
        {cart.map((item) => (
          <div key={item.product_id}>
            <label className="text-sm text-neutral-700 mb-1 block">{item.qty}x {item.name}</label>
            <input
              value={variantNotes[item.product_id] ?? ""}
              onChange={(e) => setVariantNotes((prev) => ({ ...prev, [item.product_id]: e.target.value }))}
              placeholder="Contoh: Oat Milk, Less Sugar"
              className="input-field text-sm"
            />
          </div>
        ))}
      </div>

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan Umum Pesanan (opsional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-field resize-none" />
      </div>
    </Modal>
  );
}
