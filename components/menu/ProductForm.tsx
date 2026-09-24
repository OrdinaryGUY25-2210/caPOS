"use client";

import { useState } from "react";
import { Loader2, ImagePlus, WifiOff } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { formatNumberWithDots, stripNumberDots } from "@/lib/utils";
import { compressImage } from "@/lib/compressImage";
import type { Product } from "@/lib/types";

/**
 * Menu Management §6 — form tambah/edit produk, dipisah dari
 * app/dashboard/menu/page.tsx (sebelumnya function lokal di file yang
 * sama) supaya bisa dipakai ulang & lebih gampang dites sendiri. Logika
 * kompresi gambar / offline-queue TIDAK diubah, cuma dipindah lokasinya.
 */
export default function ProductForm({
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
  // dikosongkan lalu ditulis manual.
  const [priceInput, setPriceInput] = useState(product.price > 0 ? String(product.price) : "");
  const [preview, setPreview] = useState<string | null>(product.image_url);
  const [uploading, setUploading] = useState(false);
  const [compressInfo, setCompressInfo] = useState<string | null>(null);
  const [pendingImageBlob, setPendingImageBlob] = useState<Blob | undefined>(undefined);

  const parsedPrice = priceInput === "" ? 0 : Number(priceInput);
  const priceValid = priceInput !== "" && !Number.isNaN(parsedPrice) && parsedPrice > 0;

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    setUploading(true);
    setCompressInfo(null);

    const compressedFile = await compressImage(rawFile, {
      maxDimension: 1200,
      quality: 0.82,
      format: "webp",
      maxSizeKB: 180,
    });
    const savedPct = Math.round((1 - compressedFile.size / rawFile.size) * 100);
    if (savedPct > 0) {
      setCompressInfo(
        `Dikompres ${savedPct}% (${(rawFile.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB, ${compressedFile.type === "image/webp" ? "WebP" : "JPEG"})`
      );
    }

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
          value={formatNumberWithDots(priceInput)}
          onChange={(e) => setPriceInput(stripNumberDots(e.target.value))}
          placeholder="Contoh: 20.000"
          className="input-field"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori</label>
        <input
          list="menu-category-suggestions"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          placeholder="Pilih atau ketik kategori baru"
          className="input-field"
        />
        <datalist id="menu-category-suggestions">
          {existingCategories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </Modal>
  );
}
