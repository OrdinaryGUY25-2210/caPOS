"use client";

import { useEffect, useMemo, useState } from "react";
import { INGREDIENT_TEMPLATES } from "@/lib/ingredientTemplates";
import { Wheat, Search, Plus, Pencil, PackagePlus, AlertTriangle, Loader2, Ban, CheckCircle2 } from "lucide-react";
import { formatRupiah, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { isManagerOrOwner } from "@/lib/role";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { Ingredient, Unit } from "@/lib/types";
import { Skeleton, SkeletonStatGrid, SkeletonTableRows } from "@/components/Skeleton";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { DEMO_INGREDIENTS, DEMO_BRANCH_INGREDIENT_STOCK } from "@/lib/demoData";

/**
 * Kelola Bahan Baku (Ingredients) — Phase 2A F&B Master Data.
 *
 * PENTING: sumber kebenaran stok ingredient adalah `branch_ingredients_stock`
 * (per cabang), BUKAN kolom apa pun di `products`. Semua angka stok/HPP di
 * halaman ini dibaca dari tabel itu, sama seperti /dashboard/stock membaca
 * stok MENU dari `branch_stock` — dua sistem stok yang terpisah sepenuhnya
 * (satu untuk produk jadi/legacy, satu untuk bahan baku F&B).
 *
 * `ingredients` tidak bisa dihapus permanen (trigger prevent_ingredient_hard_delete
 * di DB) — tombol "Arsipkan" hanya mengubah status jadi 'inactive'.
 */
interface StockRow {
  branch_id: string;
  stock_qty: number;
  cost_price: number;
  low_stock_threshold: number | null;
}

export default function IngredientsPage() {
  const { selectedBranchId, selectedBranch, canSwitchBranch, branches } = useBranch();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [stockMap, setStockMap] = useState<Map<string, StockRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("owner");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "low">("all");
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [restocking, setRestocking] = useState<Ingredient | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Ingredient | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const isConsolidated = selectedBranchId === ALL_BRANCHES;
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
    const [{ data: ingData }, { data: unitData }, { data: stockData }] = await Promise.all([
      supabase.from("ingredients").select("*").eq("tenant_id", profile.tenant_id).order("name", { ascending: true }),
      supabase.from("units").select("*").eq("is_active", true).order("name", { ascending: true }),
      supabase
        .from("branch_ingredients_stock")
        .select("branch_id, ingredient_id, stock_qty, cost_price, low_stock_threshold")
        .eq("tenant_id", profile.tenant_id),
    ]);

    const freshIngredients = (ingData as Ingredient[]) ?? [];
    setIngredients(freshIngredients);
    setUnits((unitData as Unit[]) ?? []);

    const map = new Map<string, StockRow[]>();
    for (const row of (stockData as (StockRow & { ingredient_id: string })[]) ?? []) {
      const list = map.get(row.ingredient_id) ?? [];
      list.push(row);
      map.set(row.ingredient_id, list);
    }
    setStockMap(map);

    const noActivity = await tenantHasNoActivity();
    const showDemo = freshIngredients.length === 0 && noActivity;
    setIsDemo(showDemo);
    if (showDemo) {
      setIngredients(DEMO_INGREDIENTS as Ingredient[]);
      const demoStockMap = new Map<string, StockRow[]>();
      for (const row of DEMO_BRANCH_INGREDIENT_STOCK as (StockRow & { ingredient_id: string })[]) {
        const list = demoStockMap.get(row.ingredient_id) ?? [];
        list.push(row);
        demoStockMap.set(row.ingredient_id, list);
      }
      setStockMap(demoStockMap);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function branchStockFor(ingredientId: string, threshold: number): { qty: number; low: boolean } {
    const rows = stockMap.get(ingredientId) ?? [];
    if (isConsolidated) {
      const qty = rows.reduce((s, r) => s + Number(r.stock_qty), 0);
      return { qty, low: qty <= threshold };
    }
    const row = rows.find((r) => r.branch_id === selectedBranchId);
    const qty = row ? Number(row.stock_qty) : 0;
    const th = row?.low_stock_threshold ?? threshold;
    return { qty, low: qty <= th };
  }

  function costFor(ingredientId: string): number {
    const rows = stockMap.get(ingredientId) ?? [];
    if (isConsolidated) {
      // Konsolidasi: rata-rata HPP antar cabang yang punya stok (bukan penjumlahan).
      const withStock = rows.filter((r) => Number(r.cost_price) > 0);
      if (withStock.length === 0) return 0;
      return withStock.reduce((s, r) => s + Number(r.cost_price), 0) / withStock.length;
    }
    return rows.find((r) => r.branch_id === selectedBranchId)?.cost_price ?? 0;
  }

  const filtered = useMemo(() => {
    return ingredients.filter((ing) => {
      if (search && !ing.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter === "active" && ing.status !== "active") return false;
      if (statusFilter === "inactive" && ing.status !== "inactive") return false;
      if (statusFilter === "low") {
        const { low } = branchStockFor(ing.id, ing.low_stock_threshold);
        if (!low) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients, search, statusFilter, stockMap, selectedBranchId]);

  const lowStockCount = useMemo(
    () => ingredients.filter((ing) => branchStockFor(ing.id, ing.low_stock_threshold).low).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ingredients, stockMap, selectedBranchId]
  );
  const activeCount = useMemo(() => ingredients.filter((i) => i.status === "active").length, [ingredients]);
  const inventoryValue = useMemo(() => {
    return ingredients.reduce((sum, ing) => {
      const { qty } = branchStockFor(ing.id, ing.low_stock_threshold);
      return sum + qty * costFor(ing.id);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients, stockMap, selectedBranchId]);

  /** Tambahkan bahan dari template; nama yang sudah ada dilewati (tidak dobel). */
  async function applyTemplate(packId: string) {
    const pack = INGREDIENT_TEMPLATES.find((p) => p.id === packId);
    if (!pack) return;
    setTemplateBusy(true);
    try {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      const supabase = createClient();
      const existing = new Set(ingredients.map((i) => i.name.trim().toLowerCase()));
      const unitCodes = new Set(units.map((u) => u.code));
      const rows = pack.items
        .filter((it) => !existing.has(it.name.toLowerCase()) && unitCodes.has(it.unit))
        .map((it) => ({
          tenant_id: profile.tenant_id,
          name: it.name,
          category: it.category,
          purchase_unit: it.unit,
          inventory_unit: it.unit,
          purchase_to_inventory_ratio: null,
          low_stock_threshold: 0,
          status: "active",
          is_86: false,
        }));
      if (rows.length === 0) {
        alert("Semua bahan di template ini sudah ada di daftar Anda.");
        return;
      }
      const { error } = await supabase.from("ingredients").insert(rows);
      if (error) {
        alert("Gagal menambahkan template: " + error.message);
        return;
      }
      setShowTemplates(false);
      await loadAll();
      alert(`${rows.length} bahan ditambahkan. Sekarang isi harga belinya (klik ikon pensil) supaya HPP menu terhitung.`);
    } finally {
      setTemplateBusy(false);
    }
  }

  /**
   * Simpan harga per satuan (cost_price) bahan ke branch_ingredients_stock.
   * Owner: harga yang sama dipasang ke semua cabang. Manager: cabangnya saja
   * (sesuai RLS). HPP resep dihitung dari kolom ini oleh calculate_recipe_cost().
   */
  async function applyCost(ingredientId: string, tenantId: string, costPerUnit: number, onlyBranchId?: string) {
    const supabase = createClient();
    const targetBranches =
      onlyBranchId
        ? [onlyBranchId]
        : role === "owner" || role === "super_admin"
          ? branches.map((b) => b.id)
          : selectedBranchId !== ALL_BRANCHES
            ? [selectedBranchId]
            : [];
    if (targetBranches.length === 0) return null;
    const { error } = await supabase.from("branch_ingredients_stock").upsert(
      targetBranches.map((branchId) => ({
        tenant_id: tenantId,
        branch_id: branchId,
        ingredient_id: ingredientId,
        cost_price: costPerUnit,
      })),
      { onConflict: "branch_id,ingredient_id" }
    );
    return error;
  }

  async function saveIngredient(
    payload: Partial<Ingredient> & { name: string; purchase_unit: string; inventory_unit: string },
    extra?: { costPerUnit: number | null; initialStock: number }
  ) {
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
        .from("ingredients")
        .update({
          name: payload.name,
          category: payload.category ?? null,
          purchase_unit: payload.purchase_unit,
          inventory_unit: payload.inventory_unit,
          purchase_to_inventory_ratio: payload.purchase_to_inventory_ratio ?? null,
          low_stock_threshold: payload.low_stock_threshold ?? 0,
          status: payload.status ?? "active",
          is_86: payload.is_86 ?? false,
        })
        .eq("id", payload.id));
    } else {
      let newId: string | null = null;
      const res = await supabase.from("ingredients").insert({
        tenant_id: profile.tenant_id,
        name: payload.name,
        category: payload.category ?? null,
        purchase_unit: payload.purchase_unit,
        inventory_unit: payload.inventory_unit,
        purchase_to_inventory_ratio: payload.purchase_to_inventory_ratio ?? null,
        low_stock_threshold: payload.low_stock_threshold ?? 0,
        status: "active",
        is_86: false,
      }).select("id").single();
      error = res.error;
      newId = (res.data as { id: string } | null)?.id ?? null;
      if (!error && newId) {
        if (extra?.costPerUnit && extra.costPerUnit > 0) {
          const costErr = await applyCost(newId, profile.tenant_id, extra.costPerUnit);
          if (costErr) alert("Bahan tersimpan, tapi harga gagal disimpan: " + costErr.message);
        }
        if (extra && extra.initialStock > 0 && selectedBranchId !== ALL_BRANCHES) {
          const { error: stockErr } = await supabase.rpc("adjust_ingredient_stock", {
            p_ingredient_id: newId,
            p_branch_id: selectedBranchId,
            p_qty_change: extra.initialStock,
            p_type: "PURCHASE",
            p_note: "Stok awal",
          });
          if (stockErr) alert("Bahan tersimpan, tapi stok awal gagal disimpan: " + stockErr.message);
        }
      }
    }
    if (payload.id && !error && extra?.costPerUnit && extra.costPerUnit > 0) {
      const costErr = await applyCost(payload.id, profile.tenant_id, extra.costPerUnit);
      if (costErr) alert("Perubahan tersimpan, tapi harga gagal disimpan: " + costErr.message);
    }
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan: " + error.message);
      return;
    }
    setEditing(null);
    loadAll();
  }

  function toggleArchive(ing: Ingredient) {
    setArchiveTarget(ing);
  }

  async function applyToggleArchive(ing: Ingredient) {
    const supabase = createClient();
    const { error } = await supabase
      .from("ingredients")
      .update({ status: ing.status === "active" ? "inactive" : "active" })
      .eq("id", ing.id);
    if (error) throw new Error(error.message);
    loadAll();
  }

  async function toggle86(ing: Ingredient) {
    const supabase = createClient();
    const { error } = await supabase.from("ingredients").update({ is_86: !ing.is_86 }).eq("id", ing.id);
    if (error) {
      alert("Gagal: " + error.message);
      return;
    }
    loadAll();
  }

  async function doAdjustStock(ing: Ingredient, qty: number, note: string, totalPrice?: number) {
    if (!qty || qty === 0) return;
    if (isConsolidated) {
      alert("Pilih 1 cabang dulu di kanan atas untuk menyesuaikan stok bahan.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    // Harga rata-rata tertimbang: dihitung SEBELUM stok diubah.
    const before = branchStockFor(ing.id, ing.low_stock_threshold).qty;
    const beforeCost = costFor(ing.id);
    const { error } = await supabase.rpc("adjust_ingredient_stock", {
      p_ingredient_id: ing.id,
      p_branch_id: selectedBranchId,
      p_qty_change: qty,
      p_type: qty > 0 ? "PURCHASE" : "WASTE",
      p_note: note || (qty > 0 ? "Restock manual bahan baku" : "Penyesuaian pengurangan manual"),
    });
    if (!error && qty > 0 && totalPrice && totalPrice > 0) {
      const newCost = before > 0 ? (before * beforeCost + totalPrice) / (before + qty) : totalPrice / qty;
      const { profile } = await getCurrentProfile();
      if (profile) {
        const costErr = await applyCost(ing.id, profile.tenant_id, Math.round(newCost * 100) / 100, selectedBranchId as string);
        if (costErr) alert("Stok bertambah, tapi harga gagal diperbarui: " + costErr.message);
      }
    }
    setSaving(false);
    if (error) {
      alert("Gagal menyesuaikan stok: " + error.message);
      return;
    }
    setRestocking(null);
    loadAll();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-9 w-40 rounded-xl" />
        </div>
        <SkeletonStatGrid count={3} />
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-100">
              <SkeletonTableRows rows={8} cols={6} />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <Wheat size={20} className="text-primary-dark" /> Bahan Baku & Harga Beli
          </h1>
          {isDemo && <DemoBadge />}
          <p className="text-sm text-neutral-500">
            Daftar bahan untuk resep. Isi nama, satuan, harga beli, dan stok awal sekali saja — HPP menu dihitung otomatis dari harga ini
            {canSwitchBranch && !isConsolidated && selectedBranch ? ` (stok cabang ${selectedBranch.name})` : ""}.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowTemplates(true)} className="btn-outline flex items-center gap-1.5 text-sm">
              <Wheat size={16} /> Pakai Template
            </button>
            <button onClick={() => setEditing("new")} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus size={16} /> Tambah Bahan
            </button>
          </div>
        )}
      </div>

      {isConsolidated && canSwitchBranch && (
        <div className="rounded-xl bg-neutral-100 text-neutral-600 text-sm px-4 py-3">
          Menampilkan stok <strong>gabungan semua cabang</strong> (read-only). Pilih 1 cabang di kanan atas
          untuk menyesuaikan stok bahan.
        </div>
      )}

      {lowStockCount > 0 && (
        <div className="card p-4 border-urgent bg-urgent-light/40 flex items-start gap-3">
          <AlertTriangle className="text-urgent shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-neutral-800">
            <span className="font-semibold">{lowStockCount} bahan</span> stoknya menipis atau habis.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Nilai Stok Bahan (stok × harga)</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(inventoryValue)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Bahan Aktif</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">
            {activeCount} / {ingredients.length}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Stok Menipis</p>
          <p className={cx("text-2xl font-bold mt-1", lowStockCount > 0 ? "text-urgent" : "text-neutral-900")}>
            {lowStockCount}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari bahan baku..."
            className="input-field pl-9"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input-field w-auto">
          <option value="all">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Diarsipkan</option>
          <option value="low">Stok Menipis</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th className="p-3 font-medium">Nama</th>
              <th className="p-3 font-medium">Kategori</th>
              <th className="p-3 font-medium">Unit</th>
              <th className="p-3 font-medium">Stok Cabang</th>
              <th className="p-3 font-medium">Harga / satuan</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.map((ing) => {
              const { qty, low } = branchStockFor(ing.id, ing.low_stock_threshold);
              return (
                <tr key={ing.id}>
                  <td className="p-3 font-medium text-neutral-900">
                    {ing.name}
                    {ing.is_86 && <span className="badge-urgent ml-2 text-xs">86 (Habis Sementara)</span>}
                  </td>
                  <td className="p-3 text-neutral-500">{ing.category || "—"}</td>
                  <td className="p-3 text-neutral-500">
                    {ing.purchase_unit} → {ing.inventory_unit}
                  </td>
                  <td className="p-3">
                    <span className={low ? "badge-urgent" : "badge-active"}>
                      {qty} {ing.inventory_unit}
                    </span>
                  </td>
                  <td className="p-3">
                    {costFor(ing.id) > 0 ? (
                      formatRupiah(costFor(ing.id))
                    ) : (
                      <span className="text-warning text-xs font-medium">Harga belum diisi</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={ing.status === "active" ? "badge-active" : "bg-neutral-100 text-neutral-500 text-xs font-medium px-2 py-0.5 rounded-full"}>
                      {ing.status === "active" ? "Aktif" : "Diarsipkan"}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {canWrite && !isDemo && (
                      <>
                        <button
                          onClick={() => setRestocking(ing)}
                          disabled={isConsolidated}
                          className="text-primary-dark hover:bg-primary-light rounded-lg p-1.5 mr-1 disabled:opacity-30"
                          title="Tambah stok / catat belanja"
                        >
                          <PackagePlus size={16} />
                        </button>
                        <button
                          onClick={() => toggle86(ing)}
                          className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5 mr-1"
                          title={ing.is_86 ? "Tandai tersedia lagi" : "Tandai habis sementara (86)"}
                        >
                          {ing.is_86 ? <CheckCircle2 size={16} /> : <Ban size={16} />}
                        </button>
                        <button
                          onClick={() => setEditing(ing)}
                          className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5 mr-1"
                          title="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => toggleArchive(ing)}
                          className="text-neutral-400 hover:bg-neutral-100 rounded-lg p-1.5 text-xs"
                          title={ing.status === "active" ? "Arsipkan" : "Aktifkan"}
                        >
                          {ing.status === "active" ? "Arsipkan" : "Aktifkan"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-400">
                  Belum ada bahan baku yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <IngredientModal
          ingredient={editing === "new" ? null : editing}
          units={units}
          saving={saving}
          currentCost={editing === "new" ? 0 : costFor(editing.id)}
          canSetStock={!isConsolidated}
          onClose={() => setEditing(null)}
          onSave={saveIngredient}
        />
      )}

      {showTemplates && (
        <Modal title="Template Bahan Baku" onClose={() => setShowTemplates(false)}>
          <p className="text-sm text-neutral-600">
            Pilih jenis usaha. Bahan umum langsung ditambahkan (tanpa harga), lalu Anda tinggal mengisi harga beli. Bahan yang namanya sudah ada tidak akan dobel.
          </p>
          <div className="space-y-2">
            {INGREDIENT_TEMPLATES.map((pack) => (
              <button
                key={pack.id}
                disabled={templateBusy}
                onClick={() => applyTemplate(pack.id)}
                className="w-full text-left rounded-xl border border-neutral-200 p-3 hover:bg-neutral-50 disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-neutral-900">
                  {pack.label} <span className="text-xs font-normal text-neutral-400">· {pack.items.length} bahan</span>
                </p>
                <p className="text-xs text-neutral-500">{pack.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {restocking && (
        <AdjustStockModal
          ingredient={restocking}
          saving={saving}
          currentQty={branchStockFor(restocking.id, restocking.low_stock_threshold).qty}
          currentCost={costFor(restocking.id)}
          onClose={() => setRestocking(null)}
          onSubmit={doAdjustStock}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          title={archiveTarget.status === "active" ? "Arsipkan Bahan?" : "Aktifkan Kembali Bahan?"}
          description={`${archiveTarget.status === "active" ? "Arsipkan" : "Aktifkan kembali"} bahan "${archiveTarget.name}"?`}
          danger={archiveTarget.status === "active"}
          confirmLabel={archiveTarget.status === "active" ? "Ya, Arsipkan" : "Ya, Aktifkan"}
          successMessage={archiveTarget.status === "active" ? "Bahan diarsipkan." : "Bahan diaktifkan kembali."}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => applyToggleArchive(archiveTarget)}
        />
      )}
    </div>
  );
}

function IngredientModal({
  ingredient,
  units,
  saving,
  currentCost,
  canSetStock,
  onClose,
  onSave,
}: {
  ingredient: Ingredient | null;
  units: Unit[];
  saving: boolean;
  currentCost: number;
  canSetStock: boolean;
  onClose: () => void;
  onSave: (
    payload: Partial<Ingredient> & { name: string; purchase_unit: string; inventory_unit: string },
    extra?: { costPerUnit: number | null; initialStock: number }
  ) => void;
}) {
  const isNew = !ingredient;
  const [name, setName] = useState(ingredient?.name ?? "");
  // Satuan pakai = satuan yang dipakai di resep & stok (mis. gram, ml, pcs).
  const [inventoryUnit, setInventoryUnit] = useState(ingredient?.inventory_unit ?? units[0]?.code ?? "");
  // "Beli seharga Rp X untuk Y satuan" — cara paling gampang mengisi harga,
  // tanpa perlu paham konversi unit. Harga per satuan = X / Y.
  const [priceInput, setPriceInput] = useState(currentCost > 0 ? String(currentCost) : "");
  const [priceQtyInput, setPriceQtyInput] = useState("1");
  const [initialStockInput, setInitialStockInput] = useState("");
  const [category, setCategory] = useState(ingredient?.category ?? "");
  const [purchaseUnit, setPurchaseUnit] = useState(ingredient?.purchase_unit ?? units[0]?.code ?? "");
  const [ratioInput, setRatioInput] = useState(ingredient?.purchase_to_inventory_ratio ? String(ingredient.purchase_to_inventory_ratio) : "");
  const [thresholdInput, setThresholdInput] = useState(String(ingredient?.low_stock_threshold ?? 0));
  const advancedDefault = !!ingredient && (ingredient.purchase_unit !== ingredient.inventory_unit || !!ingredient.purchase_to_inventory_ratio);
  const [showAdvanced, setShowAdvanced] = useState(advancedDefault);

  const price = priceInput === "" ? 0 : Number(stripNumberDots(priceInput));
  const priceQty = priceQtyInput === "" ? 0 : Number(priceQtyInput);
  const costPerUnit = price > 0 && priceQty > 0 ? price / priceQty : null;
  const unitName = units.find((u) => u.code === inventoryUnit)?.name ?? inventoryUnit;
  const canSubmit = name.trim() && inventoryUnit;

  return (
    <Modal
      title={ingredient ? `Edit Bahan — ${ingredient.name}` : "Tambah Bahan Baku"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !canSubmit}
          onClick={() =>
            onSave(
              {
                id: ingredient?.id,
                name: name.trim(),
                category: category.trim() || null,
                // Mode sederhana: satuan beli = satuan pakai (tanpa konversi).
                purchase_unit: showAdvanced ? purchaseUnit : inventoryUnit,
                inventory_unit: inventoryUnit,
                purchase_to_inventory_ratio: showAdvanced && ratioInput ? Number(ratioInput) : null,
                low_stock_threshold: thresholdInput === "" ? 0 : Number(thresholdInput),
                status: ingredient?.status,
                is_86: ingredient?.is_86,
              },
              {
                costPerUnit: costPerUnit ? Math.round(costPerUnit * 100) / 100 : null,
                initialStock: initialStockInput === "" ? 0 : Number(initialStockInput),
              }
            )
          }
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          {isNew ? "Simpan Bahan" : "Simpan Perubahan"}
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Bahan</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Biji Kopi Arabika" className="input-field" />
      </div>

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Satuan yang dipakai di resep</label>
        <select value={inventoryUnit} onChange={(e) => setInventoryUnit(e.target.value)} className="input-field">
          {units.map((u) => (
            <option key={u.code} value={u.code}>
              {u.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-400 mt-1">Pilih satuan terkecil yang Anda takar, mis. gram untuk kopi, ml untuk susu, pcs untuk cup.</p>
      </div>

      <div className="rounded-xl bg-neutral-50 p-3 space-y-2">
        <p className="text-sm font-medium text-neutral-700">Harga beli (untuk hitung HPP otomatis)</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <span>Beli seharga Rp</span>
          <input
            type="text"
            inputMode="numeric"
            value={formatNumberWithDots(priceInput)}
            onChange={(e) => setPriceInput(stripNumberDots(e.target.value).replace(/[^0-9]/g, ""))}
            placeholder="150.000"
            className="input-field w-32"
          />
          <span>untuk</span>
          <input
            type="text"
            inputMode="decimal"
            value={priceQtyInput}
            onChange={(e) => setPriceQtyInput(e.target.value.replace(/[^0-9.]/g, ""))}
            className="input-field w-20"
          />
          <span>{unitName}</span>
        </div>
        {costPerUnit ? (
          <p className="text-xs text-primary-dark font-medium">
            = {formatRupiah(costPerUnit)} per {unitName}. Harga ini dipakai untuk menghitung HPP menu.
          </p>
        ) : (
          <p className="text-xs text-neutral-400">Contoh: kopi 1 kg seharga Rp 150.000 → isi 150.000 untuk 1000 gram.</p>
        )}
      </div>

      {isNew && (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Stok awal ({unitName}) — opsional</label>
          <input
            type="text"
            inputMode="decimal"
            value={initialStockInput}
            onChange={(e) => setInitialStockInput(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Contoh: 5000"
            disabled={!canSetStock}
            className="input-field disabled:opacity-50"
          />
          {!canSetStock && (
            <p className="text-xs text-neutral-400 mt-1">Pilih 1 cabang di kanan atas dulu kalau mau mengisi stok awal, atau isi nanti lewat tombol tambah stok.</p>
          )}
        </div>
      )}

      <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-primary-dark font-medium">
        {showAdvanced ? "Sembunyikan pengaturan lanjutan" : "Pengaturan lanjutan (kategori, satuan beli berbeda, batas stok menipis)"}
      </button>

      {showAdvanced && (
        <div className="space-y-3 border-t border-neutral-100 pt-3">
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori (opsional)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Contoh: food, beverage, packaging" className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Satuan beli (kalau beda dengan satuan resep)</label>
            <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} className="input-field">
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Rasio konversi manual (opsional)</label>
            <input
              type="text"
              inputMode="decimal"
              value={ratioInput}
              onChange={(e) => setRatioInput(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="Kosongkan jika pakai konversi unit standar"
              className="input-field"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Isi hanya kalau 1 satuan beli isinya tidak standar (mis. 1 box = 24 pcs).
            </p>
          </div>
        </div>
      )}
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Ingatkan saya kalau stok tinggal</label>
        <input
          type="text"
          inputMode="numeric"
          value={thresholdInput}
          onChange={(e) => setThresholdInput(e.target.value.replace(/[^0-9.]/g, ""))}
          className="input-field"
        />
      </div>
    </Modal>
  );
}

function AdjustStockModal({
  ingredient,
  saving,
  currentQty,
  currentCost,
  onClose,
  onSubmit,
}: {
  ingredient: Ingredient;
  saving: boolean;
  currentQty: number;
  currentCost: number;
  onClose: () => void;
  onSubmit: (ing: Ingredient, qty: number, note: string, totalPrice?: number) => void;
}) {
  const [qtyInput, setQtyInput] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [note, setNote] = useState("");
  const [totalPriceInput, setTotalPriceInput] = useState("");
  const rawQty = qtyInput === "" ? 0 : Number(qtyInput);
  const signedQty = direction === "in" ? rawQty : -rawQty;
  const totalPrice = totalPriceInput === "" ? 0 : Number(stripNumberDots(totalPriceInput));
  const newCost =
    direction === "in" && rawQty > 0 && totalPrice > 0
      ? currentQty > 0
        ? (currentQty * currentCost + totalPrice) / (currentQty + rawQty)
        : totalPrice / rawQty
      : null;

  return (
    <Modal
      title={`Tambah / Kurangi Stok — ${ingredient.name}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving || rawQty <= 0}
          onClick={() => onSubmit(ingredient, signedQty, note, direction === "in" ? totalPrice : undefined)}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div className="flex gap-2">
        <button
          onClick={() => setDirection("in")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "in" ? "border-primary-dark bg-primary-light text-primary-dark" : "border-neutral-200 text-neutral-500")}
        >
          Belanja / Tambah Stok
        </button>
        <button
          onClick={() => setDirection("out")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "out" ? "border-urgent bg-urgent-light text-urgent" : "border-neutral-200 text-neutral-500")}
        >
          Kurangi (Rusak/Terbuang)
        </button>
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Jumlah ({ingredient.inventory_unit})</label>
        <input
          type="text"
          inputMode="decimal"
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Contoh: 5000"
          className="input-field"
        />
      </div>
      {direction === "in" && (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Total harga belanja ini (Rp) — opsional</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatNumberWithDots(totalPriceInput)}
            onChange={(e) => setTotalPriceInput(stripNumberDots(e.target.value).replace(/[^0-9]/g, ""))}
            placeholder="Contoh: 150.000"
            className="input-field"
          />
          <p className="text-xs text-neutral-400 mt-1">
            {newCost
              ? `Harga rata-rata baru: ${formatRupiah(newCost)} per ${ingredient.inventory_unit} (otomatis dipakai untuk HPP).`
              : "Isi supaya harga bahan & HPP menu ikut terbarui otomatis."}
          </p>
        </div>
      )}
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Beli dari supplier A" className="input-field" />
      </div>
    </Modal>
  );
}
