"use client";

import Modal from "@/components/Modal";
import type { ModifierGroup, Product } from "@/lib/types";

/**
 * Variant & Modifier §5 — "pasang grup modifier ke menu mana saja",
 * dipisah dari app/dashboard/modifiers/page.tsx. Ini yang membuat modifier
 * tersambung ke Menu (bukan entitas lepas) — persis yang diminta spec:
 * "User tidak merasa variant/modifier adalah fitur tambahan yang terpisah".
 */
export default function ProductAssignModal({
  group,
  products,
  assignedProductIds,
  onClose,
  onToggle,
}: {
  group: ModifierGroup;
  products: Product[];
  assignedProductIds: Set<string>;
  onClose: () => void;
  onToggle: (product: Product) => void;
}) {
  return (
    <Modal title={`Pasang "${group.name}" ke Menu`} onClose={onClose} maxWidth="sm:max-w-md">
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {products.map((p) => {
          const checked = assignedProductIds.has(p.id);
          return (
            <label key={p.id} className="flex items-center gap-2 text-sm py-1.5">
              <input type="checkbox" checked={checked} onChange={() => onToggle(p)} className="rounded" />
              {p.name}
            </label>
          );
        })}
        {products.length === 0 && <p className="text-neutral-400 text-sm">Belum ada menu.</p>}
      </div>
    </Modal>
  );
}
