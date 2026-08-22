"use client";

import { useState } from "react";
import { Plus, Pencil, ImagePlus, X } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import type { Product } from "@/lib/types";

const CATEGORIES = ["Kopi", "Non-Kopi", "Makanan", "Dessert"];

const DEMO_MENU: Product[] = [
  { id: "p1", tenant_id: "demo", name: "Espresso", price: 18000, category: "Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p2", tenant_id: "demo", name: "Cappuccino", price: 25000, category: "Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p6", tenant_id: "demo", name: "Nasi Goreng Kafe", price: 32000, category: "Makanan", image_url: null, is_available: false, created_at: "" },
  { id: "p8", tenant_id: "demo", name: "Tiramisu", price: 28000, category: "Dessert", image_url: null, is_available: true, created_at: "" },
];

export default function MenuPage() {
  const [menu, setMenu] = useState<Product[]>(DEMO_MENU);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);

  function toggleAvailability(id: string) {
    setMenu((prev) => prev.map((m) => (m.id === id ? { ...m, is_available: !m.is_available } : m)));
  }

  function openNew() {
    setEditing({
      id: crypto.randomUUID(),
      tenant_id: "demo",
      name: "",
      price: 0,
      category: "Kopi",
      image_url: null,
      is_available: true,
      created_at: "",
    });
    setShowForm(true);
  }

  function saveProduct(p: Product) {
    setMenu((prev) => {
      const exists = prev.some((m) => m.id === p.id);
      return exists ? prev.map((m) => (m.id === p.id ? p : m)) : [p, ...prev];
    });
    setShowForm(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Kelola Menu & Stok</h1>
          <p className="text-sm text-neutral-500">Tambah, edit foto, dan atur ketersediaan menu</p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Tambah Menu
        </button>
      </div>

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
              onClick={() => toggleAvailability(product.id)}
              className={cx(
                "mt-2 w-full text-xs font-medium py-1.5 rounded-lg transition-colors",
                product.is_available ? "bg-primary-light text-primary-dark" : "bg-neutral-100 text-neutral-400"
              )}
            >
              {product.is_available ? "Tersedia" : "Habis / Nonaktif"}
            </button>
          </div>
        ))}
      </div>

      {showForm && editing && (
        <ProductForm
          product={editing}
          onClose={() => setShowForm(false)}
          onSave={saveProduct}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  onClose,
  onSave,
}: {
  product: Product;
  onClose: () => void;
  onSave: (p: Product) => void;
}) {
  const [form, setForm] = useState(product);
  const [preview, setPreview] = useState<string | null>(product.image_url);

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // In production: crop/resize client-side (e.g. via canvas) before
    // uploading to Supabase Storage, then store the public URL.
    const url = URL.createObjectURL(file);
    setPreview(url);
    setForm({ ...form, image_url: url });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{product.name ? "Edit Menu" : "Tambah Menu"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <label className="aspect-video rounded-xl bg-neutral-100 flex flex-col items-center justify-center text-neutral-400 cursor-pointer overflow-hidden relative">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="preview" className="w-full h-full object-cover" />
          ) : (
            <>
              <ImagePlus size={22} />
              <span className="text-xs mt-1">Upload Foto (crop otomatis)</span>
            </>
          )}
          <input type="file" accept="image/*" onChange={handleImage} className="hidden" />
        </label>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Menu</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Harga</label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Kategori</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-field">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <button onClick={() => onSave(form)} className="btn-primary w-full">Simpan Menu</button>
      </div>
    </div>
  );
}
