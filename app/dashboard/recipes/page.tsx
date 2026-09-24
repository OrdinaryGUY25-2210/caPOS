"use client";

import { useEffect, useMemo, useState } from "react";
import { ChefHat, Plus, Trash2, Loader2, CheckCircle2, XCircle, Calculator } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner } from "@/lib/role";
import type { Product, ProductVariant, Recipe, RecipeItem, Ingredient } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * Recipe Builder — Phase 2A F&B Master Data.
 *
 * Resep terhubung ke product_id + variant_id (NULL variant_id = berlaku untuk
 * semua varian/menu tanpa varian). HPP TIDAK dihitung ulang di frontend —
 * selalu panggil RPC calculate_recipe_cost(recipe_id) yang sudah ada di DB,
 * supaya logika weighted-average-cost tidak terduplikasi di client.
 */
type RecipeItemDraft = { id?: string; ingredient_id: string; quantity: string; unit: string; wastage_percentage: string; notes: string };

export default function RecipesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null); // null = "tanpa varian (semua)"
  const [recipes, setRecipes] = useState<Recipe[]>([]); // semua resep utk product ini (semua versi/varian)
  const [items, setItems] = useState<RecipeItemDraft[]>([]);
  const [recipeName, setRecipeName] = useState("");
  const [yieldQty, setYieldQty] = useState("1");
  const [loading, setLoading] = useState(true);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [role, setRole] = useState("owner");
  const [saving, setSaving] = useState(false);
  const [costPreview, setCostPreview] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const canWrite = isManagerOrOwner(role);

  async function loadBase() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setRole(profile.role);
    const supabase = createClient();
    const [{ data: prodData }, { data: ingData }] = await Promise.all([
      supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).order("name", { ascending: true }),
      supabase.from("ingredients").select("*").eq("tenant_id", profile.tenant_id).eq("status", "active").order("name", { ascending: true }),
    ]);
    setProducts((prodData as Product[]) ?? []);
    setIngredients((ingData as Ingredient[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadBase();
  }, []);

  async function loadForProduct(productId: string) {
    setLoadingRecipe(true);
    const supabase = createClient();
    const [{ data: variantData }, { data: recipeData }] = await Promise.all([
      supabase.from("product_variants").select("*").eq("product_id", productId).order("display_order", { ascending: true }),
      supabase.from("recipes").select("*").eq("product_id", productId).order("version", { ascending: false }),
    ]);
    setVariants((variantData as ProductVariant[]) ?? []);
    setRecipes((recipeData as Recipe[]) ?? []);
    setSelectedVariantId(null);
    setLoadingRecipe(false);
  }

  useEffect(() => {
    if (selectedProductId) loadForProduct(selectedProductId);
    else {
      setVariants([]);
      setRecipes([]);
    }
  }, [selectedProductId]);

  const activeRecipe = useMemo(
    () => recipes.find((r) => r.variant_id === selectedVariantId && r.is_active) ?? null,
    [recipes, selectedVariantId]
  );

  async function loadRecipeItems(recipeId: string) {
    const supabase = createClient();
    const { data } = await supabase.from("recipe_items").select("*").eq("recipe_id", recipeId);
    setItems(
      ((data as RecipeItem[]) ?? []).map((it) => ({
        id: it.id,
        ingredient_id: it.ingredient_id,
        quantity: String(it.quantity),
        unit: it.unit,
        wastage_percentage: it.wastage_percentage ? String(it.wastage_percentage) : "0",
        notes: it.notes ?? "",
      }))
    );
  }

  useEffect(() => {
    setCostPreview(null);
    if (activeRecipe) {
      setRecipeName(activeRecipe.name ?? "");
      setYieldQty(String(activeRecipe.yield_quantity));
      loadRecipeItems(activeRecipe.id);
    } else {
      setRecipeName("");
      setYieldQty("1");
      setItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecipe?.id]);

  function addItemRow() {
    const first = ingredients[0];
    if (!first) {
      alert("Belum ada bahan baku aktif. Tambahkan bahan dulu di halaman Bahan Baku.");
      return;
    }
    setItems((prev) => [...prev, { ingredient_id: first.id, quantity: "", unit: first.inventory_unit, wastage_percentage: "0", notes: "" }]);
  }

  function updateItem(idx: number, patch: Partial<RecipeItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function saveRecipe() {
    if (!selectedProductId) return;
    const validItems = items.filter((it) => it.ingredient_id && Number(it.quantity) > 0);
    if (validItems.length === 0) {
      alert("Tambahkan minimal 1 bahan dengan jumlah > 0.");
      return;
    }
    setSaving(true);
    const { profile, userId } = await getCurrentProfile();
    if (!profile) {
      setSaving(false);
      return;
    }
    const supabase = createClient();

    let recipeId = activeRecipe?.id;
    if (!recipeId) {
      const { data, error } = await supabase
        .from("recipes")
        .insert({
          tenant_id: profile.tenant_id,
          product_id: selectedProductId,
          variant_id: selectedVariantId,
          name: recipeName.trim() || null,
          version: 1,
          is_active: true,
          yield_quantity: Number(yieldQty || 1),
          created_by: userId,
        })
        .select()
        .single();
      if (error || !data) {
        setSaving(false);
        alert("Gagal membuat resep: " + error?.message);
        return;
      }
      recipeId = data.id;
    } else {
      const { error } = await supabase
        .from("recipes")
        .update({ name: recipeName.trim() || null, yield_quantity: Number(yieldQty || 1) })
        .eq("id", recipeId);
      if (error) {
        setSaving(false);
        alert("Gagal menyimpan resep: " + error.message);
        return;
      }
    }

    // Ganti seluruh baris item: hapus lama, insert baru — resep biasanya
    // pendek (< 15 bahan) jadi replace-all lebih sederhana & tidak berisiko
    // dibanding diff per baris, dan tidak memengaruhi recipe_consumption_logs
    // (log konsumsi menyimpan snapshot recipe_version terpisah, bukan FK ke recipe_items).
    await supabase.from("recipe_items").delete().eq("recipe_id", recipeId);
    const { error: itemsError } = await supabase.from("recipe_items").insert(
      validItems.map((it) => ({
        recipe_id: recipeId,
        ingredient_id: it.ingredient_id,
        quantity: Number(it.quantity),
        unit: it.unit,
        wastage_percentage: Number(it.wastage_percentage || 0),
        notes: it.notes.trim() || null,
      }))
    );
    setSaving(false);
    if (itemsError) {
      alert("Resep tersimpan, tapi gagal menyimpan bahan: " + itemsError.message);
    }
    if (selectedProductId) loadForProduct(selectedProductId);
  }

  function toggleActive() {
    if (!activeRecipe) return;
    setConfirmDeactivate(true);
  }

  async function applyDeactivate() {
    if (!activeRecipe) return;
    const supabase = createClient();
    const { error } = await supabase.from("recipes").update({ is_active: false }).eq("id", activeRecipe.id);
    if (error) throw new Error(error.message);
    if (selectedProductId) loadForProduct(selectedProductId);
  }

  async function previewCost() {
    if (!activeRecipe) return;
    setCalculating(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("calculate_recipe_cost", { p_recipe_id: activeRecipe.id });
    setCalculating(false);
    if (error) {
      alert("Gagal menghitung HPP: " + error.message);
      return;
    }
    setCostPreview(Number(data ?? 0));
  }

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);

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
      <div>
        <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
          <ChefHat size={20} className="text-primary-dark" /> Resep & HPP
        </h1>
        <p className="text-sm text-neutral-500">Susun resep bahan baku per menu/varian — HPP dihitung otomatis dari harga bahan.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Pilih Menu</label>
          <select value={selectedProductId ?? ""} onChange={(e) => setSelectedProductId(e.target.value || null)} className="input-field">
            <option value="">— Pilih menu —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {selectedProductId && (
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Varian</label>
            <select value={selectedVariantId ?? ""} onChange={(e) => setSelectedVariantId(e.target.value || null)} className="input-field">
              <option value="">Semua varian / tanpa varian</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedProductId && loadingRecipe && (
        <div className="card p-6">
          <SkeletonList rows={3} withAvatar={false} />
        </div>
      )}

      {selectedProductId && !loadingRecipe && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-neutral-900">
                {selectedProduct?.name}
                {selectedVariantId && ` — ${variants.find((v) => v.id === selectedVariantId)?.name}`}
              </p>
              <p className="text-xs text-neutral-400">
                {activeRecipe ? `Resep aktif v${activeRecipe.version}` : "Belum ada resep aktif — buat baru di bawah"}
              </p>
            </div>
            {activeRecipe && canWrite && (
              <button onClick={toggleActive} className="text-xs text-urgent font-medium flex items-center gap-1">
                <XCircle size={14} /> Nonaktifkan Resep
              </button>
            )}
          </div>

          {canWrite ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Resep (opsional)</label>
                  <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="Contoh: Es Kopi Susu Regular" className="input-field" />
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-700 mb-1 block">Yield (porsi per resep)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={yieldQty}
                    onChange={(e) => setYieldQty(e.target.value.replace(/[^0-9]/g, ""))}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-neutral-700">Bahan Baku</label>
                  <button onClick={addItemRow} type="button" className="text-xs text-primary-dark font-medium flex items-center gap-1">
                    <Plus size={12} /> Tambah Bahan
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((it, idx) => {
                    const ing = ingredients.find((i) => i.id === it.ingredient_id);
                    return (
                      <div key={idx} className="flex flex-wrap items-center gap-2 bg-neutral-50 rounded-xl p-2">
                        <select
                          value={it.ingredient_id}
                          onChange={(e) => {
                            const newIng = ingredients.find((i) => i.id === e.target.value);
                            updateItem(idx, { ingredient_id: e.target.value, unit: newIng?.inventory_unit ?? it.unit });
                          }}
                          className="input-field flex-1 min-w-[140px] text-sm"
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
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: e.target.value.replace(/[^0-9.]/g, "") })}
                          placeholder="Jumlah"
                          className="input-field w-20 text-sm"
                        />
                        <span className="text-xs text-neutral-400 w-12">{ing?.inventory_unit}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.wastage_percentage}
                          onChange={(e) => updateItem(idx, { wastage_percentage: e.target.value.replace(/[^0-9.]/g, "") })}
                          placeholder="Waste %"
                          title="Persentase waste/susut"
                          className="input-field w-20 text-sm"
                        />
                        <span className="text-xs text-neutral-400">% waste</span>
                        <button onClick={() => setItems(items.filter((_, i) => i !== idx))} type="button" className="text-neutral-400 hover:text-urgent ml-auto">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="text-neutral-400 text-sm">Belum ada bahan di resep ini.</p>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100">
                <button
                  disabled={saving}
                  onClick={saveRecipe}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  {saving && <Loader2 className="animate-spin" size={16} />}
                  {activeRecipe ? "Simpan Perubahan Resep" : "Buat & Aktifkan Resep"}
                </button>
                {activeRecipe && (
                  <button onClick={previewCost} disabled={calculating} className="btn-outline flex items-center gap-2 text-sm">
                    {calculating ? <Loader2 className="animate-spin" size={16} /> : <Calculator size={16} />}
                    Hitung HPP
                  </button>
                )}
                {costPreview !== null && (
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle2 size={16} className="text-primary-dark" />
                    <span className="text-neutral-600">Total HPP resep:</span>
                    <span className="font-bold text-neutral-900">{formatRupiah(costPreview)}</span>
                    <span className="text-neutral-400">
                      ({formatRupiah(costPreview / Math.max(1, Number(yieldQty || 1)))} / porsi)
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-neutral-400 text-sm">Hanya manager/owner yang bisa mengubah resep.</p>
          )}
        </div>
      )}

      {!selectedProductId && (
        <div className={cx("card p-10 text-center text-neutral-400")}>Pilih menu di atas untuk melihat atau membuat resepnya.</div>
      )}

      {confirmDeactivate && (
        <ConfirmDialog
          title="Nonaktifkan Resep?"
          description="Menu/varian ini tidak akan mengurangi stok bahan otomatis sampai resep baru dibuat/diaktifkan."
          confirmLabel="Ya, Nonaktifkan"
          successMessage="Resep dinonaktifkan."
          onClose={() => setConfirmDeactivate(false)}
          onConfirm={applyDeactivate}
        />
      )}
    </div>
  );
}
