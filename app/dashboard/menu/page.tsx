"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, ImagePlus, Loader2, Lock } from "lucide-react";
import { formatRupiah, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { compressImage } from "@/lib/compressImage";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import Modal from "@/components/Modal";
import type { Product } from "@/lib/types";

const CATEGORIES = ["Kopi", "Non-Kopi", "Makanan", "Dessert"];

export default function MenuPage() {
  const [menu, setMenu] = useState<Product[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  async function loadMenu() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);

    const supabase = createClient();
    const [{ data }, { data: sub }] = await Promise.all([
      supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
    ]);

    setMenu((data as Product[]) ?? []);
    setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
    setLoading(false);
  }

  useEffect(() => {
    loadMenu();
  }, []);

  const atMenuLimit = tier === "free" && menu.length >= FREE_TIER_LIMITS.maxMenu;

  async function toggleAvailability(product: Product) {
    const supabase = createClient();
    const next = !product.is_available;
    setMenu((prev) => prev.map((m) => (m.id === product.id ? { ...m, is_available: next } : m)));
    const { error } = await supabase
      .from("products")
      .update({ is_available: next })
      .eq("id", product.id);
    if (error) {
      setMenu((prev) => prev.map((m) => (m.id === product.id ? { ...m, is_available: !next } : m)));
      alert("Gagal mengubah status ketersediaan: " + error.message);
    }
  }

  function openNew() {
    if (!tenantId) return;
    if (atMenuLimit) {
      setLimitNotice(
        `Paket ${TIER_LABEL.free} maksimal ${FREE_TIER_LIMITS.maxMenu} menu. Upgrade ke Pro untuk menu unlimited.`
      );
      return;
    }
    setEditing({
      id: "",
      tenant_id: tenantId,
      name: "",
      price: 0,
      category: "Kopi",
      image_url: null,
      is_available: true,
      created_at: "",
    });
    setShowForm(true);
  }

  async function saveProduct(p: Product) {
    setSaving(true);
    const supabase = createClient();

    if (p.id) {
      const { error } = await supabase
        .from("products")
        .update({ name: p.name, price: p.price, category: p.category, image_url: p.image_url })
        .eq("id", p.id);
      if (error) {
        alert("Gagal menyimpan: " + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("products").insert({
        tenant_id: p.tenant_id,
        name: p.name,
        price: p.price,
        category: p.category,
        image_url: p.image_url,
        is_available: true,
      });
      if (error) {
        // Trigger database enforce_menu_limit() melempar pesan berawalan
        // "FREE_TIER_MENU_LIMIT:" — tangkap di sini supaya tampil sebagai
        // pesan upsell yang ramah, bukan error mentah dari Postgres.
        if (error.message.includes("FREE_TIER_MENU_LIMIT")) {
          setLimitNotice(`Paket ${TIER_LABEL.free} maksimal ${FREE_TIER_LIMITS.maxMenu} menu. Upgrade ke Pro untuk menu unlimited.`);
        } else {
          alert("Gagal menambah menu: " + error.message);
        }
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setShowForm(false);
    loadMenu();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat menu...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Kelola Menu & Stok</h1>
          <p className="text-sm text-neutral-500">
            Tambah, edit foto, dan atur ketersediaan menu
            {tier === "free" && <> — {menu.length}/{FREE_TIER_LIMITS.maxMenu} menu terpakai (paket {TIER_LABEL.free})</>}
          </p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2">
          {atMenuLimit ? <Lock size={16} /> : <Plus size={16} />} Tambah Menu
        </button>
      </div>

      {limitNotice && (
        <div className="card p-4 flex items-center justify-between gap-3 border-warning bg-warning-light">
          <p className="text-sm text-neutral-800">{limitNotice}</p>
          <Link href="/dashboard/subscription" className="btn-primary text-sm whitespace-nowrap">
            Lihat Paket
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {menu.map((product) => (
          <div key={product.id} className="card p-3">
            <div className="aspect-square rounded-xl bg-neutral-100 mb-2 flex items-center justify-center text-3xl text-neutral-300 relative overflow-hidden">
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                "☕"
              )}
              <button
                onClick={() => { setEditing(product); setShowForm(true); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-sm hover:bg-white"
              >
                <Pencil size={12} />
              </button>
            </div>
            <p className="text-sm font-semibold text-neutral-900 truncate">{product.name || "Tanpa nama"}</p>
            <p className="text-xs text-neutral-500">{product.category}</p>
            <p className="text-sm font-bold text-primary mt-1">{formatRupiah(product.price)}</p>

            <button
              onClick={() => toggleAvailability(product)}
              className={cx(
                "mt-2 w-full text-xs font-medium py-1.5 rounded-lg transition-colors",
                product.is_available ? "bg-primary-light text-primary-dark" : "bg-neutral-100 text-neutral-400"
              )}
            >
              {product.is_available ? "Tersedia" : "Habis / Nonaktif"}
            </button>
          </div>
        ))}
        {menu.length === 0 && (
          <p className="col-span-full text-center text-neutral-400 py-10">
            Belum ada menu. Klik &quot;Tambah Menu&quot; untuk mulai mengisi katalog kafe Anda.
          </p>
        )}
      </div>

      {showForm && editing && (
        <ProductForm
          product={editing}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={saveProduct}
          existingCategories={Array.from(new Set(menu.map((m) => m.category).filter(Boolean)))}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  saving,
  onClose,
  onSave,
  existingCategories,
}: {
  product: Product;
  saving: boolean;
  onClose: () => void;
  onSave: (p: Product) => void;
  existingCategories: string[];
}) {
  const [form, setForm] = useState(product);
  // Harga disimpan sebagai STRING terpisah di form ini (bukan langsung
  // number seperti Product.price) — supaya kolom bisa benar-benar
  // dikosongkan lalu ditulis manual. Sebelumnya `value={form.price}`
  // (number) + `Number(e.target.value)` bikin field SELALU balik ke "0"
  // tiap kali dikosongkan, karena Number("") = 0 langsung ditulis balik
  // ke state dan me-render ulang input dengan "0" lagi — jadi pengguna
  // tidak pernah benar-benar bisa menghapusnya.
  const [priceInput, setPriceInput] = useState(product.price > 0 ? String(product.price) : "");
  const [preview, setPreview] = useState<string | null>(product.image_url);
  const [uploading, setUploading] = useState(false);
  const [compressInfo, setCompressInfo] = useState<string | null>(null);

  const parsedPrice = priceInput === "" ? 0 : Number(priceInput);
  const priceValid = priceInput !== "" && !Number.isNaN(parsedPrice) && parsedPrice > 0;

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    setUploading(true);
    setCompressInfo(null);

    // Kompresi & konversi ke WebP dulu di browser sebelum upload — foto HP
    // modern sering 3-8MB. Target akhir 100-200KB (WebP kualitas diturunkan
    // bertahap kalau masih kebesaran); otomatis fallback ke JPEG kalau
    // browser tidak bisa meng-encode WebP.
    const compressedFile = await compressImage(rawFile, {
      maxDimension: 1200,
      quality: 0.82,
      format: "webp",
      maxSizeKB: 180,
    });
    const savedPct = Math.round((1 - compressedFile.size / rawFile.size) * 100);
    if (savedPct > 0) {
      setCompressInfo(`Dikompres ${savedPct}% (${(rawFile.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB, ${compressedFile.type === "image/webp" ? "WebP" : "JPEG"})`);
    }

    const supabase = createClient();
    const ext = compressedFile.type === "image/webp" ? "webp" : "jpg";
    const path = `${form.tenant_id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("menu-images")
      .upload(path, compressedFile, { upsert: true, contentType: compressedFile.type });

    if (uploadError) {
      alert(
        "Upload gambar gagal: " + uploadError.message +
        "\n\nPastikan bucket Storage 'menu-images' sudah dibuat dan diset Public di Supabase Dashboard."
      );
      setUploading(false);
      return;
    }

    const { data: publicUrl } = supabase.storage.from("menu-images").getPublicUrl(path);
    setPreview(publicUrl.publicUrl);
    setForm((f) => ({ ...f, image_url: publicUrl.publicUrl }));
    setUploading(false);
  }

  return (
    <Modal
      title={product.id ? "Edit Menu" : "Tambah Menu"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !form.name.trim() || !priceValid}
          onClick={() => onSave({ ...form, price: parsedPrice })}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Menu
        </button>
      }
    >
      <label className="aspect-video rounded-xl bg-neutral-100 flex flex-col items-center justify-center text-neutral-400 cursor-pointer overflow-hidden relative">
        {uploading ? (
          <Loader2 className="animate-spin" size={22} />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="preview" className="w-full h-full object-cover" />
        ) : (
          <>
            <ImagePlus size={22} />
            <span className="text-xs mt-1">Upload Foto Menu</span>
          </>
        )}
        <input type="file" accept="image/*" onChange={handleImage} className="hidden" disabled={uploading} />
      </label>
      {compressInfo && <p className="text-xs text-primary-dark">{compressInfo}</p>}

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Menu</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" maxLength={80} />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Harga</label>
        <input
          type="text"
          inputMode="numeric"
          // Ditampilkan dengan titik ribuan (mis. "20.000") supaya nominal
          // besar gampang dibaca sekilas, tapi state yang tersimpan tetap
          // digit polos ("20000") — jadi parsedPrice/priceValid di atas
          // tidak perlu berubah sama sekali.
          value={formatNumberWithDots(priceInput)}
          onChange={(e) => setPriceInput(stripNumberDots(e.target.value))}
          placeholder="Contoh: 20.000"
          className="input-field"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori</label>
        {/* Datalist, bukan <select> terkunci — bisa pilih kategori yang
            sudah ada ATAU ketik bebas kategori baru sepenuhnya. */}
        <input
          list="menu-category-suggestions"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          placeholder="Pilih atau ketik kategori baru"
          className="input-field"
        />
        <datalist id="menu-category-suggestions">
          {existingCategories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
    </Modal>
  );
}
