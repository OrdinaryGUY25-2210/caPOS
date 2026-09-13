"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Plus, Pencil, Loader2, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner } from "@/lib/role";
import Modal from "@/components/Modal";
import type { Product, ModifierGroup, Modifier, ModifierIngredientImpact, Ingredient, ProductModifierGroup } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";

/**
 * Kelola Modifier Groups & Modifiers (mis. "Sugar": Normal/Less/No/Extra) —
 * Phase 2A F&B Master Data. Dampak ke stok bahan (modifier_ingredient_impacts)
 * dipakai oleh consume_recipe()/recipe_ingredient_requirements() di DB — UI
 * ini HANYA mencatat data, tidak menghitung deduksi stok sendiri di frontend.
 */
export default function ModifiersPage() {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [modifiersByGroup, setModifiersByGroup] = useState<Map<string, Modifier[]>>(new Map());
  const [impactsByModifier, setImpactsByModifier] = useState<Map<string, (ModifierIngredientImpact & { ingredient_name: string })[]>>(new Map());
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [assignments, setAssignments] = useState<ProductModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("owner");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | "new" | null>(null);
  const [editingModifier, setEditingModifier] = useState<{ group: ModifierGroup; modifier: Modifier | null } | null>(null);
  const [assigningGroup, setAssigningGroup] = useState<ModifierGroup | null>(null);
  const [saving, setSaving] = useState(false);

  const canWrite = isManagerOrOwner(role);

  async function loadAll() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setRole(profile.role);
    const supabase = createClient();
    const [{ data: groupData }, { data: modData }, { data: impactData }, { data: ingData }, { data: prodData }, { data: assignData }] =
      await Promise.all([
        supabase.from("modifier_groups").select("*").eq("tenant_id", profile.tenant_id).order("display_order", { ascending: true }),
        supabase.from("modifiers").select("*, modifier_groups!inner(tenant_id)").eq("modifier_groups.tenant_id", profile.tenant_id).order("display_order", { ascending: true }),
        supabase
          .from("modifier_ingredient_impacts")
          .select("*, ingredients(name)")
          .order("id", { ascending: true }),
        supabase.from("ingredients").select("*").eq("tenant_id", profile.tenant_id).eq("status", "active").order("name", { ascending: true }),
        supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).order("name", { ascending: true }),
        supabase.from("product_modifier_groups").select("*"),
      ]);

    setGroups((groupData as ModifierGroup[]) ?? []);

    const modMap = new Map<string, Modifier[]>();
    for (const m of (modData as Modifier[]) ?? []) {
      const list = modMap.get(m.modifier_group_id) ?? [];
      list.push(m);
      modMap.set(m.modifier_group_id, list);
    }
    setModifiersByGroup(modMap);

    const impactMap = new Map<string, (ModifierIngredientImpact & { ingredient_name: string })[]>();
    for (const raw of (impactData as any[]) ?? []) {
      const row = { ...raw, ingredient_name: raw.ingredients?.name ?? "Bahan" };
      const list = impactMap.get(row.modifier_id) ?? [];
      list.push(row);
      impactMap.set(row.modifier_id, list);
    }
    setImpactsByModifier(impactMap);

    setIngredients((ingData as Ingredient[]) ?? []);
    setProducts((prodData as Product[]) ?? []);
    setAssignments((assignData as ProductModifierGroup[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveGroup(payload: Partial<ModifierGroup> & { name: string }) {
    setSaving(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setSaving(false);
      return;
    }
    const supabase = createClient();
    let error;
    if (payload.id) {
      ({ error } = await supabase
        .from("modifier_groups")
        .update({
          name: payload.name,
          is_required: payload.is_required ?? false,
          min_select: payload.min_select ?? 0,
          max_select: payload.max_select ?? 1,
        })
        .eq("id", payload.id));
    } else {
      ({ error } = await supabase.from("modifier_groups").insert({
        tenant_id: profile.tenant_id,
        name: payload.name,
        is_required: payload.is_required ?? false,
        min_select: payload.min_select ?? 0,
        max_select: payload.max_select ?? 1,
        display_order: groups.length,
      }));
    }
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan: " + error.message);
      return;
    }
    setEditingGroup(null);
    loadAll();
  }

  async function saveModifier(
    group: ModifierGroup,
    payload: Partial<Modifier> & { name: string; price_adjustment: number },
    impacts: { ingredient_id: string; quantity_delta: number; unit: string }[]
  ) {
    setSaving(true);
    const supabase = createClient();
    let modifierId = payload.id;
    let error;
    if (modifierId) {
      ({ error } = await supabase
        .from("modifiers")
        .update({
          name: payload.name,
          price_adjustment: payload.price_adjustment,
          is_available: payload.is_available ?? true,
        })
        .eq("id", modifierId));
    } else {
      const existing = modifiersByGroup.get(group.id) ?? [];
      const { data, error: insertError } = await supabase
        .from("modifiers")
        .insert({
          modifier_group_id: group.id,
          name: payload.name,
          price_adjustment: payload.price_adjustment,
          is_available: true,
          display_order: existing.length,
        })
        .select()
        .single();
      error = insertError;
      modifierId = data?.id;
    }
    if (error || !modifierId) {
      setSaving(false);
      alert("Gagal menyimpan: " + error?.message);
      return;
    }

    // Ganti seluruh dampak ingredient modifier ini: hapus lama, insert baru
    // (lebih sederhana & aman daripada diff per baris untuk daftar pendek ini).
    await supabase.from("modifier_ingredient_impacts").delete().eq("modifier_id", modifierId);
    if (impacts.length > 0) {
      const { error: impactError } = await supabase.from("modifier_ingredient_impacts").insert(
        impacts.map((i) => ({ modifier_id: modifierId, ingredient_id: i.ingredient_id, quantity_delta: i.quantity_delta, unit: i.unit }))
      );
      if (impactError) {
        setSaving(false);
        alert("Modifier tersimpan, tapi gagal menyimpan dampak bahan: " + impactError.message);
        loadAll();
        return;
      }
    }

    setSaving(false);
    setEditingModifier(null);
    loadAll();
  }

  async function toggleModifierAvailable(m: Modifier) {
    const supabase = createClient();
    const { error } = await supabase.from("modifiers").update({ is_available: !m.is_available }).eq("id", m.id);
    if (error) {
      alert("Gagal: " + error.message);
      return;
    }
    loadAll();
  }

  async function toggleAssignment(product: Product, group: ModifierGroup) {
    const supabase = createClient();
    const existing = assignments.find((a) => a.product_id === product.id && a.modifier_group_id === group.id);
    if (existing) {
      const { error } = await supabase.from("product_modifier_groups").delete().eq("id", existing.id);
      if (error) {
        alert("Gagal: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("product_modifier_groups").insert({ product_id: product.id, modifier_group_id: group.id, display_order: 0 });
      if (error) {
        alert("Gagal: " + error.message);
        return;
      }
    }
    loadAll();
  }

  const assignedProductsFor = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of assignments) {
      const set = map.get(a.modifier_group_id) ?? new Set<string>();
      set.add(a.product_id);
      map.set(a.modifier_group_id, set);
    }
    return map;
  }, [assignments]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-72" />
        </div>
        <SkeletonList rows={5} withAvatar={false} />
      </div>
    );
  }

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
          <button onClick={() => setEditingGroup("new")} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Tambah Grup
          </button>
        )}
      </div>

      <div className="space-y-3">
        {groups.map((group) => {
          const mods = modifiersByGroup.get(group.id) ?? [];
          const isOpen = expanded.has(group.id);
          const assignedCount = assignedProductsFor.get(group.id)?.size ?? 0;
          return (
            <div key={group.id} className="card overflow-hidden">
              <button onClick={() => toggleExpand(group.id)} className="w-full flex items-center justify-between p-4 text-left">
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
                        setAssigningGroup(group);
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
                        setEditingGroup(group);
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
                              <button onClick={() => toggleModifierAvailable(m)} className="text-xs text-neutral-400 hover:text-neutral-700">
                                {m.is_available ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                              <button onClick={() => setEditingModifier({ group, modifier: m })} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1">
                                <Pencil size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canWrite && (
                    <button
                      onClick={() => setEditingModifier({ group, modifier: null })}
                      className="text-sm text-primary-dark font-medium flex items-center gap-1 pt-1"
                    >
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

      {editingGroup && (
        <ModifierGroupModal group={editingGroup === "new" ? null : editingGroup} saving={saving} onClose={() => setEditingGroup(null)} onSave={saveGroup} />
      )}

      {editingModifier && (
        <ModifierModal
          group={editingModifier.group}
          modifier={editingModifier.modifier}
          ingredients={ingredients}
          existingImpacts={editingModifier.modifier ? impactsByModifier.get(editingModifier.modifier.id) ?? [] : []}
          saving={saving}
          onClose={() => setEditingModifier(null)}
          onSave={(payload, impacts) => saveModifier(editingModifier.group, payload, impacts)}
        />
      )}

      {assigningGroup && (
        <Modal title={`Pasang "${assigningGroup.name}" ke Menu`} onClose={() => setAssigningGroup(null)} maxWidth="sm:max-w-md">
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {products.map((p) => {
              const checked = assignedProductsFor.get(assigningGroup.id)?.has(p.id) ?? false;
              return (
                <label key={p.id} className="flex items-center gap-2 text-sm py-1.5">
                  <input type="checkbox" checked={checked} onChange={() => toggleAssignment(p, assigningGroup)} className="rounded" />
                  {p.name}
                </label>
              );
            })}
            {products.length === 0 && <p className="text-neutral-400 text-sm">Belum ada menu.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModifierGroupModal({
  group,
  saving,
  onClose,
  onSave,
}: {
  group: ModifierGroup | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Partial<ModifierGroup> & { name: string }) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [required, setRequired] = useState(group?.is_required ?? false);
  const [minSelect, setMinSelect] = useState(String(group?.min_select ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(group?.max_select ?? 1));

  return (
    <Modal
      title={group ? `Edit Grup — ${group.name}` : "Tambah Grup Modifier"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !name.trim()}
          onClick={() =>
            onSave({ id: group?.id, name: name.trim(), is_required: required, min_select: Number(minSelect || 0), max_select: Number(maxSelect || 1) })
          }
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Grup</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Level Gula" className="input-field" />
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="rounded" />
        Wajib dipilih pelanggan
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Minimal Pilih</label>
          <input type="text" inputMode="numeric" value={minSelect} onChange={(e) => setMinSelect(e.target.value.replace(/[^0-9]/g, ""))} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Maksimal Pilih</label>
          <input type="text" inputMode="numeric" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value.replace(/[^0-9]/g, ""))} className="input-field" />
        </div>
      </div>
    </Modal>
  );
}

function ModifierModal({
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
