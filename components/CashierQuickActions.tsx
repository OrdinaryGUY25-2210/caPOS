"use client";

import { useState } from "react";
import { PackagePlus, Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/compressImage";
import { formatNumberWithDots, stripNumberDots } from "@/lib/utils";

const CATEGORIES = ["Kopi", "Non-Kopi", "Makanan", "Dessert"];

/**
 * Satu aksi ringan yang tersedia langsung dari layar kasir (tanpa perlu
 * akses /dashboard sama sekali, sesuai desain "kasir minimalis"):
 * Usulkan Menu Baru — masuk sebagai approval_requests pending, BUKAN
 * langsung masuk tabel products. Manager/Owner yang menyetujui lewat
 * lonceng notifikasi di dashboard.
 */
export default function CashierQuickActions({
  tenantId,
  cashierId,
}: {
  tenantId: string;
  cashierId: string;
}) {
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [menuForm, setMenuForm] = useState({ name: "", price: "", category: "Kopi", image_url: null as string | null });

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const compressed = await compressImage(file, { maxDimension: 1200, quality: 0.8 });
    const supabase = createClient();
    const path = `${tenantId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from("menu-images").upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
    if (!error) {
      const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
      setMenuForm((f) => ({ ...f, image_url: data.publicUrl }));
    }
    setUploading(false);
  }

  async function submitMenuProposal() {
    if (!menuForm.name.trim() || !menuForm.price) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("approval_requests").insert({
      tenant_id: tenantId,
      requested_by: cashierId,
      type: "new_menu",
      payload: {
        name: menuForm.name.trim(),
        price: Number(menuForm.price),
        category: menuForm.category,
        image_url: menuForm.image_url,
      },
    });
    setSaving(false);
    if (error) {
      alert("Gagal mengirim usulan: " + error.message);
      return;
    }
    setMenuForm({ name: "", price: "", category: "Kopi", image_url: null });
    setShowMenuForm(false);
    setSent("Usulan menu baru terkirim, menunggu persetujuan Manager/Owner.");
    setTimeout(() => setSent(null), 5000);
  }

  return (
    <>
      <button onClick={() => setShowMenuForm(true)} className="btn-outline text-xs flex items-center gap-1.5 px-3 py-2">
        <PackagePlus size={14} /> Usulkan Menu
      </button>

      {sent && (
        <div className="fixed bottom-24 left-4 right-4 z-40 bg-neutral-900 text-white text-sm rounded-2xl px-4 py-3 shadow-lg">
          {sent}
        </div>
      )}

      {showMenuForm && (
        <Modal
          title="Usulkan Menu Baru"
          onClose={() => setShowMenuForm(false)}
          footer={
            <button
              disabled={saving || !menuForm.name.trim() || !menuForm.price}
              onClick={submitMenuProposal}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="animate-spin" size={16} />} Kirim untuk Disetujui
            </button>
          }
        >
          <p className="text-xs text-neutral-500 -mt-2">
            Menu baru tidak langsung tampil di kasir — perlu disetujui Manager/Owner dulu.
          </p>
          <label className="aspect-video rounded-xl bg-neutral-100 flex flex-col items-center justify-center text-neutral-400 cursor-pointer overflow-hidden relative">
            {uploading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : menuForm.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={menuForm.image_url} alt="preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs">Upload Foto (opsional)</span>
            )}
            <input type="file" accept="image/*" onChange={handleImage} className="hidden" disabled={uploading} />
          </label>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Menu</label>
            <input value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} className="input-field" maxLength={80} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Harga Usulan</label>
            <input
              type="text"
              inputMode="numeric"
              // Ditampilkan pakai titik ribuan (mis. "20.000") biar nominal
              // gampang dibaca; state `menuForm.price` tetap digit polos.
              value={formatNumberWithDots(menuForm.price)}
              onChange={(e) => setMenuForm({ ...menuForm, price: stripNumberDots(e.target.value) })}
              placeholder="Contoh: 20.000"
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori</label>
            <input
              list="cashier-category-suggestions"
              value={menuForm.category}
              onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })}
              className="input-field"
            />
            <datalist id="cashier-category-suggestions">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </Modal>
      )}
    </>
  );
}
