"use client";

import { useMemo, useState } from "react";
import { Loader2, Users, Layers, Plus, Trash2, CheckCircle2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatNumberWithDots, stripNumberDots, generateInvoiceNumber } from "@/lib/utils";
import type { OrderItem, PaymentMethod } from "@/lib/types";

type SplitMode = "AMOUNT" | "ITEM";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Kredit" },
  { value: "ewallet", label: "E-Wallet" },
  { value: "bank_transfer", label: "Transfer" },
];

interface AmountShare {
  id: string;
  label: string;
  method: PaymentMethod;
  amount: string;
}

interface ItemGroup {
  id: string;
  label: string;
  method: PaymentMethod;
  /** order_item_id -> qty dialokasikan ke grup ini */
  allocations: Record<string, number>;
}

/**
 * Split Bill (Migrasi 019) — 2 mode:
 *  - Split by Amount: bagi total tagihan rata (atau custom) ke N orang,
 *    tiap orang bisa pakai metode bayar berbeda. Dieksekusi lewat
 *    checkout_order_v2() YANG SUDAH ADA (1 transaksi, banyak baris
 *    p_payments) — tidak perlu RPC baru, hanya UI pembagi + label.
 *  - Split by Item: tiap orang memilih item/qty yang dia bayar sendiri.
 *    Dieksekusi lewat checkout_order_split_by_item() (1 transaksi
 *    TERPISAH per grup) — bisa dibayar satu-satu / tidak harus bersamaan.
 */
export default function SplitBillModal({
  orderId,
  items,
  totalDue,
  onClose,
  onSettled,
}: {
  orderId: string;
  items: OrderItem[];
  totalDue: number;
  onClose: () => void;
  /** Dipanggil setiap sub-bill berhasil dibayar. `orderFullySettled` true kalau seluruh order sudah lunas. */
  onSettled: (transactionId: string, orderFullySettled: boolean) => void;
}) {
  const supabase = createClient();
  const [mode, setMode] = useState<SplitMode>("AMOUNT");

  // ---- Mode: Split by Amount ----
  const [peopleCount, setPeopleCount] = useState(2);
  const [shares, setShares] = useState<AmountShare[]>(() => buildEqualShares(2, totalDue));
  const [payingAmount, setPayingAmount] = useState(false);

  function buildEqualShares(n: number, total: number): AmountShare[] {
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return Array.from({ length: n }, (_, i) => ({
      id: crypto.randomUUID(),
      label: `Orang ${i + 1}`,
      method: "cash" as PaymentMethod,
      amount: String(base + (i === n - 1 ? remainder : 0)), // sisa pembulatan masuk ke orang terakhir
    }));
  }

  function resetEqualSplit(n: number) {
    setPeopleCount(n);
    setShares(buildEqualShares(n, totalDue));
  }

  const amountSum = shares.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const amountRemaining = totalDue - amountSum;

  async function paySplitByAmount() {
    if (amountRemaining !== 0) {
      alert(amountRemaining > 0 ? `Kurang ${formatRupiah(amountRemaining)} lagi.` : `Kelebihan ${formatRupiah(-amountRemaining)}.`);
      return;
    }
    if (shares.some((s) => !s.amount || Number(s.amount) <= 0)) {
      alert("Setiap bagian harus punya nominal lebih dari 0.");
      return;
    }
    setPayingAmount(true);
    const { data, error } = await supabase.rpc("checkout_order_v2", {
      p_order_id: orderId,
      p_invoice_number: generateInvoiceNumber(),
      p_member_code: null,
      p_payments: shares.map((s) => ({ method: s.method, amount: Number(s.amount), split_group_label: s.label })),
    });
    setPayingAmount(false);
    if (error) {
      alert("Gagal memproses Split Bill: " + error.message);
      return;
    }
    onSettled(data as string, true); // checkout_order_v2 selalu melunasi SELURUH order sekaligus
  }

  // ---- Mode: Split by Item ----
  const [groups, setGroups] = useState<ItemGroup[]>([
    { id: crypto.randomUUID(), label: "Orang 1", method: "cash", allocations: {} },
    { id: crypto.randomUUID(), label: "Orang 2", method: "cash", allocations: {} },
  ]);
  const [activeGroupId, setActiveGroupId] = useState(groups[0].id);
  const [payingItemGroupId, setPayingItemGroupId] = useState<string | null>(null);

  // Sisa qty tiap item yang BELUM dialokasikan ke grup manapun (termasuk yang sudah split_billed_qty di server).
  const remainingQtyByItem = useMemo(() => {
    const allocatedElsewhere: Record<string, number> = {};
    for (const g of groups) {
      for (const [itemId, qty] of Object.entries(g.allocations)) {
        allocatedElsewhere[itemId] = (allocatedElsewhere[itemId] ?? 0) + qty;
      }
    }
    const result: Record<string, number> = {};
    for (const it of items) {
      const alreadyBilled = it.voided_qty + it.split_billed_qty;
      result[it.id] = Math.max(0, it.qty - alreadyBilled);
    }
    return { result, allocatedElsewhere };
  }, [items, groups]);

  function setAllocation(groupId: string, itemId: string, qty: number) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, allocations: { ...g.allocations, [itemId]: qty } } : g)));
  }

  function addGroup() {
    const id = crypto.randomUUID();
    setGroups((prev) => [...prev, { id, label: `Orang ${prev.length + 1}`, method: "cash", allocations: {} }]);
    setActiveGroupId(id);
  }

  function removeGroup(id: string) {
    setGroups((prev) => (prev.length > 1 ? prev.filter((g) => g.id !== id) : prev));
    if (activeGroupId === id) setActiveGroupId(groups[0].id);
  }

  function groupTotal(g: ItemGroup) {
    return Object.entries(g.allocations).reduce((sum, [itemId, qty]) => {
      const item = items.find((i) => i.id === itemId);
      return sum + (item ? item.unit_price * qty : 0);
    }, 0);
  }

  async function payItemGroup(group: ItemGroup) {
    const allocations = Object.entries(group.allocations).filter(([, qty]) => qty > 0);
    if (allocations.length === 0) {
      alert(`${group.label} belum memilih item apa pun.`);
      return;
    }
    const total = groupTotal(group);
    setPayingItemGroupId(group.id);
    const { data, error } = await supabase.rpc("checkout_order_split_by_item", {
      p_order_id: orderId,
      p_invoice_number: generateInvoiceNumber(),
      p_item_allocations: allocations.map(([order_item_id, qty]) => ({ order_item_id, qty })),
      p_payments: [{ method: group.method, amount: total }],
      p_split_label: group.label,
      p_member_code: null,
    });
    setPayingItemGroupId(null);
    if (error) {
      if (error.message.includes("SPLIT_QTY_EXCEEDS")) alert("Sebagian item ini sudah dibayar di sub-bill lain — muat ulang bill.");
      else alert(`Gagal membayar bagian ${group.label}: ` + error.message);
      return;
    }
    // Hapus grup yang sudah lunas dari daftar & beri tahu parent.
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    onSettled(data as string, /* orderFullySettled dicek ulang oleh parent lewat reload */ false);
  }

  return (
    <Modal title="Split Bill" onClose={onClose} maxWidth="sm:max-w-md">
      <div className="space-y-4">
        <p className="text-lg font-bold text-primary">{formatRupiah(totalDue)}</p>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("AMOUNT")}
            className={`flex-1 text-sm py-2 rounded-lg border flex items-center justify-center gap-1.5 ${mode === "AMOUNT" ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"}`}
          >
            <Users size={14} /> Split by Amount
          </button>
          <button
            onClick={() => setMode("ITEM")}
            className={`flex-1 text-sm py-2 rounded-lg border flex items-center justify-center gap-1.5 ${mode === "ITEM" ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"}`}
          >
            <Layers size={14} /> Split by Item
          </button>
        </div>

        {mode === "AMOUNT" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">Jumlah orang</span>
              <div className="flex items-center gap-1">
                <button onClick={() => resetEqualSplit(Math.max(2, peopleCount - 1))} className="w-7 h-7 rounded-lg border border-neutral-200 flex items-center justify-center">-</button>
                <span className="w-6 text-center font-semibold">{peopleCount}</span>
                <button onClick={() => resetEqualSplit(Math.min(10, peopleCount + 1))} className="w-7 h-7 rounded-lg border border-neutral-200 flex items-center justify-center">+</button>
              </div>
              <span className="text-xs text-neutral-400">(rata otomatis, bisa disesuaikan)</span>
            </div>

            <div className="space-y-2">
              {shares.map((s, idx) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input
                    value={s.label}
                    onChange={(e) => setShares((prev) => prev.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                    className="input-field w-24 shrink-0 text-sm py-1.5"
                  />
                  <select
                    value={s.method}
                    onChange={(e) => setShares((prev) => prev.map((x) => (x.id === s.id ? { ...x, method: e.target.value as PaymentMethod } : x)))}
                    className="input-field w-28 shrink-0 text-sm py-1.5"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatNumberWithDots(s.amount)}
                    onChange={(e) => setShares((prev) => prev.map((x) => (x.id === s.id ? { ...x, amount: stripNumberDots(e.target.value) } : x)))}
                    className="input-field flex-1 text-sm py-1.5"
                  />
                </div>
              ))}
            </div>

            <div className="border-t border-neutral-100 pt-2 flex justify-between text-sm">
              <span className={amountRemaining === 0 ? "text-emerald-600 font-semibold" : "text-urgent font-semibold"}>
                {amountRemaining === 0 ? "Pas" : amountRemaining > 0 ? `Kurang ${formatRupiah(amountRemaining)}` : `Kelebihan ${formatRupiah(-amountRemaining)}`}
              </span>
            </div>

            <button disabled={payingAmount || amountRemaining !== 0} onClick={paySplitByAmount} className="btn-primary w-full flex items-center justify-center gap-2">
              {payingAmount && <Loader2 className="animate-spin" size={16} />} Selesaikan Pembayaran ({peopleCount} bagian)
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border ${activeGroupId === g.id ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"}`}
                >
                  {g.label} — {formatRupiah(groupTotal(g))}
                </button>
              ))}
              <button onClick={addGroup} className="px-2 py-1.5 rounded-lg border border-dashed border-neutral-300 text-neutral-400">
                <Plus size={14} />
              </button>
            </div>

            {groups.map((g) => {
              if (g.id !== activeGroupId) return null;
              return (
                <div key={g.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={g.label}
                      onChange={(e) => setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)))}
                      className="input-field flex-1 text-sm py-1.5"
                    />
                    <select
                      value={g.method}
                      onChange={(e) => setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, method: e.target.value as PaymentMethod } : x)))}
                      className="input-field w-28 shrink-0 text-sm py-1.5"
                    >
                      {METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    {groups.length > 1 && (
                      <button onClick={() => removeGroup(g.id)} className="text-neutral-300 hover:text-urgent p-1 shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {items.map((it) => {
                      const alreadyBilled = it.voided_qty + it.split_billed_qty;
                      const totalAvailable = it.qty - alreadyBilled;
                      const allocatedElsewhere = Object.entries(remainingQtyByItem.allocatedElsewhere)
                        .filter(([id]) => id === it.id)
                        .reduce((s, [, q]) => s + q, 0) - (g.allocations[it.id] ?? 0);
                      const maxForThisGroup = Math.max(0, totalAvailable - allocatedElsewhere);
                      if (totalAvailable <= 0) return null;
                      return (
                        <div key={it.id} className="flex items-center justify-between text-sm">
                          <span className="min-w-0 truncate pr-2">{it.product_name} <span className="text-neutral-400 text-xs">(sisa {totalAvailable})</span></span>
                          <input
                            type="number"
                            min={0}
                            max={maxForThisGroup}
                            value={g.allocations[it.id] ?? 0}
                            onChange={(e) => setAllocation(g.id, it.id, Math.max(0, Math.min(maxForThisGroup, Number(e.target.value))))}
                            className="input-field w-16 text-center py-1 shrink-0"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-neutral-100 pt-2 flex justify-between font-bold text-sm">
                    <span>Subtotal {g.label}</span>
                    <span className="text-primary">{formatRupiah(groupTotal(g))}</span>
                  </div>

                  <button
                    disabled={payingItemGroupId === g.id || groupTotal(g) <= 0}
                    onClick={() => payItemGroup(g)}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {payingItemGroupId === g.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                    Bayar Bagian {g.label}
                  </button>
                </div>
              );
            })}

            <p className="text-xs text-neutral-400 text-center">Setiap bagian dibayar terpisah — tidak perlu bersamaan.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
