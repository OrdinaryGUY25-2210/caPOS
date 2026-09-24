"use client";

import { useState } from "react";
import { Loader2, ArrowLeft, ArrowRightLeft, X, Ban, Pencil, Percent, Printer, Combine, SplitSquareHorizontal } from "lucide-react";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import TablePicker from "@/components/pos/TablePicker";
import MultiPaymentModal from "@/components/MultiPaymentModal";
import SupervisorPinModal from "@/components/SupervisorPinModal";
import SplitBillModal from "@/components/pos/SplitBillModal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatItemConfigLine } from "@/lib/utils";
import type { OrderWithItems, OrderStatus, TableLiveStatus, SensitiveAction } from "@/lib/types";

const STATUS_SEQUENCE: OrderStatus[] = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];

/**
 * "Meja & Bill Terbuka" (Phase 2 Update 1, diperkuat Migrasi 019) —
 * melengkapi poin 6/7/8/15 (Table Dashboard, assignment, Open Bill) DAN
 * 4 action item kontrol kasir: PIN supervisor untuk Void/Cancel/Diskon/
 * Price Override, Pindah & Gabung Meja, Split Bill, cetak Bill
 * (BILL_PRINTED). Kasir memilih meja OCCUPIED/BILL_PRINTED dari peta
 * live, lihat pesanan KDS, lalu bayar lewat MultiPaymentModal/
 * SplitBillModal -> checkout_order_v2 / checkout_order_split_by_item.
 */
export default function OpenBillPanel({
  branchId,
  cashierName,
  role,
  onClose,
  onPaid,
}: {
  branchId: string | null;
  cashierName: string;
  /** Peran user yang sedang login — menentukan apakah PIN supervisor wajib (kasir) atau bisa dilewati (manager/owner/super_admin). */
  role: string;
  onClose: () => void;
  onPaid: (transactionId: string, order: OrderWithItems) => void;
}) {
  const supabase = createClient();
  const isSupervisor = role === "manager" || role === "owner" || role === "super_admin";

  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [showMergeTable, setShowMergeTable] = useState(false);
  const [moving, setMoving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ mode: "MOVE" | "MERGE"; target: TableLiveStatus } | null>(null);
  const [printingBill, setPrintingBill] = useState(false);
  const [overridingItemId, setOverridingItemId] = useState<string | null>(null);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountInput, setDiscountInput] = useState("");

  // Gerbang PIN supervisor generik (Migrasi 019) — dipakai untuk Void
  // Item, Cancel Order, Manual Discount, dan Price Override. Kalau user
  // yang login sudah manager/owner/super_admin, modal ini DILEWATI dan
  // langsung minta alasan lewat window.prompt (server tetap membebaskan
  // mereka dari PIN — lihat require_supervisor_authorization()).
  const [pinGate, setPinGate] = useState<{
    action: SensitiveAction;
    contextLabel?: string;
    run: (pin: string | null, reason: string) => Promise<{ error?: string } | void>;
  } | null>(null);

  async function runSensitive(
    action: SensitiveAction,
    contextLabel: string,
    promptLabel: string,
    run: (pin: string | null, reason: string) => Promise<{ error?: string } | void>
  ) {
    if (isSupervisor) {
      const reason = window.prompt(promptLabel);
      if (!reason) return;
      const result = await run(null, reason);
      if (result?.error) alert(result.error);
    } else {
      setPinGate({ action, contextLabel, run });
    }
  }

  async function openTable(t: TableLiveStatus) {
    if (!t.active_order_id) return;
    setLoadingOrder(true);
    const { data } = await supabase.from("orders").select("*, order_items(*)").eq("id", t.active_order_id).single();
    setLoadingOrder(false);
    setSelectedOrder(data as OrderWithItems);
  }

  async function reloadOrder(orderId: string) {
    const { data } = await supabase.from("orders").select("*, order_items(*)").eq("id", orderId).single();
    setSelectedOrder(data as OrderWithItems);
  }

  async function finishCleaning(t: TableLiveStatus) {
    await supabase.from("branch_tables").update({ needs_cleaning: false, cleaning_started_at: null }).eq("id", t.table_id);
  }

  // Poin 17 (Move Table) — lewat /api/tables/move (Migrasi 019) supaya
  // ada 1 jalur HTTP terstandar untuk Move, dipakai juga TableStatusBoard.
  function moveToTable(t: TableLiveStatus) {
    if (!selectedOrder) return;
    // Item #28 — dulu langsung eksekusi begitu meja tujuan ditekan, tanpa
    // konfirmasi. Sekarang lewat dialog Confirmation dulu.
    setConfirmAction({ mode: "MOVE", target: t });
  }

  async function applyMoveToTable(t: TableLiveStatus) {
    if (!selectedOrder) return;
    setMoving(true);
    const res = await fetch("/api/tables/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: selectedOrder.id, new_table_id: t.table_id }),
    });
    const body = await res.json().catch(() => ({}));
    setMoving(false);
    if (!res.ok) throw new Error(body.message ?? "unknown error");
    setSelectedOrder({ ...selectedOrder, table_id: t.table_id, table_number: t.table_number });
    setShowMoveTable(false);
  }

  // Migrasi 019 — Gabung Meja: order pesanan yang sedang dibuka (source)
  // digabung KE order milik meja lain yang dipilih (target). Setelah
  // berhasil, bill source ini hilang (sudah dibatalkan & dipindah ke
  // target) — panel ditutup kembali ke peta meja.
  function mergeIntoTable(t: TableLiveStatus) {
    if (!selectedOrder || !t.active_order_id) return;
    if (t.table_id === selectedOrder.table_id) {
      alert("Pilih meja lain untuk digabung.");
      return;
    }
    setConfirmAction({ mode: "MERGE", target: t });
  }

  async function applyMergeIntoTable(t: TableLiveStatus) {
    if (!selectedOrder || !t.active_order_id) return;
    setMerging(true);
    const res = await fetch("/api/tables/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_order_id: selectedOrder.id, target_order_id: t.active_order_id, reason: `Gabung meja ${selectedOrder.table_number} -> ${t.table_number}` }),
    });
    const body = await res.json().catch(() => ({}));
    setMerging(false);
    if (!res.ok) throw new Error(body.message ?? "unknown error");
    setShowMergeTable(false);
    setSelectedOrder(null);
  }

  // Migrasi 019 — Cetak Bill: memajukan meja ke status BILL_PRINTED
  // (di antara OCCUPIED dan CLEANING) tanpa mengubah status KDS order.
  async function printBill() {
    if (!selectedOrder) return;
    setPrintingBill(true);
    const { error } = await supabase.rpc("mark_bill_printed", { p_order_id: selectedOrder.id });
    setPrintingBill(false);
    if (error) {
      alert("Gagal menandai bill dicetak: " + error.message);
      return;
    }
    window.print();
  }

  async function advanceToReady(): Promise<boolean> {
    if (!selectedOrder) return false;
    let status = selectedOrder.status;
    if (status === "COMPLETED" || status === "CANCELLED") return false;
    setAdvancing(true);
    const idx = STATUS_SEQUENCE.indexOf(status);
    for (let i = idx; i < STATUS_SEQUENCE.indexOf("READY"); i++) {
      const nextStatus = STATUS_SEQUENCE[i + 1];
      const { error } = await supabase.rpc("update_order_status", { p_order_id: selectedOrder.id, p_new_status: nextStatus });
      if (error) {
        setAdvancing(false);
        alert("Gagal memperbarui status pesanan: " + error.message);
        return false;
      }
      status = nextStatus;
    }
    setAdvancing(false);
    setSelectedOrder({ ...selectedOrder, status });
    return true;
  }

  async function handleAdvanceAndPay() {
    if (await advanceToReady()) setShowPayment(true);
  }

  // Split Bill juga butuh order berstatus READY/SERVED (sama seperti
  // checkout_order_v2) — pakai alur "advance" yang sama lalu buka
  // SplitBillModal alih-alih MultiPaymentModal.
  async function handleAdvanceAndPayForSplit() {
    if (await advanceToReady()) setShowSplitBill(true);
  }

  const subtotal = selectedOrder?.order_items.reduce((sum, i) => sum + i.unit_price * (i.qty - i.voided_qty), 0) ?? 0;
  const total = Math.max(0, subtotal - (selectedOrder?.manual_discount_amount ?? 0));

  // Void (poin 32-33, gerbang PIN Migrasi 019) — HANYA sebelum lunas
  // (status COMPLETED/CANCELLED ditolak sendiri oleh void_order_item()/
  // cancel_order() di server). Baris item tidak pernah dihapus; server
  // yang memutuskan apakah kasir boleh self-approve atau butuh manager.
  async function voidItem(itemId: string, remainingQty: number, productName: string) {
    if (!selectedOrder) return;
    await runSensitive(
      "VOID_ITEM",
      `${remainingQty}x ${productName}`,
      `Alasan membatalkan item ini (${remainingQty}x)?`,
      async (pin, reason) => {
        const { error } = await supabase.rpc("void_order_item", { p_order_item_id: itemId, p_void_qty: remainingQty, p_reason: reason, p_supervisor_pin: pin });
        if (error) {
          if (error.message.includes("APPROVAL_REQUIRED")) return { error: "Pembatalan di atas Rp50.000 wajib persetujuan manager." };
          if (error.message.includes("INVALID_PIN")) return { error: "PIN supervisor salah." };
          return { error: "Gagal membatalkan item: " + error.message };
        }
        await reloadOrder(selectedOrder.id);
      }
    );
  }

  async function cancelWholeOrder() {
    if (!selectedOrder) return;
    await runSensitive(
      "CANCEL_ORDER",
      `Pesanan ${selectedOrder.order_number} — ${formatRupiah(total)}`,
      `Alasan membatalkan seluruh pesanan ${selectedOrder.order_number}?`,
      async (pin, reason) => {
        const { error } = await supabase.rpc("cancel_order", { p_order_id: selectedOrder.id, p_reason: reason, p_supervisor_pin: pin });
        if (error) {
          if (error.message.includes("APPROVAL_REQUIRED")) return { error: "Pembatalan di atas Rp50.000 wajib persetujuan manager." };
          if (error.message.includes("INVALID_PIN")) return { error: "PIN supervisor salah." };
          return { error: "Gagal membatalkan pesanan: " + error.message };
        }
        setSelectedOrder(null);
      }
    );
  }

  // Migrasi 019 — Manual Discount (Rupiah, wajib PIN supervisor).
  async function applyDiscount() {
    if (!selectedOrder) return;
    const value = Number(discountInput);
    if (!value || value <= 0) {
      alert("Nominal diskon tidak valid.");
      return;
    }
    await runSensitive(
      "MANUAL_DISCOUNT",
      `Diskon ${formatRupiah(value)} untuk ${selectedOrder.order_number}`,
      `Alasan diskon manual ${formatRupiah(value)}?`,
      async (pin, reason) => {
        const { error } = await supabase.rpc("apply_manual_discount", { p_order_id: selectedOrder.id, p_discount_amount: value, p_reason: reason, p_supervisor_pin: pin });
        if (error) {
          if (error.message.includes("INVALID_PIN")) return { error: "PIN supervisor salah." };
          return { error: "Gagal menerapkan diskon: " + error.message };
        }
        await reloadOrder(selectedOrder.id);
        setShowDiscountForm(false);
        setDiscountInput("");
      }
    );
  }

  // Migrasi 019 — Price Override per item (wajib PIN supervisor).
  async function overridePrice(itemId: string, productName: string, currentPrice: number) {
    if (!selectedOrder) return;
    const input = window.prompt(`Harga baru untuk "${productName}" (saat ini ${formatRupiah(currentPrice)}):`, String(currentPrice));
    if (input === null) return;
    const newPrice = Number(input);
    if (!newPrice || newPrice < 0) {
      alert("Harga tidak valid.");
      return;
    }
    setOverridingItemId(itemId);
    await runSensitive(
      "PRICE_OVERRIDE",
      `${productName}: ${formatRupiah(currentPrice)} -> ${formatRupiah(newPrice)}`,
      `Alasan mengubah harga "${productName}" menjadi ${formatRupiah(newPrice)}?`,
      async (pin, reason) => {
        const { error } = await supabase.rpc("override_item_price", { p_order_item_id: itemId, p_new_unit_price: newPrice, p_reason: reason, p_supervisor_pin: pin });
        if (error) {
          if (error.message.includes("INVALID_PIN")) return { error: "PIN supervisor salah." };
          return { error: "Gagal mengubah harga: " + error.message };
        }
        await reloadOrder(selectedOrder.id);
      }
    );
    setOverridingItemId(null);
  }

  return (
    <Modal title={selectedOrder ? `Meja ${selectedOrder.table_number ?? "-"} — ${selectedOrder.order_number}` : "Meja & Bill Terbuka"} onClose={onClose}>
      {!selectedOrder ? (
        loadingOrder ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
        ) : (
          <>
            <p className="text-xs text-neutral-500 mb-2">
              Tap meja <span className="font-semibold text-urgent">terisi</span> / <span className="font-semibold text-blue-600">bill dicetak</span> untuk buka bill-nya, atau meja{" "}
              <span className="font-semibold text-neutral-600">dibersihkan</span> untuk menandai selesai.
            </p>
            <TablePicker branchId={branchId} onSelectOccupied={openTable} onFinishCleaning={finishCleaning} />
          </>
        )
      ) : showMoveTable ? (
        <div className="space-y-3">
          <button onClick={() => setShowMoveTable(false)} className="text-xs text-neutral-500 flex items-center gap-1">
            <ArrowLeft size={12} /> Batal, kembali ke bill
          </button>
          <p className="text-xs text-neutral-500 mb-2">
            Pindahkan pesanan <span className="font-semibold">{selectedOrder.order_number}</span> ke meja tujuan (harus{" "}
            <span className="font-semibold text-primary">tersedia</span>).
          </p>
          {moving ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
          ) : (
            <TablePicker branchId={branchId} onSelectAvailable={moveToTable} />
          )}
        </div>
      ) : showMergeTable ? (
        <div className="space-y-3">
          <button onClick={() => setShowMergeTable(false)} className="text-xs text-neutral-500 flex items-center gap-1">
            <ArrowLeft size={12} /> Batal, kembali ke bill
          </button>
          <p className="text-xs text-neutral-500 mb-2">
            Gabungkan pesanan <span className="font-semibold">{selectedOrder.order_number}</span> ke meja lain yang{" "}
            <span className="font-semibold text-urgent">terisi</span> — item dipindah jadi 1 tagihan, meja ini dibebaskan.
          </p>
          {merging ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
          ) : (
            <TablePicker branchId={branchId} onSelectOccupied={mergeIntoTable} />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <button onClick={() => setSelectedOrder(null)} className="text-xs text-neutral-500 flex items-center gap-1">
            <ArrowLeft size={12} /> Kembali ke peta meja
          </button>

          <div className="space-y-2">
            {selectedOrder.order_items.map((item) => {
              const remaining = item.qty - item.voided_qty;
              return (
                <div key={item.id} className="flex justify-between items-start text-sm">
                  <div className="min-w-0">
                    <p className={`font-medium ${remaining <= 0 ? "text-neutral-400 line-through" : "text-neutral-900"}`}>
                      {remaining}x {item.product_name}
                      {item.voided_qty > 0 && <span className="text-xs text-urgent font-normal"> ({item.voided_qty} dibatalkan)</span>}
                      {item.original_unit_price !== null && <span className="text-xs text-warning font-normal"> (harga diubah)</span>}
                    </p>
                    {formatItemConfigLine(item) && <p className="text-xs text-neutral-500">{formatItemConfigLine(item)}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-neutral-700">{formatRupiah(item.unit_price * remaining)}</span>
                    {remaining > 0 && (
                      <>
                        <button
                          onClick={() => overridePrice(item.id, item.product_name, item.unit_price)}
                          disabled={overridingItemId === item.id}
                          title="Ubah harga (Price Override)"
                          className="text-neutral-400 hover:text-warning"
                        >
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => voidItem(item.id, remaining, item.product_name)} title="Batalkan item ini" className="text-neutral-400 hover:text-urgent">
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-neutral-100 pt-2 space-y-1">
            <div className="flex justify-between text-sm text-neutral-500">
              <span>Subtotal</span>
              <span>{formatRupiah(subtotal)}</span>
            </div>
            {selectedOrder.manual_discount_amount > 0 && (
              <div className="flex justify-between text-sm text-urgent">
                <span>Diskon manual{selectedOrder.manual_discount_reason ? ` (${selectedOrder.manual_discount_reason})` : ""}</span>
                <span>-{formatRupiah(selectedOrder.manual_discount_amount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span className="text-primary">{formatRupiah(total)}</span>
            </div>
          </div>

          <p className="text-xs text-neutral-500">Status pesanan: <span className="font-semibold">{selectedOrder.status}</span></p>

          {showDiscountForm ? (
            <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg p-2">
              <input
                type="number"
                autoFocus
                placeholder="Nominal diskon (Rp)"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                className="input-field flex-1 text-sm py-1.5"
              />
              <button onClick={applyDiscount} className="btn-primary text-xs px-3 py-1.5">Terapkan</button>
              <button onClick={() => setShowDiscountForm(false)} className="text-xs text-neutral-400 px-2">Batal</button>
            </div>
          ) : (
            <button onClick={() => setShowDiscountForm(true)} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
              <Percent size={14} /> Diskon Manual
            </button>
          )}

          {selectedOrder.order_type === "dine_in" && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowMoveTable(true)} className="btn-outline text-sm flex items-center justify-center gap-2">
                <ArrowRightLeft size={14} /> Pindah Meja
              </button>
              <button onClick={() => setShowMergeTable(true)} className="btn-outline text-sm flex items-center justify-center gap-2">
                <Combine size={14} /> Gabung Meja
              </button>
            </div>
          )}

          {selectedOrder.order_type === "dine_in" && (
            <button disabled={printingBill} onClick={printBill} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
              {printingBill ? <Loader2 className="animate-spin" size={14} /> : <Printer size={14} />} Cetak Bill
            </button>
          )}

          <button onClick={cancelWholeOrder} className="w-full text-sm flex items-center justify-center gap-2 text-urgent py-2">
            <Ban size={14} /> Batalkan Seluruh Pesanan
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button disabled={advancing || total <= 0} onClick={handleAdvanceAndPay} className="btn-primary text-sm flex items-center justify-center gap-2">
              {advancing && <Loader2 className="animate-spin" size={16} />} Bayar Penuh
            </button>
            <button disabled={advancing || total <= 0} onClick={handleAdvanceAndPayForSplit} className="btn-outline text-sm flex items-center justify-center gap-2">
              <SplitSquareHorizontal size={14} /> Split Bill
            </button>
          </div>
        </div>
      )}

      {showPayment && selectedOrder && (
        <MultiPaymentModal
          orderId={selectedOrder.id}
          totalDue={total}
          onClose={() => setShowPayment(false)}
          onPaid={(txId) => {
            setShowPayment(false);
            onPaid(txId, selectedOrder);
            setSelectedOrder(null);
          }}
        />
      )}

      {showSplitBill && selectedOrder && (
        <SplitBillModal
          orderId={selectedOrder.id}
          items={selectedOrder.order_items}
          totalDue={total}
          onClose={() => setShowSplitBill(false)}
          onSettled={(txId, orderFullySettled) => {
            if (orderFullySettled) {
              setShowSplitBill(false);
              onPaid(txId, selectedOrder);
              setSelectedOrder(null);
            } else {
              // Sebagian order masih tersisa — muat ulang bill supaya sisa
              // item/qty yang belum tertagih terlihat untuk sub-bill berikutnya.
              reloadOrder(selectedOrder.id);
            }
          }}
        />
      )}

      {pinGate && (
        <SupervisorPinModal
          action={pinGate.action}
          branchId={branchId}
          contextLabel={pinGate.contextLabel}
          onClose={() => setPinGate(null)}
          onConfirm={async ({ pin, reason }) => {
            const result = await pinGate.run(pin, reason);
            if (!result?.error) setPinGate(null);
            return result;
          }}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.mode === "MOVE" ? "Pindahkan Pesanan?" : "Gabungkan Pesanan?"}
          description={
            confirmAction.mode === "MOVE"
              ? `Pindahkan pesanan meja ${selectedOrder?.table_number} ke meja ${confirmAction.target.table_number}?`
              : `Gabungkan pesanan meja ${selectedOrder?.table_number} ke meja ${confirmAction.target.table_number}? Bill meja ${selectedOrder?.table_number} akan hilang dan digabung ke meja ${confirmAction.target.table_number}.`
          }
          confirmLabel={confirmAction.mode === "MOVE" ? "Ya, Pindahkan" : "Ya, Gabungkan"}
          successMessage={confirmAction.mode === "MOVE" ? "Meja dipindahkan." : "Pesanan digabung."}
          onClose={() => setConfirmAction(null)}
          onConfirm={() =>
            confirmAction.mode === "MOVE" ? applyMoveToTable(confirmAction.target) : applyMergeIntoTable(confirmAction.target)
          }
        />
      )}
    </Modal>
  );
}
