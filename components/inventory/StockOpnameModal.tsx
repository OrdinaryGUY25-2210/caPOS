"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import type { Ingredient } from "@/lib/types";

const REASON_OPTIONS = [
  { value: "expired", label: "Bahan Basi/Expired" },
  { value: "damaged", label: "Rusak/Tumpah" },
  { value: "cashier_discrepancy", label: "Selisih Transaksi Kasir" },
  { value: "input_correction", label: "Koreksi Input" },
] as const;

/**
 * Inventory §7 — "Stock opname" untuk 1 bahan langsung dari Ingredients
 * (bukan sesi opname penuh semua bahan). Memakai RPC
 * `submit_stock_opname_item` yang sama persis dengan sesi penuh di
 * /dashboard/stock-opname (migration_16) — supaya angka & riwayatnya tetap
 * satu sumber kebenaran, cuma jalan pintasnya yang beda.
 */
export default function StockOpnameModal({
  ingredient,
  branchId,
  systemQty,
  onClose,
  onSubmitted,
}: {
  ingredient: Ingredient;
  branchId: string;
  systemQty: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [physicalInput, setPhysicalInput] = useState(String(systemQty));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const physical = physicalInput === "" ? 0 : Number(physicalInput);
  const difference = physical - systemQty;
  const needsReason = difference !== 0;

  async function submit() {
    if (needsReason && !reason) {
      alert("Pilih alasan selisih dulu sebelum disimpan.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_stock_opname_item", {
      p_branch_id: branchId,
      p_ingredient_id: ingredient.id,
      p_physical_qty: physical,
      p_reason: reason || null,
      p_note: note || null,
    });
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan opname: " + error.message);
      return;
    }
    onSubmitted();
    onClose();
  }

  return (
    <Modal
      title={`Stok Opname — ${ingredient.name}`}
      onClose={onClose}
      footer={
        <button disabled={saving} onClick={submit} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Hasil Hitung
        </button>
      }
    >
      <p className="text-sm text-neutral-500">
        Stok sistem saat ini: <span className="font-semibold text-neutral-900">{systemQty} {ingredient.inventory_unit}</span>
      </p>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Hasil Hitung Fisik ({ingredient.inventory_unit})</label>
        <input
          type="text"
          inputMode="decimal"
          value={physicalInput}
          onChange={(e) => setPhysicalInput(e.target.value.replace(/[^0-9.]/g, ""))}
          className="input-field"
        />
      </div>
      {difference !== 0 && (
        <p className={difference > 0 ? "text-primary-dark text-sm" : "text-urgent text-sm"}>
          Selisih: {difference > 0 ? "+" : ""}{difference} {ingredient.inventory_unit}
        </p>
      )}
      {needsReason && (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan Selisih</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="input-field">
            <option value="">Pilih alasan...</option>
            {REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan (opsional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input-field" />
      </div>
    </Modal>
  );
}
