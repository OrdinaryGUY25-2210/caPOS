"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Layers, SlidersHorizontal, ChefHat, ArrowUpRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/utils";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import type { Product, ProductVariant, ModifierGroup, RecipeItem } from "@/lib/types";

interface StockLine {
  ingredient_id: string;
  ingredient_name: string;
  qty: number;
  threshold: number;
  low: boolean;
}

/**
 * Menu Management §6 — "ProductConfigModal": ringkasan Varian, Modifier,
 * dan Resep+Stok satu produk dalam satu tempat, dengan link ke editor
 * lengkapnya masing-masing (halaman /dashboard/variants,
 * /dashboard/modifiers, /dashboard/recipes tetap sumber kebenaran untuk
 * CRUD-nya — modal ini cuma ringkasan + jalan pintas), supaya dari Menu
 * owner langsung tahu: "produk ini sudah lengkap dikonfigurasi atau
 * belum", tanpa loncat ke 3 halaman berbeda satu-satu.
 *
 * Ini juga yang mengisi checklist "Recipe indicator" & "Stock status" di
 * halaman Menu, yang sebelumnya tidak ada sama sekali.
 */
export default function ProductConfigModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { selectedBranchId } = useBranch();
  const [loading, setLoading] = useState(true);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [hasActiveRecipe, setHasActiveRecipe] = useState(false);
  const [stockLines, setStockLines] = useState<StockLine[] | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, selectedBranchId]);

  async function load() {
    setLoading(true);
    const supabase = createClient();

    const [{ data: variantRows }, { data: pmgRows }, { data: recipeRows }] = await Promise.all([
      supabase.from("product_variants").select("*").eq("product_id", product.id).order("display_order", { ascending: true }),
      supabase.from("product_modifier_groups").select("modifier_group_id, modifier_groups(*)").eq("product_id", product.id),
      supabase.from("recipes").select("id, variant_id").eq("product_id", product.id).eq("is_active", true),
    ]);

    setVariants((variantRows as ProductVariant[]) ?? []);
    setModifierGroups(((pmgRows as any[]) ?? []).map((r) => r.modifier_groups).filter(Boolean));

    const activeRecipes = (recipeRows as { id: string; variant_id: string | null }[]) ?? [];
    setHasActiveRecipe(activeRecipes.length > 0);

    // Ambil bahan dari resep dasar (variant_id null) kalau ada, kalau tidak
    // pakai resep aktif pertama — cukup untuk sinyal "stok cukup/menipis",
    // bukan pengganti halaman Resep untuk edit per-varian.
    const baseRecipe = activeRecipes.find((r) => r.variant_id === null) ?? activeRecipes[0];
    if (!baseRecipe) {
      setStockLines(null);
      setLoading(false);
      return;
    }

    const { data: itemRows } = await supabase.from("recipe_items").select("*").eq("recipe_id", baseRecipe.id);
    const items = (itemRows as RecipeItem[]) ?? [];
    if (items.length === 0) {
      setStockLines([]);
      setLoading(false);
      return;
    }

    const ingredientIds = items.map((i) => i.ingredient_id);
    const isConsolidated = selectedBranchId === ALL_BRANCHES;
    const [{ data: ingRows }, { data: stockRows }] = await Promise.all([
      supabase.from("ingredients").select("id, name, low_stock_threshold").in("id", ingredientIds),
      supabase.from("branch_ingredients_stock").select("branch_id, ingredient_id, stock_qty, low_stock_threshold").in("ingredient_id", ingredientIds),
    ]);

    const ingById = new Map<string, { name: string; threshold: number }>(
      ((ingRows as any[]) ?? []).map((r) => [r.id, { name: r.name, threshold: r.low_stock_threshold }])
    );

    const lines: StockLine[] = items.map((it) => {
      const meta = ingById.get(it.ingredient_id);
      const rows = ((stockRows as any[]) ?? []).filter((r) => r.ingredient_id === it.ingredient_id);
      let qty: number;
      let threshold = meta?.threshold ?? 0;
      if (isConsolidated) {
        qty = rows.reduce((s, r) => s + Number(r.stock_qty), 0);
      } else {
        const row = rows.find((r) => r.branch_id === selectedBranchId);
        qty = row ? Number(row.stock_qty) : 0;
        threshold = row?.low_stock_threshold ?? threshold;
      }
      return { ingredient_id: it.ingredient_id, ingredient_name: meta?.name ?? "Bahan", qty, threshold, low: qty <= threshold };
    });
    setStockLines(lines);
    setLoading(false);
  }

  const lowCount = stockLines?.filter((l) => l.low).length ?? 0;

  return (
    <Modal title={`Konfigurasi — ${product.name}`} onClose={onClose} maxWidth="sm:max-w-md">
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-neutral-400" size={22} />
        </div>
      ) : (
        <div className="space-y-4">
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <Layers size={13} /> Varian ({variants.length})
              </p>
              <Link href="/dashboard/variants" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                Kelola <ArrowUpRight size={11} />
              </Link>
            </div>
            {variants.length === 0 ? (
              <p className="text-xs text-neutral-400">Belum ada varian — produk dijual dengan 1 harga dasar.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {variants.map((v) => (
                  <span key={v.id} className="text-xs bg-neutral-100 rounded-full px-2.5 py-1">
                    {v.name} · {formatRupiah(v.price)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <SlidersHorizontal size={13} /> Modifier Group ({modifierGroups.length})
              </p>
              <Link href="/dashboard/modifiers" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                Kelola <ArrowUpRight size={11} />
              </Link>
            </div>
            {modifierGroups.length === 0 ? (
              <p className="text-xs text-neutral-400">Belum ada modifier terpasang untuk produk ini.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {modifierGroups.map((g) => (
                  <span key={g.id} className="text-xs bg-neutral-100 rounded-full px-2.5 py-1">
                    {g.name}{g.is_required ? " (wajib)" : ""}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                <ChefHat size={13} /> Resep & Stok
              </p>
              <Link href="/dashboard/recipes" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                Kelola <ArrowUpRight size={11} />
              </Link>
            </div>
            {!hasActiveRecipe ? (
              <p className="text-xs text-neutral-400">Belum ada resep aktif — konsumsi bahan baku tidak tercatat otomatis.</p>
            ) : stockLines === null || stockLines.length === 0 ? (
              <p className="text-xs text-neutral-400">Resep aktif, belum ada bahan tercatat di dalamnya.</p>
            ) : (
              <div className="space-y-1.5">
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${lowCount > 0 ? "text-urgent" : "text-primary"}`}>
                  {lowCount > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                  {lowCount > 0 ? `${lowCount} bahan menipis — produk berisiko tidak bisa dibuat` : "Semua bahan resep cukup"}
                </div>
                {stockLines.map((l) => (
                  <div key={l.ingredient_id} className="flex items-center justify-between text-xs">
                    <span className={l.low ? "text-urgent" : "text-neutral-600"}>{l.ingredient_name}</span>
                    <span className={l.low ? "text-urgent font-semibold" : "text-neutral-400"}>{l.qty}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
