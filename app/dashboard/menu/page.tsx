"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, ImagePlus, Loader2, Lock, WifiOff } from "lucide-react";
import { formatRupiah, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { compressImage } from "@/lib/compressImage";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { db } from "@/lib/dexie";
import { SYNC_COMPLETE_EVENT } from "@/lib/offlineSync";
import Modal from "@/components/Modal";
import type { Product } from "@/lib/types";
import { Skeleton, SkeletonCardGrid } from "@/components/Skeleton";

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
  // OFFLINE MODE — true kalau load terakhir gagal karena tidak ada
  // jaringan (bukan error lain), jadi yang ditampilkan adalah cache lokal
  // + perubahan yang masih tertunda, bukan data server yang terverifikasi.
  const [isOffline, setIsOffline] = useState(false);

  async function loadMenu() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);

    if (!navigator.onLine) {
      await loadFromCacheAndQueue(profile.tenant_id);
      setIsOffline(true);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    try {
      const [{ data, error }, { data: sub }] = await Promise.all([
        supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).order("created_at", { ascending: false }),
        supabase.from("subscriptions").select("status, plan").eq("tenant_id", profile.tenant_id).single(),
      ]);

      if (error) throw error;

      const fresh = (data as Product[]) ?? [];
      setMenu(fresh);
      setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
      setIsOffline(false);

      // Simpan ke cache lokal (dipakai /pos juga) — HANYA milik tenant ini
      // yang ditimpa, bukan seluruh device (lihat fix cross-tenant di
      // app/pos/page.tsx sebelumnya).
      await db.products.where("tenant_id").equals(profile.tenant_id).delete();
      if (fresh.length > 0) {
        await db.products.bulkPut(
          fresh.map((p) => ({
            id: p.id,
            tenant_id: p.tenant_id,
            name: p.name,
            price: p.price,
            category: p.category,
            image_url: p.image_url,
            is_available: p.is_available,
            created_at: p.created_at,
          }))
        );
      }
    } catch {
      // Fetch gagal (mis. jaringan putus di tengah jalan walau
      // navigator.onLine masih bilang true — kondisi umum di wifi kafe
      // yang tidak stabil) — pakai cache lokal sebagai fallback juga.
      await loadFromCacheAndQueue(profile.tenant_id);
      setIsOffline(true);
    }
    setLoading(false);
  }

  /**
   * Baca menu dari cache Dexie (terakhir tersimpan waktu online), lalu
   * timpa/tambahkan dengan perubahan offline yang masih menunggu sinkron
   * (pendingProductOps) supaya Owner tetap melihat menu&perubahannya
   * sendiri walau belum benar-benar tersimpan di server.
   */
  async function loadFromCacheAndQueue(tid: string) {
    const cached = await db.products.where("tenant_id").equals(tid).toArray();
    const pendingOps = await db.pendingProductOps.where({ tenant_id: tid, synced: 0 }).toArray();

    const byId = new Map<string, Product>(cached.map((c) => [c.id, c as Product]));
    for (const op of pendingOps) {
      if (op.op === "insert") {
        const base = byId.get(op.product_id);
        byId.set(op.product_id, {
          id: op.product_id,
          tenant_id: tid,
          name: op.payload.name ?? base?.name ?? "",
          price: op.payload.price ?? base?.price ?? 0,
          category: op.payload.category ?? base?.category ?? "Kopi",
          image_url: op.image_blob ? URL.createObjectURL(op.image_blob) : op.payload.image_url ?? base?.image_url ?? null,
          is_available: op.payload.is_available ?? true,
          created_at: base?.created_at ?? new Date().toISOString(),
        });
      } else {
        const base = byId.get(op.product_id);
        if (base) {
          byId.set(op.product_id, {
            ...base,
            ...op.payload,
            image_url: op.image_blob ? URL.createObjectURL(op.image_blob) : op.payload.image_url ?? base.image_url,
          });
        }
      }
    }
    setMenu(Array.from(byId.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  }

  useEffect(() => {
    loadMenu();
    // Begitu sinkronisasi latar belakang (lib/offlineSync.ts) selesai
    // mengirim perubahan menu yang tertunda, muat ulang supaya id
    // sementara "local-..." tergantikan data asli dari server.
    function onSynced() {
      loadMenu();
    }
    window.addEventListener(SYNC_COMPLETE_EVENT, onSynced);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, onSynced);
  }, []);

  const atMenuLimit = tier === "free" && menu.length >= FREE_TIER_LIMITS.maxMenu;

  async function queueProductOp(op: {
    op: "insert" | "update" | "toggle_availability";
    product_id: string;
    payload: Partial<Pick<Product, "name" | "price" | "category" | "image_url" | "is_available">>;
    image_blob?: Blob;
  }) {
    if (!tenantId) return;
    await db.pendingProductOps.add({
      tenant_id: tenantId,
      op: op.op,
      product_id: op.product_id,
      payload: op.payload,
      image_blob: op.image_blob,
      synced: 0,
      created_at: new Date().toISOString(),
    });
  }

  async function toggleAvailability(product: Product) {
    const next = !product.is_available;
    setMenu((prev) => prev.map((m) => (m.id === product.id ? { ...m, is_available: next } : m)));

    if (!navigator.onLine) {
      await queueProductOp({ op: "toggle_availability", product_id: product.id, payload: { is_available: next } });
      await db.products.update(product.id, { is_available: next }).catch(() => {});
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ is_available: next })
      .eq("id", product.id);
    if (error) {
      setMenu((prev) => prev.map((m) => (m.id === product.id ? { ...m, is_available: !next } : m)));
      alert("Gagal mengubah status ketersediaan: " + error.message);
    } else {
      await db.products.update(product.id, { is_available: next }).catch(() => {});
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

  async function saveProduct(p: Product, imageBlob?: Blob) {
    setSaving(true);

    // OFFLINE — antrekan perubahan, update tampilan secara optimistic,
    // JANGAN coba panggil Supabase sama sekali (pasti gagal & cuma buang
    // waktu tunggu timeout). Disinkron otomatis oleh lib/offlineSync.ts
    // begitu koneksi kembali (lihat SubscriptionCutoffGate).
    if (!navigator.onLine) {
      const isNew = !p.id;
      const localId = isNew ? `local-${crypto.randomUUID()}` : p.id;
      const payload = { name: p.name, price: p.price, category: p.category, image_url: p.image_url };

      await queueProductOp({
        op: isNew ? "insert" : "update",
        product_id: localId,
        payload,
        image_blob: imageBlob,
      });

      const optimistic: Product = {
        id: localId,
        tenant_id: p.tenant_id,
        name: p.name,
        price: p.price,
        category: p.category,
        image_url: imageBlob ? URL.createObjectURL(imageBlob) : p.image_url,
        is_available: isNew ? true : p.is_available,
        created_at: isNew ? new Date().toISOString() : p.created_at,
      };
      setMenu((prev) => (isNew ? [optimistic, ...prev] : prev.map((m) => (m.id === p.id ? optimistic : m))));
      await db.products.put(optimistic).catch(() => {}); // biar /pos langsung ikut lihat perubahan ini juga

      setSaving(false);
      setShowForm(false);
      return;
    }

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <SkeletonCardGrid count={8} />
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

      {isOffline && (
        <div className="card p-4 flex items-center gap-3 border-warning bg-warning-light">
          <WifiOff size={18} className="text-warning shrink-0" />
          <p className="text-sm text-neutral-800">
            Sedang offline — menampilkan data tersimpan di device ini. Perubahan yang kamu buat (tambah/edit/toggle menu)
            tetap tersimpan dan akan otomatis terkirim ke server begitu koneksi kembali.
          </p>
        </div>
      )}

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
              {product.id.startsWith("local-") && (
                <span className="absolute top-2 left-2 badge-warning text-[10px]">Belum sinkron</span>
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
  onSave: (p: Product, imageBlob?: Blob) => void;
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
  // Foto yang sudah dikompres tapi BELUM diupload karena sedang offline —
  // dikirim ke onSave() untuk diantrekan (lib/dexie.ts: PendingProductOp.image_blob),
  // baru benar-benar diupload saat sinkron (lib/offlineSync.ts).
  const [pendingImageBlob, setPendingImageBlob] = useState<Blob | undefined>(undefined);

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

    // OFFLINE — tidak ada gunanya coba upload ke Supabase Storage sekarang
    // (pasti gagal). Simpan blob-nya saja, pakai local object URL untuk
    // preview, upload sungguhan menyusul otomatis saat sinkron.
    if (!navigator.onLine) {
      setPendingImageBlob(compressedFile);
      setPreview(URL.createObjectURL(compressedFile));
      setUploading(false);
      return;
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
          onClick={() => onSave({ ...form, price: parsedPrice }, pendingImageBlob)}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Menu
        </button>
      }
    >
      {!navigator.onLine && (
        <p className="text-xs text-warning bg-warning-light rounded-lg px-3 py-2 flex items-center gap-2">
          <WifiOff size={14} /> Sedang offline — menu ini akan tersimpan di device dulu, terkirim otomatis begitu online lagi.
        </p>
      )}
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
