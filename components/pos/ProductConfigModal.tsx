"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Check } from "lucide-react";
import Modal from "@/components/Modal";
import { cx, formatRupiah } from "@/lib/utils";
import type { Modifier, ModifierGroup, Product, ProductVariant } from "@/lib/types";

export interface ProductGroupWithModifiers {
  group: ModifierGroup;
  modifiers: Modifier[];
}

export interface ConfiguredCartPayload {
  product: Product;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  modifiers: { modifier_id: string; name: string; price_adjustment: number }[];
  qty: number;
}

/**
 * Phase 2A.3 §5 — dipakai HANYA untuk produk yang punya varian dan/atau
 * modifier group terpasang (lihat productHasConfig() di app/pos/page.tsx).
 * Produk polos tetap langsung masuk keranjang tanpa modal ini sama sekali
 * (Requirement 23 — jangan menambah langkah kalau memang tidak perlu).
 *
 * Semua harga di sini HANYA untuk pratinjau kasir. Harga final yang
 * benar-benar tercatat tetap dihitung ulang server-side di
 * create_kitchen_order() (Requirement 6/26) — modal ini tidak pernah jadi
 * sumber kebenaran harga.
 */
export default function ProductConfigModal({
  product,
  variants,
  groups,
  onConfirm,
  onClose,
}: {
  product: Product;
  variants: ProductVariant[];
  groups: ProductGroupWithModifiers[];
  onConfirm: (payload: ConfiguredCartPayload) => void;
  onClose: () => void;
}) {
  const availableVariants = variants.filter((v) => v.is_available);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    availableVariants.length > 0 ? availableVariants[0].id : null
  );
  // groupId -> Set(modifierId) — mendukung multi-pilih per group (max_select > 1).
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [qty, setQty] = useState(1);
  const [touchedRequired, setTouchedRequired] = useState(false);

  const selectedVariant = availableVariants.find((v) => v.id === selectedVariantId) ?? null;
  const basePrice = selectedVariant ? selectedVariant.price : product.price;

  const selectedModifiers = useMemo(() => {
    const out: { modifier_id: string; name: string; price_adjustment: number }[] = [];
    for (const { modifiers } of groups) {
      for (const m of modifiers) {
        if (selections[m.modifier_group_id]?.has(m.id)) {
          out.push({ modifier_id: m.id, name: m.name, price_adjustment: m.price_adjustment });
        }
      }
    }
    return out;
  }, [groups, selections]);

  const unitPrice = basePrice + selectedModifiers.reduce((sum, m) => sum + m.price_adjustment, 0);

  // Requirement 5 — grup wajib (is_required, atau min_select > 0) harus
  // memenuhi jumlah pilihan minimum sebelum item boleh masuk keranjang.
  const unmetRequiredGroups = groups.filter(({ group }) => {
    if (!group.is_required && group.min_select <= 0) return false;
    const count = selections[group.id]?.size ?? 0;
    return count < Math.max(group.min_select, 1);
  });
  const canConfirm = unmetRequiredGroups.length === 0;

  function toggleModifier(group: ModifierGroup, modifier: Modifier) {
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[group.id] ?? []);
      const single = group.max_select <= 1;

      if (current.has(modifier.id)) {
        current.delete(modifier.id);
      } else {
        if (single) {
          current.clear();
          current.add(modifier.id);
        } else if (current.size < group.max_select) {
          current.add(modifier.id);
        } else {
          // Sudah di batas max_select — abaikan tap ini, tidak melempar error
          // supaya kasir tidak perlu baca dialog di tengah jam sibuk.
          return prev;
        }
      }
      next[group.id] = current;
      return next;
    });
  }

  function handleConfirm() {
    if (!canConfirm) {
      setTouchedRequired(true);
      return;
    }
    onConfirm({
      product,
      variantId: selectedVariant?.id ?? null,
      variantName: selectedVariant?.name ?? null,
      unitPrice,
      modifiers: selectedModifiers,
      qty,
    });
  }

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {touchedRequired && !canConfirm && (
            <p className="text-xs text-urgent">
              Pilih dulu: {unmetRequiredGroups.map((g) => g.group.name).join(", ")}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100"
                aria-label="Kurangi jumlah"
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center text-sm font-semibold">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100"
                aria-label="Tambah jumlah"
              >
                <Plus size={14} />
              </button>
            </div>
            <button onClick={handleConfirm} className="btn-primary flex-1">
              Tambah · {formatRupiah(unitPrice * qty)}
            </button>
          </div>
        </div>
      }
    >
      {availableVariants.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neutral-500 uppercase mb-2">Varian</p>
          <div className="space-y-1.5">
            {availableVariants.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVariantId(v.id)}
                className={cx(
                  "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm text-left",
                  selectedVariantId === v.id ? "border-primary bg-primary/5" : "border-neutral-200 hover:bg-neutral-50"
                )}
              >
                <span className="flex items-center gap-2 text-neutral-800">
                  <span
                    className={cx(
                      "w-4 h-4 rounded-full border flex items-center justify-center shrink-0",
                      selectedVariantId === v.id ? "border-primary bg-primary text-white" : "border-neutral-300"
                    )}
                  >
                    {selectedVariantId === v.id && <Check size={10} />}
                  </span>
                  {v.name}
                </span>
                <span className="text-neutral-500">{formatRupiah(v.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.map(({ group, modifiers }) => {
        const activeModifiers = modifiers.filter((m) => m.is_available);
        if (activeModifiers.length === 0) return null;
        const single = group.max_select <= 1;
        const isRequired = group.is_required || group.min_select > 0;
        const count = selections[group.id]?.size ?? 0;

        return (
          <div key={group.id}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-neutral-500 uppercase">{group.name}</p>
              <span className="text-[10px] text-neutral-400">
                {isRequired ? `Wajib pilih ${group.min_select > 1 ? group.min_select : 1}` : "Opsional"}
                {group.max_select > 1 ? ` (maks ${group.max_select})` : ""}
              </span>
            </div>
            <div className="space-y-1.5">
              {activeModifiers.map((m) => {
                const checked = selections[group.id]?.has(m.id) ?? false;
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleModifier(group, m)}
                    className={cx(
                      "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm text-left",
                      checked ? "border-primary bg-primary/5" : "border-neutral-200 hover:bg-neutral-50"
                    )}
                  >
                    <span className="flex items-center gap-2 text-neutral-800">
                      <span
                        className={cx(
                          "w-4 h-4 border flex items-center justify-center shrink-0",
                          single ? "rounded-full" : "rounded",
                          checked ? "border-primary bg-primary text-white" : "border-neutral-300"
                        )}
                      >
                        {checked && <Check size={10} />}
                      </span>
                      {m.name}
                    </span>
                    <span className="text-neutral-500">
                      {m.price_adjustment === 0
                        ? "-"
                        : `${m.price_adjustment > 0 ? "+" : ""}${formatRupiah(m.price_adjustment)}`}
                    </span>
                  </button>
                );
              })}
            </div>
            {touchedRequired && isRequired && count < Math.max(group.min_select, 1) && (
              <p className="text-xs text-urgent mt-1">Pilih minimal {Math.max(group.min_select, 1)}.</p>
            )}
          </div>
        );
      })}
    </Modal>
  );
}
