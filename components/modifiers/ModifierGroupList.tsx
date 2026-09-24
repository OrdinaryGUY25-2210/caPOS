"use client";

import { Plus, Pencil, ChevronDown, ChevronRight, Link2, SlidersHorizontal } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import type { ModifierGroup, Modifier, ModifierIngredientImpact } from "@/lib/types";

/**
 * Variant & Modifier §5 — daftar grup modifier (accordion), dipisah dari
 * app/dashboard/modifiers/page.tsx.
 */
export default function ModifierGroupList({
  groups,
  modifiersByGroup,
  impactsByModifier,
  assignedCountByGroup,
  expanded,
  canWrite,
  onToggleExpand,
  onAddGroup,
  onEditGroup,
  onAssign,
  onAddModifier,
  onEditModifier,
  onToggleModifierAvailable,
}: {
  groups: ModifierGroup[];
  modifiersByGroup: Map<string, Modifier[]>;
  impactsByModifier: Map<string, (ModifierIngredientImpact & { ingredient_name: string })[]>;
  assignedCountByGroup: Map<string, number>;
  expanded: Set<string>;
  canWrite: boolean;
  onToggleExpand: (id: string) => void;
  onAddGroup: () => void;
  onEditGroup: (group: ModifierGroup) => void;
  onAssign: (group: ModifierGroup) => void;
  onAddModifier: (group: ModifierGroup) => void;
  onEditModifier: (group: ModifierGroup, modifier: Modifier) => void;
  onToggleModifierAvailable: (modifier: Modifier) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <SlidersHorizontal size={20} className="text-primary-dark" /> Modifier
          </h1>
          <p className="text-sm text-neutral-500">Kelola grup pilihan (mis. Gula, Es, Topping) dan dampaknya ke bahan baku.</p>
        </div>
        {canWrite && (
          <button onClick={onAddGroup} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Tambah Grup
          </button>
        )}
      </div>

      <div className="space-y-3">
        {groups.map((group) => {
          const mods = modifiersByGroup.get(group.id) ?? [];
          const isOpen = expanded.has(group.id);
          const assignedCount = assignedCountByGroup.get(group.id) ?? 0;
          return (
            <div key={group.id} className="card overflow-hidden">
              <button onClick={() => onToggleExpand(group.id)} className="w-full flex items-center justify-between p-4 text-left">
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {group.name} {group.is_required && <span className="text-urgent text-xs ml-1">Wajib</span>}
                    </p>
                    <p className="text-xs text-neutral-400">
                      Pilih {group.min_select}–{group.max_select} · {mods.length} pilihan · dipakai {assignedCount} menu
                    </p>
                  </div>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1">
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAssign(group);
                      }}
                      className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5"
                      title="Pasang ke Menu"
                    >
                      <Link2 size={16} />
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditGroup(group);
                      }}
                      className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5"
                      title="Edit Grup"
                    >
                      <Pencil size={16} />
                    </span>
                  </div>
                )}
              </button>

              {isOpen && (
                <div className="border-t border-neutral-100 p-4 space-y-2">
                  {mods.map((m) => {
                    const impacts = impactsByModifier.get(m.id) ?? [];
                    return (
                      <div key={m.id} className="flex items-center justify-between text-sm border-b border-neutral-50 pb-2 last:border-0">
                        <div>
                          <p className={cx("font-medium", m.is_available ? "text-neutral-900" : "text-neutral-400 line-through")}>{m.name}</p>
                          {impacts.length > 0 && (
                            <p className="text-xs text-neutral-400">
                              Dampak bahan: {impacts.map((i) => `${i.ingredient_name} ${i.quantity_delta > 0 ? "+" : ""}${i.quantity_delta}${i.unit}`).join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-neutral-600">
                            {m.price_adjustment > 0 ? "+" : ""}
                            {formatRupiah(m.price_adjustment)}
                          </span>
                          {canWrite && (
                            <>
                              <button onClick={() => onToggleModifierAvailable(m)} className="text-xs text-neutral-400 hover:text-neutral-700">
                                {m.is_available ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                              <button onClick={() => onEditModifier(group, m)} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1">
                                <Pencil size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canWrite && (
                    <button onClick={() => onAddModifier(group)} className="text-sm text-primary-dark font-medium flex items-center gap-1 pt-1">
                      <Plus size={14} /> Tambah Pilihan
                    </button>
                  )}
                  {mods.length === 0 && !canWrite && <p className="text-neutral-400 text-sm">Belum ada pilihan di grup ini.</p>}
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <div className="card p-8 text-center text-neutral-400">Belum ada grup modifier.</div>}
      </div>
    </div>
  );
}
