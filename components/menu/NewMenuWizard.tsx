"use client";

import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { formatRupiah, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/compressImage";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import Modal from "@/components/Modal";
import type { Ingredient, Unit } from "@/lib/types";

/**
 * Wizard "Tambah Menu" — satu alur untuk menu + bahan + HPP (hanya untuk menu BARU & saat online;
 * edit menu & mode offline tetap memakai ProductForm lama di halaman Kelola Menu).
 *
 *  Langkah 1  Info menu   : foto, nama, harga, kategori
 *  Langkah 2  Bahan       : pilih bahan + takaran per porsi (boleh + Bahan baru di sini juga).
 *                           Dikosongkan = menu tanpa resep (stok diatur manual seperti biasa).
 *  Langkah 3  Ringkasan   : HPP perkiraan, margin, peringatan bahan yang harganya belum ada.
 *
 * Menu berresep disimpan lewat RPC create_menu_with_recipe (migration_025) — menu, resep, dan
 * item resep dalam SATU transaksi. Varian & modifier TIDAK diatur di sini (tetap di halaman
 * Varian Produk / Modifier).
 */

interface RecipeRow {
  key: string;
  ingredient_id: string;
  qty: string; // teks, supaya bisa dikosongkan saat mengetik
}

interface Conversion {
  tenant_id: string | null;
  from_unit: string;
  to_unit: string;
  factor: number;
}

interface Props {
  tenantId: string;
  existingCategories: string[];
  onClose: () => void;
  /** Dipanggil setelah menu tersimpan (halaman induk memuat ulang daftar menu). */
  onSaved: () => void;
  /** Dipanggil kalau trigger batas paket Free menolak (FREE_TIER_MENU_LIMIT). */
  onLimitReached: () => void;
}

export default function NewMenuWizard({ tenantId, existingCategories, onClose, onSaved, onLimitReached }: Props) {
  const { selectedBranchId, ownBranchId } = useBranch();
  // Sama seperti PO: dari "Laporan Konsolidasi" tidak ada cabang tunggal, pakai cabang milik sendiri.
  const branchId = selectedBranchId === ALL_BRANCHES ? ownBranchId : selectedBranchId;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  // --- Langkah 1 ---
  const [name, setName] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [category, setCategory] = useState(existingCategories[0] ?? "Kopi");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // --- Langkah 2 ---
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [branchCost, setBranchCost] = useState<Map<string, number>>(new Map());
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [showNewIng, setShowNewIng] = useState(false);

  const price = priceInput === "" ? 0 : Number(priceInput);
  const priceValid = priceInput !== "" && !Number.isNaN(price) && price > 0;
  const step1Valid = name.trim().length > 0 && priceValid;

  const unitName = (code: string) => units.find((u) => u.code === code)?.name ?? code;

  async function loadData() {
    setLoadingData(true);
    const supabase = createClient();
    const [ingRes, unitRes, convRes, costRes] = await Promise.all([
      supabase.from("ingredients").select("*").eq("tenant_id", tenantId).eq("status", "active").order("name", { ascending: true }),
      supabase.from("units").select("*").eq("is_active", true).order("name", { ascending: true }),
      supabase.from("unit_conversions").select("tenant_id, from_unit, to_unit, factor"),
      branchId
        ? supabase.from("branch_ingredients_stock").select("ingredient_id, cost_price").eq("branch_id", branchId)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setIngredients((ingRes.data as Ingredient[]) ?? []);
    setUnits((unitRes.data as Unit[]) ?? []);
    setConversions((convRes.data as Conversion[]) ?? []);
    const m = new Map<string, number>();
    for (const r of ((costRes as any).data as { ingredient_id: string; cost_price: number }[]) ?? []) {
      m.set(r.ingredient_id, Number(r.cost_price) || 0);
    }
    setBranchCost(m);
    setLoadingData(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Isi per unit beli → unit stok (mis. 1 bungkus = 250 gram), atau null kalau belum diketahui. */
  function factorFor(ing: Pick<Ingredient, "purchase_unit" | "inventory_unit" | "purchase_to_inventory_ratio">): number | null {
    if (ing.purchase_unit === ing.inventory_unit) return 1;
    if (ing.purchase_to_inventory_ratio) return Number(ing.purchase_to_inventory_ratio);
    const own = conversions.find((c) => c.tenant_id === tenantId && c.from_unit === ing.purchase_unit && c.to_unit === ing.inventory_unit);
    const glob = conversions.find((c) => c.tenant_id === null && c.from_unit === ing.purchase_unit && c.to_unit === ing.inventory_unit);
    const f = own?.factor ?? glob?.factor;
    return f ? Number(f) : null;
  }

  /** Harga per unit stok: rata-rata nyata dari stok cabang kalau ada, kalau tidak harga beli terakhir. */
  function unitCostFor(ing: Ingredient): { cost: number | null; source: "stok" | "harga beli" | null } {
    const real = branchCost.get(ing.id) ?? 0;
    if (real > 0) return { cost: real, source: "stok" };
    const f = factorFor(ing);
    const last = Number(ing.last_purchase_price ?? 0);
    if (last > 0 && f && f > 0) return { cost: last / f, source: "harga beli" };
    return { cost: null, source: null };
  }

  const validRows = rows.filter((r) => r.ingredient_id && Number(r.qty) > 0);
  const lines = useMemo(
    () =>
      validRows.map((r) => {
        const ing = ingredients.find((i) => i.id === r.ingredient_id)!;
        const qty = Number(r.qty);
        const uc = ing ? unitCostFor(ing) : { cost: null, source: null };
        return { ing, qty, cost: uc.cost, source: uc.source, subtotal: uc.cost != null ? qty * uc.cost : 0 };
      }).filter((l) => l.ing),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, ingredients, branchCost, conversions]
  );
  const hpp = lines.reduce((s, l) => s + l.subtotal, 0);
  const missingPrice = lines.filter((l) => l.cost == null);
  const margin = price > 0 ? Math.round(((price - hpp) / price) * 100) : 0;
  const hasRecipe = lines.length > 0;
  const rowsIncomplete = rows.length > 0 && validRows.length !== rows.length;

  function addRow() {
    setRows((p) => [...p, { key: crypto.randomUUID(), ingredient_id: "", qty: "" }]);
  }
  function updateRow(key: string, patch: Partial<RecipeRow>) {
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((p) => p.filter((r) => r.key !== key));
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    setUploading(true);
    const file = await compressImage(raw, { maxDimension: 1200, quality: 0.82, format: "webp", maxSizeKB: 180 });
    const supabase = createClient();
    const ext = file.type === "image/webp" ? "webp" : "jpg";
    const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("menu-images").upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      alert("Upload gambar gagal: " + error.message);
      setUploading(false);
      return;
    }
    setImageUrl(supabase.storage.from("menu-images").getPublicUrl(path).data.publicUrl);
    setUploading(false);
  }

  async function save() {
    if (saving) return; // cegah klik ganda
    if (!navigator.onLine) {
      alert("Wizard ini butuh koneksi internet. Sambungkan dulu, atau tutup lalu simpan menu tanpa resep saat offline.");
      return;
    }
    if (hasRecipe && !branchId) {
      alert("Pilih 1 cabang dulu di kanan atas sebelum menyimpan menu berresep.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const productId = crypto.randomUUID();

    let errMsg: string | null = null;
    if (hasRecipe) {
      const { error } = await supabase.rpc("create_menu_with_recipe", {
        p_product_id: productId,
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_name: name.trim(),
        p_category: category.trim() || "Kopi",
        p_price: price,
        p_items: lines.map((l) => ({ ingredient_id: l.ing.id, quantity: l.qty })),
        p_image_url: imageUrl,
      });
      errMsg = error?.message ?? null;
    } else {
      const { error } = await supabase.from("products").insert({
        id: productId,
        tenant_id: tenantId,
        name: name.trim(),
        price,
        category: category.trim() || "Kopi",
        image_url: imageUrl,
        is_available: true,
      });
      errMsg = error?.message ?? null;
    }
    setSaving(false);

    if (errMsg) {
      if (errMsg.includes("FREE_TIER_MENU_LIMIT")) {
        onLimitReached();
        onClose();
      } else {
        alert("Gagal menambah menu: " + errMsg);
      }
      return;
    }
    onSaved();
    onClose();
  }

  // ---------------------------------------------------------------- UI
  const stepLabels = ["Info menu", "Bahan", "Ringkasan"];

  const footer = (
    <div className="flex gap-2 w-full">
      {step > 1 && (
        <button
          type="button"
          disabled={saving}
          onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
          className="btn-outline flex-1"
        >
          Kembali
        </button>
      )}
      {step === 1 && (
        <button type="button" disabled={!step1Valid || uploading} onClick={() => setStep(2)} className="btn-primary flex-1 disabled:opacity-50">
          Lanjut: Bahan
        </button>
      )}
      {step === 2 && (
        <button type="button" disabled={rowsIncomplete} onClick={() => setStep(3)} className="btn-primary flex-1 disabled:opacity-50">
          {hasRecipe ? "Lanjut: Ringkasan" : "Lewati (tanpa resep)"}
        </button>
      )}
      {step === 3 && (
        <button type="button" disabled={saving} onClick={save} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Menu
        </button>
      )}
    </div>
  );

  return (
    <Modal title="Tambah Menu" onClose={onClose} footer={footer} maxWidth="sm:max-w-xl">
      {/* indikator langkah */}
      <ol className="flex items-center gap-2 text-xs">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cx(
                  "w-5 h-5 rounded-full flex items-center justify-center font-semibold",
                  active ? "bg-primary text-white" : done ? "bg-primary-light text-primary-dark" : "bg-neutral-100 text-neutral-400"
                )}
              >
                {n}
              </span>
              <span className={active ? "font-semibold text-neutral-900" : "text-neutral-400"}>{label}</span>
              {n < 3 && <span className="text-neutral-300">—</span>}
            </li>
          );
        })}
      </ol>

      {/* ---------------- Langkah 1 ---------------- */}
      {step === 1 && (
        <div className="space-y-4">
          <label className="aspect-video rounded-xl bg-neutral-100 flex flex-col items-center justify-center text-neutral-400 cursor-pointer overflow-hidden">
            {uploading ? (
              <Loader2 className="animate-spin" size={22} />
            ) : imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
            ) : (
              <>
                <ImagePlus size={22} />
                <span className="text-xs mt-1">Upload Foto Menu (opsional)</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={handleImage} className="hidden" disabled={uploading} />
          </label>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Menu</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="input-field" placeholder="Contoh: Es Kopi Susu" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Harga Jual</label>
            <input
              type="text"
              inputMode="numeric"
              value={formatNumberWithDots(priceInput)}
              onChange={(e) => setPriceInput(stripNumberDots(e.target.value))}
              placeholder="Contoh: 25.000"
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori</label>
            <input
              list="wizard-category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Pilih atau ketik kategori baru"
              className="input-field"
            />
            <datalist id="wizard-category-suggestions">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      )}

      {/* ---------------- Langkah 2 ---------------- */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Pilih bahan dan takaran <strong>per 1 porsi</strong>. Stok menu nanti otomatis mengikuti stok bahan, dan HPP dihitung
            dari harga bahan. Tidak punya resep? Langsung lewati.
          </p>

          {loadingData ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400 py-6 justify-center">
              <Loader2 className="animate-spin" size={16} /> Memuat bahan baku...
            </div>
          ) : (
            <>
              {rows.map((r) => {
                const ing = ingredients.find((i) => i.id === r.ingredient_id);
                const usedElsewhere = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.ingredient_id));
                const uc = ing ? unitCostFor(ing) : null;
                return (
                  <div key={r.key} className="rounded-xl border border-neutral-200 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <select
                        value={r.ingredient_id}
                        onChange={(e) => updateRow(r.key, { ingredient_id: e.target.value })}
                        className="input-field flex-1"
                      >
                        <option value="">-- Pilih bahan --</option>
                        {ingredients
                          .filter((i) => !usedElsewhere.has(i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </select>
                      <button type="button" onClick={() => removeRow(r.key)} className="p-2 text-neutral-400 hover:text-urgent" title="Hapus bahan">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {ing && (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.qty}
                          onChange={(e) => updateRow(r.key, { qty: e.target.value.replace(/[^0-9.]/g, "") })}
                          placeholder="Takaran"
                          className="input-field w-28"
                        />
                        <span className="text-sm text-neutral-600">{unitName(ing.inventory_unit)}</span>
                        <span className="ml-auto text-xs text-neutral-400">
                          {uc?.cost != null ? `${formatRupiah(uc.cost)} / ${unitName(ing.inventory_unit)}` : <span className="text-amber-600">harga belum ada</span>}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {ingredients.length === 0 && !showNewIng && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  Belum ada bahan baku. Klik &quot;+ Bahan baru&quot; di bawah untuk membuatnya langsung dari sini.
                </p>
              )}

              {!showNewIng && (
                <div className="flex gap-2">
                  <button type="button" onClick={addRow} disabled={ingredients.length === 0} className="btn-outline flex items-center gap-1.5 text-sm disabled:opacity-40">
                    <Plus size={14} /> Tambah bahan
                  </button>
                  <button type="button" onClick={() => setShowNewIng(true)} className="btn-outline flex items-center gap-1.5 text-sm">
                    <Plus size={14} /> Bahan baru
                  </button>
                </div>
              )}

              {showNewIng && (
                <NewIngredientForm
                  tenantId={tenantId}
                  units={units}
                  conversions={conversions}
                  onCancel={() => setShowNewIng(false)}
                  onCreated={(ing) => {
                    setIngredients((p) => [...p, ing].sort((a, b) => a.name.localeCompare(b.name)));
                    setRows((p) => [...p, { key: crypto.randomUUID(), ingredient_id: ing.id, qty: "" }]);
                    setShowNewIng(false);
                  }}
                />
              )}

              {rowsIncomplete && (
                <p className="text-xs text-amber-700">Lengkapi pilihan bahan dan takaran di setiap baris (atau hapus baris yang kosong).</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- Langkah 3 ---------------- */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl bg-neutral-50 p-4 space-y-1">
            <p className="text-sm text-neutral-500">{category || "Tanpa kategori"}</p>
            <p className="text-lg font-bold text-neutral-900">{name.trim()}</p>
            <p className="text-sm text-neutral-600">Harga jual {formatRupiah(price)}</p>
          </div>

          {hasRecipe ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="card p-3">
                  <p className="text-xs text-neutral-500">HPP per porsi (perkiraan)</p>
                  <p className="text-xl font-bold text-neutral-900">{formatRupiah(hpp)}</p>
                </div>
                <div className="card p-3">
                  <p className="text-xs text-neutral-500">Margin</p>
                  <p className={cx("text-xl font-bold", margin < 20 ? "text-urgent" : "text-primary-dark")}>{margin}%</p>
                </div>
              </div>

              <table className="w-full text-xs">
                <thead className="text-neutral-400 text-left">
                  <tr>
                    <th className="py-1 font-medium">Bahan</th>
                    <th className="py-1 font-medium">Takaran</th>
                    <th className="py-1 font-medium text-right">Biaya</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {lines.map((l) => (
                    <tr key={l.ing.id}>
                      <td className="py-1.5">{l.ing.name}</td>
                      <td className="py-1.5">
                        {l.qty} {unitName(l.ing.inventory_unit)}
                      </td>
                      <td className="py-1.5 text-right">{l.cost != null ? formatRupiah(l.subtotal) : <span className="text-amber-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {missingPrice.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 space-y-1">
                  <p className="font-semibold">HPP belum lengkap</p>
                  <p>
                    Harga belum ada untuk: {missingPrice.map((l) => l.ing.name).join(", ")}. Isi &quot;Harga beli terakhir&quot; (dan rasio
                    konversi bila perlu) di halaman Bahan Baku, atau terima barangnya lewat GRN. Menu tetap bisa disimpan sekarang.
                  </p>
                </div>
              )}
              <p className="text-xs text-neutral-400">
                Angka di atas perkiraan. Setelah disimpan, HPP sebenarnya dihitung ulang oleh sistem dan bisa dilihat di Stok &amp; HPP.
              </p>
              {!branchId && (
                <p className="text-xs text-urgent">Pilih 1 cabang dulu di kanan atas sebelum menyimpan menu berresep.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-600 bg-neutral-50 rounded-xl p-3">
              Menu ini disimpan <strong>tanpa resep</strong>. Stok dan HPP-nya diatur manual lewat halaman Stok &amp; HPP. Resep bisa
              ditambahkan kapan saja lewat Resep &amp; HPP.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

// =====================================================================
// Form kecil "Bahan baru" di dalam wizard
// =====================================================================
function NewIngredientForm({
  tenantId,
  units,
  conversions,
  onCancel,
  onCreated,
}: {
  tenantId: string;
  units: Unit[];
  conversions: Conversion[];
  onCancel: () => void;
  onCreated: (ing: Ingredient) => void;
}) {
  const [name, setName] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState(units.find((u) => u.code === "bungkus")?.code ?? units[0]?.code ?? "");
  const [inventoryUnit, setInventoryUnit] = useState(units.find((u) => u.code === "gram")?.code ?? units[0]?.code ?? "");
  const [ratio, setRatio] = useState("");
  const [lastPrice, setLastPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const sameUnit = purchaseUnit === inventoryUnit;
  const standardConv = conversions.some(
    (c) => (c.tenant_id === null || c.tenant_id === tenantId) && c.from_unit === purchaseUnit && c.to_unit === inventoryUnit
  );
  const needsRatio = !sameUnit && !standardConv;
  const ratioValid = !needsRatio || (ratio !== "" && Number(ratio) > 0);
  const canSave = name.trim().length > 0 && purchaseUnit && inventoryUnit && ratioValid;

  async function create() {
    if (saving || !canSave) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("ingredients")
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        category: null,
        purchase_unit: purchaseUnit,
        inventory_unit: inventoryUnit,
        purchase_to_inventory_ratio: sameUnit ? null : ratio !== "" ? Number(ratio) : null,
        last_purchase_price: lastPrice !== "" ? Number(lastPrice) : null,
        low_stock_threshold: 0,
        status: "active",
        is_86: false,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      alert("Gagal membuat bahan: " + (error?.message ?? "tidak diketahui") + (error?.message?.includes("duplicate") ? "\n\nNama bahan itu sudah ada." : ""));
      return;
    }
    onCreated(data as Ingredient);
  }

  const unitLabel = (code: string) => units.find((u) => u.code === code)?.name ?? code;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary-light/20 p-3 space-y-3">
      <p className="text-sm font-semibold text-neutral-800">Bahan baru</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama bahan, mis. Biji Kopi Arabika" className="input-field" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Unit beli</label>
          <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} className="input-field">
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Unit stok (dasar)</label>
          <select value={inventoryUnit} onChange={(e) => setInventoryUnit(e.target.value)} className="input-field">
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!sameUnit && (
        <div>
          <label className="text-xs text-neutral-500 block mb-1">
            1 {unitLabel(purchaseUnit)} = berapa {unitLabel(inventoryUnit)}? {needsRatio ? "(wajib)" : "(opsional — konversi standar sudah ada)"}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={ratio}
            onChange={(e) => setRatio(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Contoh: 250"
            className={cx("input-field", needsRatio && ratio === "" && "border-amber-400")}
          />
        </div>
      )}

      <div>
        <label className="text-xs text-neutral-500 block mb-1">Harga beli terakhir per {unitLabel(purchaseUnit)} (opsional)</label>
        <input
          type="text"
          inputMode="numeric"
          value={formatNumberWithDots(lastPrice)}
          onChange={(e) => setLastPrice(stripNumberDots(e.target.value))}
          placeholder="Contoh: 50.000"
          className="input-field"
        />
        <p className="text-[11px] text-neutral-400 mt-1">Dipakai sebagai HPP sementara sebelum ada penerimaan barang (GRN).</p>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-outline flex-1 text-sm">
          Batal
        </button>
        <button type="button" onClick={create} disabled={!canSave || saving} className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
          {saving && <Loader2 className="animate-spin" size={14} />}
          Buat &amp; pakai
        </button>
      </div>
    </div>
  );
}
