"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Banknote, QrCode, CreditCard, Wallet2, Landmark } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatNumberWithDots, stripNumberDots, generateInvoiceNumber } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/types";

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Tunai", icon: Banknote },
  { value: "qris", label: "QRIS", icon: QrCode },
  { value: "debit", label: "Debit", icon: CreditCard },
  { value: "credit", label: "Kredit", icon: CreditCard },
  { value: "ewallet", label: "E-Wallet", icon: Wallet2 },
  { value: "bank_transfer", label: "Transfer", icon: Landmark },
];

interface PaymentLine {
  id: string;
  method: PaymentMethod;
  amount: string; // raw digits, formatted for display
}

/**
 * Modal pembayaran untuk order KDS yang sudah READY/SERVED — mendukung
 * split payment (mis. Rp50.000 Tunai + Rp100.000 QRIS untuk 1 transaksi).
 * Total baris pembayaran divalidasi ulang di server (checkout_order_v2)
 * — modal ini hanya membantu kasir menyusun rinciannya sebelum dikirim,
 * bukan sumber kebenaran nominal.
 *
 * Catatan pemisahan integrasi (lihat spesifikasi Phase 2 poin 4):
 * Ini BUKAN Midtrans — Midtrans di caPOS khusus untuk pembayaran
 * langganan SaaS Owner (lihat lib/midtransPlans.ts). Pembayaran kasir
 * di sini murni mencatat metode (EDC/QRIS merchant kafe sendiri, dsb),
 * tidak memproses pembayaran kartu/QRIS itu sendiri.
 */
export default function MultiPaymentModal({
  orderId,
  totalDue,
  onPaid,
  onClose,
}: {
  orderId: string;
  totalDue: number;
  onPaid: (transactionId: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [memberCode, setMemberCode] = useState("");
  const [lines, setLines] = useState<PaymentLine[]>([{ id: crypto.randomUUID(), method: "cash", amount: String(totalDue) }]);
  const [saving, setSaving] = useState(false);

  const paidSoFar = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const remaining = totalDue - paidSoFar;

  function updateLine(id: string, patch: Partial<PaymentLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), method: "qris", amount: remaining > 0 ? String(remaining) : "" }]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  async function handlePay() {
    if (remaining !== 0) {
      alert(remaining > 0 ? `Kurang ${formatRupiah(remaining)} lagi.` : `Kelebihan ${formatRupiah(-remaining)} — sesuaikan nominal.`);
      return;
    }
    if (lines.some((l) => !l.amount || Number(l.amount) <= 0)) {
      alert("Setiap baris pembayaran harus punya nominal lebih dari 0.");
      return;
    }

    setSaving(true);
    const { data, error } = await supabase.rpc("checkout_order_v2", {
      p_order_id: orderId,
      p_invoice_number: generateInvoiceNumber(),
      p_member_code: memberCode || null,
      p_payments: lines.map((l) => ({ method: l.method, amount: Number(l.amount) })),
    });
    setSaving(false);

    if (error) {
      if (error.message.includes("PAYMENT_MISMATCH")) {
        alert("Total pembayaran tidak sama dengan total tagihan (mungkin ada diskon member yang belum dihitung ulang). Coba lagi.");
      } else {
        alert("Gagal memproses pembayaran: " + error.message);
      }
      return;
    }

    onPaid(data as string);
  }

  return (
    <Modal
      title="Pembayaran"
      onClose={onClose}
      footer={
        <button disabled={saving} onClick={handlePay} className="btn-primary w-full flex items-center justify-center gap-2">
          {saving && <Loader2 className="animate-spin" size={16} />} Selesaikan Pembayaran
        </button>
      }
    >
      <p className="text-2xl font-bold text-primary">{formatRupiah(totalDue)}</p>

      <div className="flex gap-2">
        <input
          value={memberCode}
          onChange={(e) => setMemberCode(e.target.value)}
          placeholder="Kode Member (opsional)"
          className="input-field text-sm"
        />
      </div>

      <div className="space-y-2">
        {lines.map((line) => {
          const Icon = METHODS.find((m) => m.value === line.method)?.icon ?? Banknote;
          return (
            <div key={line.id} className="flex items-center gap-2">
              <div className="relative w-32 shrink-0">
                <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                <select
                  value={line.method}
                  onChange={(e) => updateLine(line.id, { method: e.target.value as PaymentMethod })}
                  className="input-field pl-8 text-sm appearance-none"
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberWithDots(line.amount)}
                onChange={(e) => updateLine(line.id, { amount: stripNumberDots(e.target.value) })}
                placeholder="Nominal"
                className="input-field flex-1 text-sm"
              />
              {lines.length > 1 && (
                <button onClick={() => removeLine(line.id)} className="text-neutral-300 hover:text-urgent p-1 shrink-0">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}

        <button onClick={addLine} className="text-xs text-primary font-medium flex items-center gap-1 pt-1">
          <Plus size={13} /> Tambah Metode Pembayaran (Split Bill)
        </button>
      </div>

      <div className="border-t border-neutral-100 pt-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-neutral-500">Sudah diisi</span><span>{formatRupiah(paidSoFar)}</span></div>
        <div className={`flex justify-between font-bold ${remaining === 0 ? "text-emerald-600" : remaining > 0 ? "text-urgent" : "text-amber-600"}`}>
          <span>{remaining > 0 ? "Kurang" : remaining < 0 ? "Kelebihan" : "Pas"}</span>
          <span>{formatRupiah(Math.abs(remaining))}</span>
        </div>
      </div>
    </Modal>
  );
}
