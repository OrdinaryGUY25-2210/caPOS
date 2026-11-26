"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, ImagePlus, Loader2, Lock, WifiOff, Wheat, Store } from "lucide-react";
import { formatRupiah, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { compressImage } from "@/lib/compressImage";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { db } from "@/lib/dexie";
import { SYNC_COMPLETE_EVENT } from "@/lib/offlineSync";
import Modal from "@/components/Modal";
import { useBranch } from "@/lib/branchContext";
import type { Product } from "@/lib/types";
import { Skeleton, SkeletonCardGrid } from "@/components/Skeleton";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { DEMO_PRODUCTS } from "@/lib/demoData";

const CATEGORIES = ["Kopi", "Non-Kopi", "Makanan", "Dessert"];

export default function MenuPage() {
  const { branches, canSwitchBranch } = useBranch();
  const [menu, setMenu] = useState<Product[]>([]);
  // product_id → set cabang yang TIDAK menjual menu itu (tidak ada baris = dijual di semua cabang).
  const [hiddenAt, setHiddenAt] = useState<Map<string, Set<string>>>(new Map());
  const [branchModalProduct, setBranchModalProduct] = useState<Product | null>(null);
  const [branchSaving, setBranchSaving] = useState(false);
  const activeBranches = branches.filter((b) => b.is_active);
  const showBranchControl = canSwitchBranch && activeBranches.length > 1;
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
  const [isDemo, setIsDemo] = useState(false);
  // null = belum dicek. Dipakai untuk mengingatkan Owner agar mengisi Bahan
  // Baku sebelum/sambil menambah menu (resep & HPP butuh bahan baku).
  const [ingredientCount, setIngredientCount] = useState<number | null>(null);

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

      const { count: ingCount } = await supabase
        .from("ingredients")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id)
        .eq("status", "active");
      setIngredientCount(ingCount ?? 0);

      const { data: bpaRows } = await supabase
        .from("branch_product_availability")
        .select("branch_id, product_id")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_available", false);
      const hidden = new Map<string, Set<string>>();
      for (const r of (bpaRows as { branch_id: string; product_id: string }[]) ?? []) {
        hidden.set(r.product_id, (hidden.get(r.product_id) ?? new Set<string>()).add(r.branch_id));
      }
      setHiddenAt(hidden);

      const fresh = (data as Product[]) ?? [];
      setMenu(fresh);
      setTier(profile.role === "super_admin" ? "supreme" : getTier(sub));
      setIsOffline(false);

      const noActivity = await tenantHasNoActivity();
      if (fresh.length === 0 && noActivity) {
        setIsDemo(true);
        setMenu(DEMO_PRODUCTS as Product[]);
      }

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

  /** Simpan cabang mana saja yang menjual menu ini (centang = dijual). */
  async function saveBranchAvailability(product: Product, soldAt: Set<string>) {
    if (!tenantId) return;
    setBranchSaving(true);
    const supabase = createClient();
    const rows = activeBranches.map((b) => ({
      tenant_id: tenantId,
      branch_id: b.id,
      product_id: product.id,
      is_available: soldAt.has(b.id),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("branch_product_availability").upsert(rows, { onConflict: "branch_id,product_id" });
    setBranchSaving(false);
    if (error) {
      alert("Gagal menyimpan: " + error.message + "\n(Pastikan migration_020 sudah dijalankan di Supabase.)");
      return;
    }
    setHiddenAt((prev) => {
      const next = new Map(prev);
      const hiddenSet = new Set(activeBranches.filter((b) => !soldAt.has(b.id)).map((b) => b.id));
      if (hiddenSet.size === 0) next.delete(product.id);
      else next.set(product.id, hiddenSet);
      return next;
    });
    setBranchModalProduct(null);
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
          <h1 className="text-xl font-bold text-neutral-900">Daftar Menu</h1>
          {isDemo && <DemoBadge />}
          <p className="text-sm text-neutral-500">
            Tambah menu, ubah harga/foto, dan atur tersedia atau habis
            {tier === "free" && <> — {menu.length}/{FREE_TIER_LIMITS.maxMenu} menu terpakai (paket {TIER_LABEL.free})</>}
          </p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {atMenuLimit ? <Lock size={16} /> : <Plus size={16} />} Tambah Menu
        </button>
      </div>

      {ingredientCount === 0 && (
        <div className="card p-4 flex items-center justify-between gap-3 border-warning bg-warning-light">
          <div className="flex items-start gap-3">
            <Wheat size={18} className="text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-neutral-800">
              <span className="font-semibold">Bahan baku belum ditambahkan.</span> Menu tetap bisa dibuat, tetapi
              resep, HPP, dan pengurangan stok otomatis baru berfungsi setelah bahan baku diisi.
            </p>
          </div>
          <Link href="/dashboard/ingredients" className="btn-primary text-sm whitespace-nowrap">
            Tambah Bahan Baku
          </Link>
        </div>
      )}

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
              {!isDemo && (
                <button
                  onClick={() => { setEditing(product); setShowForm(true); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-sm hover:bg-white"
                >
                  <Pencil size={12} />
                </button>
              )}
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

            {showBranchControl && !isDemo && !product.id.startsWith("local-") && (
              <button
                onClick={() => setBranchModalProduct(product)}
                className="mt-1.5 w-full flex items-center justify-center gap-1 text-[11px] text-neutral-500 hover:text-primary-dark py-1"
                title="Atur cabang mana saja yang menjual menu ini"
              >
                <Store size={11} />
                {(hiddenAt.get(product.id)?.size ?? 0) === 0
                  ? "Dijual di semua cabang"
                  : `Dijual di ${activeBranches.length - (hiddenAt.get(product.id)?.size ?? 0)} dari ${activeBranches.length} cabang`}
              </button>
            )}
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

      {branchModalProduct && (
        <BranchAvailabilityModal
          product={branchModalProduct}
          branches={activeBranches.map((b) => ({ id: b.id, name: b.name }))}
          hiddenBranchIds={hiddenAt.get(branchModalProduct.id) ?? new Set()}
          saving={branchSaving}
          onClose={() => setBranchModalProduct(null)}
          onSave={(soldAt) => saveBranchAvailability(branchModalProduct, soldAt)}
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

function BranchAvailabilityModal({
  product,
  branches,
  hiddenBranchIds,
  saving,
  onClose,
  onSave,
}: {
  product: Product;
  branches: { id: string; name: string }[];
  hiddenBranchIds: Set<string>;
  saving: boolean;
  onClose: () => void;
  onSave: (soldAt: Set<string>) => void;
}) {
  const [soldAt, setSoldAt] = useState<Set<string>>(new Set(branches.filter((b) => !hiddenBranchIds.has(b.id)).map((b) => b.id)));
  const toggle = (id: string) =>
    setSoldAt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Modal
      title={`Dijual di cabang mana? — ${product.name}`}
      onClose={onClose}
      footer={
        <button disabled={saving} onClick={() => onSave(soldAt)} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <p className="text-sm text-neutral-600">
        Hilangkan centang pada cabang yang <strong>tidak menjual</strong> menu ini. Menu akan otomatis tidak muncul di Kasir cabang itu.
      </p>
      <div className="space-y-1">
        {branches.map((b) => (
          <label key={b.id} className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm cursor-pointer hover:bg-neutral-50">
            <input type="checkbox" checked={soldAt.has(b.id)} onChange={() => toggle(b.id)} />
            <Store size={14} className="text-neutral-400" />
            <span>{b.name}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
