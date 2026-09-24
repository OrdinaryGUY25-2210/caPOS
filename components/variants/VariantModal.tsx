"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import type { ProductVariant } from "@/lib/types";

/**
 * Variant & Modifier §5 — form tambah/edit 1 varian produk, dipisah dari
 * app/dashboard/variants/page.tsx (sebelumnya `VariantModal` lokal di file
 * itu).
 */
export default function VariantModal({
  variant,
  basePrice,
  saving,
  onClose,
  onSave,
}: {
  variant: ProductVariant | null;
  basePrice: number;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Partial<ProductVariant> & { name: string; price: number }) => void;
}) {
  const [name, setName] = useState(variant?.name ?? "");
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [priceInput, setPriceInput] = useState(String(variant?.price ?? basePrice));
  const [costInput, setCostInput] = useState(variant?.cost_price ? String(variant.cost_price) : "");
  const canSubmit = name.trim() && priceInput !== "";

  return (
    <Modal
      title={variant ? `Edit Varian — ${variant.name}` : "Tambah Varian"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !canSubmit}
          onClick={() =>
            onSave({
              id: variant?.id,
              name: name.trim(),
              sku: sku.trim() || null,
              price: Number(priceInput || 0),
              cost_price: costInput ? Number(costInput) : null,
              is_available: variant?.is_available,
              display_order: variant?.display_order,
            })
          }
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Varian</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Large" className="input-field" />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">SKU (opsional)</label>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Contoh: EKS-L" className="input-field" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Harga Jual</label>
          <input
            type="text"
            inputMode="numeric"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">HPP (opsional)</label>
          <input
            type="text"
            inputMode="numeric"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Otomatis dari resep kalau kosong"
            className="input-field"
          />
        </div>
      </div>
      <p className="text-xs text-neutral-400">
        Setelah varian dibuat, hubungkan resepnya di halaman <strong>Resep</strong> untuk menghitung HPP otomatis dari bahan
        baku.
      </p>
    </Modal>
  );
}
