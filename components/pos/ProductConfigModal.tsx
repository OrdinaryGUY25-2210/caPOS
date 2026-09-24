"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { cx, formatRupiah } from "@/lib/utils";
import type { Modifier, ModifierGroup, Product, ProductVariant } from "@/lib/types";
import { PosButton, QuantityStepper, SectionLabel, SelectableRow, ErrorState } from "./ui";

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

  const unitPrice = basePrice + selectedModifiers.reduce((s, m) => s + m.price_adjustment, 0);

  const unmetRequiredGroups = groups.filter(({ group }) => {
    if (!group.is_required && group.min_select <= 0) return false;
    return (selections[group.id]?.size ?? 0) < Math.max(group.min_select, 1);
  });
  const canConfirm = unmetRequiredGroups.length === 0;

  function toggleModifier(group: ModifierGroup, modifier: Modifier) {
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[group.id] ?? []);
      const single = group.max_select <= 1;
      if (current.has(modifier.id)) {
        current.delete(modifier.id);
      } else if (single) {
        current.clear();
        current.add(modifier.id);
      } else if (current.size < group.max_select) {
        current.add(modifier.id);
      } else {
        return prev;
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
            <ErrorState message={`Pilih dulu: ${unmetRequiredGroups.map((g) => g.group.name).join(", ")}`} />
          )}
          <div className="flex items-center gap-3">
            <QuantityStepper value={qty} onChange={setQty} min={1} ariaLabel="Jumlah item" />
            <PosButton onClick={handleConfirm} fullWidth>
              Tambah · {formatRupiah(unitPrice * qty)}
            </PosButton>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {availableVariants.length > 0 && (
          <div>
            <SectionLabel hint="Wajib pilih 1">Varian</SectionLabel>
            <div className="space-y-1.5">
              {availableVariants.map((v) => (
                <SelectableRow
                  key={v.id}
                  selected={selectedVariantId === v.id}
                  onClick={() => setSelectedVariantId(v.id)}
                  label={v.name}
                  trailing={formatRupiah(v.price)}
                />
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
          const hint = `${isRequired ? `Wajib ${Math.max(group.min_select, 1)}` : "Opsional"}${
            group.max_select > 1 ? ` · maks ${group.max_select}` : ""
          }`;
          return (
            <div key={group.id}>
              <SectionLabel hint={hint}>{group.name}</SectionLabel>
              <div className="space-y-1.5">
                {activeModifiers.map((m) => {
                  const checked = selections[group.id]?.has(m.id) ?? false;
                  return (
                    <SelectableRow
                      key={m.id}
                      selected={checked}
                      onClick={() => toggleModifier(group, m)}
                      radio={single}
                      label={m.name}
                      trailing={
                        m.price_adjustment === 0
                          ? "—"
                          : `${m.price_adjustment > 0 ? "+" : ""}${formatRupiah(m.price_adjustment)}`
                      }
                    />
                  );
                })}
              </div>
              {touchedRequired && isRequired && count < Math.max(group.min_select, 1) && (
                <p className="text-xs text-urgent mt-1">Pilih minimal {Math.max(group.min_select, 1)}.</p>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}