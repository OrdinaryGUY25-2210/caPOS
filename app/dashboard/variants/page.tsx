"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, Pencil, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { isManagerOrOwner } from "@/lib/role";
import Modal from "@/components/Modal";
import type { Product, ProductVariant, Recipe } from "@/lib/types";
import { Skeleton, SkeletonList } from "@/components/Skeleton";

/**
 * Kelola Varian Produk (mis. "Regular"/"Large") — Phase 2A F&B Master Data.
 * Varian TETAP terikat ke `products` yang sudah ada (product_id) — TIDAK
 * membuat model produk kedua. Kalau produk tidak punya varian sama sekali,
 * dia dianggap "single-variant" (resep langsung ke product_id, variant_id
 * NULL) — sesuai desain resolve_active_recipe(product_id, variant_id).
 */
export default function VariantsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [recipesByVariant, setRecipesByVariant] = useState<Map<string | null, Recipe>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [role, setRole] = useState("owner");
  const [editing, setEditing] = useState<ProductVariant | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  const canWrite = isManagerOrOwner(role);

  async function loadProducts() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setRole(profile.role);
    const supabase = createClient();
    const { data } = await supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).order("name", { ascending: true });
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadVariants(productId: string) {
    setLoadingVariants(true);
    const supabase = createClient();
    const [{ data: variantData }, { data: recipeData }] = await Promise.all([
      supabase.from("product_variants").select("*").eq("product_id", productId).order("display_order", { ascending: true }),
      supabase.from("recipes").select("*").eq("product_id", productId).eq("is_active", true),
    ]);
    setVariants((variantData as ProductVariant[]) ?? []);
    const map = new Map<string | null, Recipe>();
    for (const r of (recipeData as Recipe[]) ?? []) map.set(r.variant_id, r);
    setRecipesByVariant(map);
    setLoadingVariants(false);
  }

  useEffect(() => {
    if (selectedProductId) loadVariants(selectedProductId);
  }, [selectedProductId]);

  const selectedProduct = useMemo(() => products.find((p) => p.id === selectedProductId) ?? null, [products, selectedProductId]);

  async function saveVariant(payload: Partial<ProductVariant> & { name: string; price: number }) {
    if (!selectedProductId) return;
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
        .from("product_variants")
        .update({
          name: payload.name,
          sku: payload.sku ?? null,
          price: payload.price,
          cost_price: payload.cost_price ?? null,
          is_available: payload.is_available ?? true,
          display_order: payload.display_order ?? 0,
        })
        .eq("id", payload.id));
    } else {
      ({ error } = await supabase.from("product_variants").insert({
        tenant_id: profile.tenant_id,
        product_id: selectedProductId,
        name: payload.name,
        sku: payload.sku ?? null,
        price: payload.price,
        cost_price: payload.cost_price ?? null,
        is_available: true,
        display_order: variants.length,
      }));
    }
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan: " + error.message);
      return;
    }
    setEditing(null);
    loadVariants(selectedProductId);
  }

  async function toggleAvailable(v: ProductVariant) {
    const supabase = createClient();
    const { error } = await supabase.from("product_variants").update({ is_available: !v.is_available }).eq("id", v.id);
    if (error) {
      alert("Gagal: " + error.message);
      return;
    }
    if (selectedProductId) loadVariants(selectedProductId);
  }

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
          <Layers size={20} className="text-primary-dark" /> Varian Produk
        </h1>
        <p className="text-sm text-neutral-500">Kelola varian ukuran/pilihan per menu (mis. Regular/Large), harga, dan HPP masing-masing.</p>
      </div>

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Pilih Menu</label>
        <select
          value={selectedProductId ?? ""}
          onChange={(e) => setSelectedProductId(e.target.value || null)}
          className="input-field max-w-sm"
        >
          <option value="">— Pilih menu —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {selectedProduct && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between p-4 border-b border-neutral-100">
            <div>
              <p className="font-semibold text-neutral-900">{selectedProduct.name}</p>
              <p className="text-xs text-neutral-400">Harga dasar (tanpa varian): {formatRupiah(selectedProduct.price)}</p>
            </div>
            {canWrite && (
              <button onClick={() => setEditing("new")} className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus size={16} /> Tambah Varian
              </button>
            )}
          </div>

          {loadingVariants ? (
            <div className="p-4">
              <SkeletonList rows={3} withAvatar={false} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-neutral-500">
                  <th className="p-3 font-medium">Varian</th>
                  <th className="p-3 font-medium">SKU</th>
                  <th className="p-3 font-medium">Harga</th>
                  <th className="p-3 font-medium">HPP</th>
                  <th className="p-3 font-medium">Resep</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {variants.map((v) => {
                  const hasRecipe = recipesByVariant.has(v.id);
                  return (
                    <tr key={v.id}>
                      <td className="p-3 font-medium text-neutral-900">{v.name}</td>
                      <td className="p-3 text-neutral-500">{v.sku || "—"}</td>
                      <td className="p-3">{formatRupiah(v.price)}</td>
                      <td className="p-3">{v.cost_price ? formatRupiah(v.cost_price) : "—"}</td>
                      <td className="p-3">
                        {hasRecipe ? (
                          <span className="badge-active">Ada resep</span>
                        ) : (
                          <span className="text-neutral-400 text-xs">Belum ada</span>
                        )}
                      </td>
                      <td className="p-3">
                        <button onClick={() => toggleAvailable(v)} disabled={!canWrite} className="flex items-center gap-1">
                          {v.is_available ? (
                            <CheckCircle2 size={16} className="text-primary-dark" />
                          ) : (
                            <XCircle size={16} className="text-neutral-300" />
                          )}
                          <span className={v.is_available ? "text-primary-dark text-xs" : "text-neutral-400 text-xs"}>
                            {v.is_available ? "Aktif" : "Nonaktif"}
                          </span>
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        {canWrite && (
                          <button onClick={() => setEditing(v)} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5" title="Edit">
                            <Pencil size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {variants.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-400">
                      Menu ini belum punya varian. Tanpa varian, menu dianggap satu ukuran (resep langsung ke menu ini di
                      halaman Resep).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <VariantModal
          variant={editing === "new" ? null : editing}
          basePrice={selectedProduct?.price ?? 0}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={saveVariant}
        />
      )}
    </div>
  );
}

function VariantModal({
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
