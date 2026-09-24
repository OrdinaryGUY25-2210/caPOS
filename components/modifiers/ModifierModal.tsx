"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import Modal from "@/components/Modal";
import type { ModifierGroup, Modifier, ModifierIngredientImpact, Ingredient } from "@/lib/types";

/**
 * Variant & Modifier §5 — form 1 pilihan modifier (mis. "Less Sugar") +
 * dampaknya ke bahan baku, dipisah dari app/dashboard/modifiers/page.tsx.
 * Baris dampak ini yang bikin modifier tidak terasa "terpisah" dari sistem
 * resep/stok — pilihan pelanggan ikut memotong/menambah bahan baku.
 */
export default function ModifierModal({
  group,
  modifier,
  ingredients,
  existingImpacts,
  saving,
  onClose,
  onSave,
}: {
  group: ModifierGroup;
  modifier: Modifier | null;
  ingredients: Ingredient[];
  existingImpacts: ModifierIngredientImpact[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Partial<Modifier> & { name: string; price_adjustment: number }, impacts: { ingredient_id: string; quantity_delta: number; unit: string }[]) => void;
}) {
  const [name, setName] = useState(modifier?.name ?? "");
  const [priceInput, setPriceInput] = useState(String(modifier?.price_adjustment ?? 0));
  const [impacts, setImpacts] = useState(
    existingImpacts.map((i) => ({ ingredient_id: i.ingredient_id, quantity_delta: i.quantity_delta, unit: i.unit }))
  );

  function addImpactRow() {
    const first = ingredients[0];
    if (!first) return;
    setImpacts((prev) => [...prev, { ingredient_id: first.id, quantity_delta: 0, unit: first.inventory_unit }]);
  }

  return (
    <Modal
      title={modifier ? `Edit Pilihan — ${modifier.name}` : `Tambah Pilihan — ${group.name}`}
      onClose={onClose}
      maxWidth="sm:max-w-lg"
      footer={
        <button
          disabled={saving || !name.trim()}
          onClick={() => onSave({ id: modifier?.id, name: name.trim(), price_adjustment: Number(priceInput || 0), is_available: modifier?.is_available }, impacts)}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Pilihan</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Less Sugar" className="input-field" />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Selisih Harga (Rp)</label>
        <input
          type="text"
          inputMode="numeric"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value.replace(/[^0-9-]/g, ""))}
          placeholder="0 kalau tidak menambah harga"
          className="input-field"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-neutral-700">Dampak ke Bahan Baku (opsional)</label>
          <button onClick={addImpactRow} type="button" className="text-xs text-primary-dark font-medium flex items-center gap-1">
            <Plus size={12} /> Tambah
          </button>
        </div>
        <p className="text-xs text-neutral-400 mb-2">
          Contoh: &quot;Less Sugar&quot; = -5g gula sirup. Boleh negatif (mengurangi) atau positif (menambah, mis. Extra Shot).
        </p>
        <div className="space-y-2">
          {impacts.map((impact, idx) => {
            const ing = ingredients.find((i) => i.id === impact.ingredient_id);
            return (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={impact.ingredient_id}
                  onChange={(e) => {
                    const next = [...impacts];
                    const newIng = ingredients.find((i) => i.id === e.target.value);
                    next[idx] = { ...next[idx], ingredient_id: e.target.value, unit: newIng?.inventory_unit ?? next[idx].unit };
                    setImpacts(next);
                  }}
                  className="input-field flex-1 text-sm"
                >
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={String(impact.quantity_delta)}
                  onChange={(e) => {
                    const next = [...impacts];
                    next[idx] = { ...next[idx], quantity_delta: Number(e.target.value.replace(/[^0-9.-]/g, "") || 0) };
                    setImpacts(next);
                  }}
                  className="input-field w-20 text-sm"
                />
                <span className="text-xs text-neutral-400 w-14">{ing?.inventory_unit}</span>
                <button onClick={() => setImpacts(impacts.filter((_, i) => i !== idx))} type="button" className="text-neutral-400 hover:text-urgent text-xs">
                  Hapus
                </button>
              </div>
            );
          })}
          {impacts.length === 0 && <p className="text-neutral-300 text-xs">Belum ada dampak bahan.</p>}
        </div>
      </div>
    </Modal>
  );
}
