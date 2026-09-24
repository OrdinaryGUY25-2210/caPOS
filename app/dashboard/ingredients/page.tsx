"use client";

import { useEffect, useMemo, useState } from "react";
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
  const { selectedBranchId, selectedBranch, canSwitchBranch } = useBranch();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, StockRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("owner");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "low">("all");
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [restocking, setRestocking] = useState<Ingredient | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Ingredient | null>(null);

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

    setIngredients((ingData as Ingredient[]) ?? []);
    setUnits((unitData as Unit[]) ?? []);

    const map = new Map<string, StockRow[]>();
    for (const row of (stockData as (StockRow & { ingredient_id: string })[]) ?? []) {
      const list = map.get(row.ingredient_id) ?? [];
      list.push(row);
      map.set(row.ingredient_id, list);
    }
    setStockMap(map);
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

  async function saveIngredient(payload: Partial<Ingredient> & { name: string; purchase_unit: string; inventory_unit: string }) {
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
      ({ error } = await supabase.from("ingredients").insert({
        tenant_id: profile.tenant_id,
        name: payload.name,
        category: payload.category ?? null,
        purchase_unit: payload.purchase_unit,
        inventory_unit: payload.inventory_unit,
        purchase_to_inventory_ratio: payload.purchase_to_inventory_ratio ?? null,
        low_stock_threshold: payload.low_stock_threshold ?? 0,
        status: "active",
        is_86: false,
      }));
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

  async function doAdjustStock(ing: Ingredient, qty: number, note: string) {
    if (!qty || qty === 0) return;
    if (isConsolidated) {
      alert("Pilih 1 cabang dulu di kanan atas untuk menyesuaikan stok bahan.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_ingredient_stock", {
      p_ingredient_id: ing.id,
      p_branch_id: selectedBranchId,
      p_qty_change: qty,
      p_type: qty > 0 ? "PURCHASE" : "WASTE",
      p_note: note || (qty > 0 ? "Restock manual bahan baku" : "Penyesuaian pengurangan manual"),
    });
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
            <Wheat size={20} className="text-primary-dark" /> Bahan Baku (Ingredients)
          </h1>
          <p className="text-sm text-neutral-500">
            Master bahan baku dasar untuk resep — stok tercatat per cabang
            {canSwitchBranch && !isConsolidated && selectedBranch ? ` (${selectedBranch.name})` : ""}.
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setEditing("new")} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Tambah Bahan
          </button>
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
          <p className="text-sm text-neutral-500">Nilai Inventori Bahan (stok × HPP)</p>
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
              <th className="p-3 font-medium">HPP / unit</th>
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
                  <td className="p-3">{formatRupiah(costFor(ing.id))}</td>
                  <td className="p-3">
                    <span className={ing.status === "active" ? "badge-active" : "bg-neutral-100 text-neutral-500 text-xs font-medium px-2 py-0.5 rounded-full"}>
                      {ing.status === "active" ? "Aktif" : "Diarsipkan"}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {canWrite && (
                      <>
                        <button
                          onClick={() => setRestocking(ing)}
                          disabled={isConsolidated}
                          className="text-primary-dark hover:bg-primary-light rounded-lg p-1.5 mr-1 disabled:opacity-30"
                          title="Sesuaikan Stok"
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
          onClose={() => setEditing(null)}
          onSave={saveIngredient}
        />
      )}

      {restocking && (
        <AdjustStockModal ingredient={restocking} saving={saving} onClose={() => setRestocking(null)} onSubmit={doAdjustStock} />
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
  onClose,
  onSave,
}: {
  ingredient: Ingredient | null;
  units: Unit[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Partial<Ingredient> & { name: string; purchase_unit: string; inventory_unit: string }) => void;
}) {
  const [name, setName] = useState(ingredient?.name ?? "");
  const [category, setCategory] = useState(ingredient?.category ?? "");
  const [purchaseUnit, setPurchaseUnit] = useState(ingredient?.purchase_unit ?? units[0]?.code ?? "");
  const [inventoryUnit, setInventoryUnit] = useState(ingredient?.inventory_unit ?? units[0]?.code ?? "");
  const [ratioInput, setRatioInput] = useState(ingredient?.purchase_to_inventory_ratio ? String(ingredient.purchase_to_inventory_ratio) : "");
  const [thresholdInput, setThresholdInput] = useState(String(ingredient?.low_stock_threshold ?? 0));

  const canSubmit = name.trim() && purchaseUnit && inventoryUnit;

  return (
    <Modal
      title={ingredient ? `Edit Bahan — ${ingredient.name}` : "Tambah Bahan Baku"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !canSubmit}
          onClick={() =>
            onSave({
              id: ingredient?.id,
              name: name.trim(),
              category: category.trim() || null,
              purchase_unit: purchaseUnit,
              inventory_unit: inventoryUnit,
              purchase_to_inventory_ratio: ratioInput ? Number(ratioInput) : null,
              low_stock_threshold: thresholdInput === "" ? 0 : Number(thresholdInput),
              status: ingredient?.status,
              is_86: ingredient?.is_86,
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
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Bahan</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Biji Kopi Arabika" className="input-field" />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori (opsional)</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Contoh: food, beverage, packaging" className="input-field" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Unit Beli</label>
          <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} className="input-field">
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Unit Stok (dasar)</label>
          <select value={inventoryUnit} onChange={(e) => setInventoryUnit(e.target.value)} className="input-field">
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Rasio Konversi Manual (opsional)</label>
        <input
          type="text"
          inputMode="decimal"
          value={ratioInput}
          onChange={(e) => setRatioInput(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Kosongkan jika pakai konversi unit standar"
          className="input-field"
        />
        <p className="text-xs text-neutral-400 mt-1">
          Isi HANYA kalau rasio beli↔stok bahan ini beda dari konversi unit standar (mis. supplier tertentu jual &quot;1 box = 24 pcs&quot;).
          Kalau kosong, sistem pakai tabel konversi unit yang sudah ada.
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Batas Stok Menipis</label>
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
  onClose,
  onSubmit,
}: {
  ingredient: Ingredient;
  saving: boolean;
  onClose: () => void;
  onSubmit: (ing: Ingredient, qty: number, note: string) => void;
}) {
  const [qtyInput, setQtyInput] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [note, setNote] = useState("");
  const rawQty = qtyInput === "" ? 0 : Number(qtyInput);
  const signedQty = direction === "in" ? rawQty : -rawQty;

  return (
    <Modal
      title={`Sesuaikan Stok — ${ingredient.name}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving || rawQty <= 0}
          onClick={() => onSubmit(ingredient, signedQty, note)}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Penyesuaian
        </button>
      }
    >
      <div className="flex gap-2">
        <button
          onClick={() => setDirection("in")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "in" ? "border-primary-dark bg-primary-light text-primary-dark" : "border-neutral-200 text-neutral-500")}
        >
          Tambah Stok (Restock)
        </button>
        <button
          onClick={() => setDirection("out")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "out" ? "border-urgent bg-urgent-light text-urgent" : "border-neutral-200 text-neutral-500")}
        >
          Kurangi (Waste/Rusak)
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
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Beli dari supplier A" className="input-field" />
      </div>
    </Modal>
  );
}
