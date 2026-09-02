"use client";

import { useEffect, useMemo, useState } from "react";
import { PackageSearch, PackagePlus, AlertTriangle, Loader2, Pencil, History } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";
import type { Product } from "@/lib/types";

/**
 * Kolom stok/HPP (cost_price, track_stock, stock_qty, low_stock_threshold)
 * ditambahkan lewat migration_009 — belum ada di lib/types.ts, jadi
 * diperluas di sini saja supaya file types.ts yang sudah ada tidak perlu
 * disentuh sama sekali.
 */
interface ProductStock extends Product {
  cost_price: number;
  track_stock: boolean;
  stock_qty: number;
  low_stock_threshold: number;
}

interface MovementRow {
  id: string;
  type: string;
  qty_change: number;
  note: string | null;
  created_at: string;
  product_name: string;
}

const TYPE_LABEL: Record<string, string> = {
  restock: "Restock",
  adjustment: "Penyesuaian",
  sale: "Penjualan",
  waste: "Rusak/Waste",
};

export default function StockPage() {
  const [products, setProducts] = useState<ProductStock[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProductStock | null>(null);
  const [restocking, setRestocking] = useState<ProductStock | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const [{ data: prodData }, { data: moveData }] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .order("name", { ascending: true }),
      supabase
        .from("stock_movements")
        .select("id, type, qty_change, note, created_at, products(name)")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    setProducts((prodData as ProductStock[]) ?? []);
    setMovements(
      (moveData ?? []).map((m: any) => ({
        id: m.id,
        type: m.type,
        qty_change: Number(m.qty_change),
        note: m.note,
        created_at: m.created_at,
        product_name: m.products?.name ?? "Produk",
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const tracked = useMemo(() => products.filter((p) => p.track_stock), [products]);
  const lowStock = useMemo(
    () => tracked.filter((p) => p.stock_qty <= p.low_stock_threshold),
    [tracked]
  );
  const inventoryValue = useMemo(
    () => tracked.reduce((s, p) => s + p.stock_qty * p.cost_price, 0),
    [tracked]
  );
  const avgMargin = useMemo(() => {
    const withPrice = products.filter((p) => p.price > 0);
    if (withPrice.length === 0) return 0;
    const total = withPrice.reduce(
      (s, p) => s + ((p.price - p.cost_price) / p.price) * 100,
      0
    );
    return Math.round(total / withPrice.length);
  }, [products]);

  async function saveSettings(p: ProductStock) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({
        cost_price: p.cost_price,
        track_stock: p.track_stock,
        low_stock_threshold: p.low_stock_threshold,
      })
      .eq("id", p.id);
    setSaving(false);
    if (error) {
      alert("Gagal menyimpan: " + error.message);
      return;
    }
    setEditing(null);
    loadAll();
  }

  async function doRestock(p: ProductStock, qty: number, note: string) {
    if (!qty || qty <= 0) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_stock", {
      p_product_id: p.id,
      p_qty_change: qty,
      p_type: "restock",
      p_note: note || "Restock manual",
    });
    setSaving(false);
    if (error) {
      alert("Gagal restock: " + error.message);
      return;
    }
    setRestocking(null);
    loadAll();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data stok...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Stok & HPP</h1>
          <p className="text-sm text-neutral-500">
            Atur HPP (harga pokok) tiap menu, aktifkan pelacakan stok bahan, dan pantau stok menipis.
          </p>
        </div>
        <button onClick={() => setShowHistory(true)} className="btn-outline flex items-center gap-1.5 text-sm">
          <History size={14} /> Riwayat Pergerakan
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="card p-4 border-urgent bg-urgent-light/40 flex items-start gap-3">
          <AlertTriangle className="text-urgent shrink-0 mt-0.5" size={18} />
          <div className="text-sm text-neutral-800">
            <p className="font-semibold">{lowStock.length} menu stoknya menipis atau habis:</p>
            <p className="text-neutral-600 mt-0.5">
              {lowStock.map((p) => `${p.name} (${p.stock_qty})`).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Nilai Inventori (stok × HPP)</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(inventoryValue)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Menu Dilacak Stoknya</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{tracked.length} / {products.length}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Rata-rata Margin Menu</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{avgMargin}%</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th className="p-3 font-medium">Menu</th>
              <th className="p-3 font-medium">Harga Jual</th>
              <th className="p-3 font-medium">HPP</th>
              <th className="p-3 font-medium">Margin</th>
              <th className="p-3 font-medium">Stok</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {products.map((p) => {
              const margin = p.price > 0 ? Math.round(((p.price - p.cost_price) / p.price) * 100) : 0;
              const low = p.track_stock && p.stock_qty <= p.low_stock_threshold;
              return (
                <tr key={p.id}>
                  <td className="p-3 font-medium text-neutral-900">{p.name}</td>
                  <td className="p-3">{formatRupiah(p.price)}</td>
                  <td className="p-3">{formatRupiah(p.cost_price)}</td>
                  <td className="p-3">
                    <span className={cx(margin < 20 ? "text-urgent" : "text-primary-dark", "font-semibold")}>
                      {margin}%
                    </span>
                  </td>
                  <td className="p-3">
                    {p.track_stock ? (
                      <span className={low ? "badge-urgent" : "badge-active"}>{p.stock_qty}</span>
                    ) : (
                      <span className="text-neutral-400 text-xs">Tidak dilacak</span>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {p.track_stock && (
                      <button
                        onClick={() => setRestocking(p)}
                        className="text-primary-dark hover:bg-primary-light rounded-lg p-1.5 mr-1"
                        title="Restock"
                      >
                        <PackagePlus size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(p)}
                      className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5"
                      title="Atur HPP & Stok"
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-neutral-400">
                  Belum ada menu. Tambah menu dulu di halaman Kelola Menu & Stok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <StockSettingsModal
          product={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={saveSettings}
        />
      )}

      {restocking && (
        <RestockModal
          product={restocking}
          saving={saving}
          onClose={() => setRestocking(null)}
          onSubmit={doRestock}
        />
      )}

      {showHistory && (
        <Modal title="Riwayat Pergerakan Stok" onClose={() => setShowHistory(false)} maxWidth="sm:max-w-lg">
          <div className="space-y-2">
            {movements.length === 0 && (
              <p className="text-center text-neutral-400 text-sm py-8">Belum ada pergerakan stok tercatat.</p>
            )}
            {movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm border-b border-neutral-100 pb-2">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 truncate">{m.product_name}</p>
                  <p className="text-xs text-neutral-400">
                    {TYPE_LABEL[m.type] ?? m.type} · {new Date(m.created_at).toLocaleString("id-ID")}
                    {m.note ? ` · ${m.note}` : ""}
                  </p>
                </div>
                <span className={cx("font-semibold shrink-0 ml-2", m.qty_change >= 0 ? "text-primary-dark" : "text-urgent")}>
                  {m.qty_change > 0 ? "+" : ""}{m.qty_change}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function StockSettingsModal({
  product,
  saving,
  onClose,
  onSave,
}: {
  product: ProductStock;
  saving: boolean;
  onClose: () => void;
  onSave: (p: ProductStock) => void;
}) {
  const [costInput, setCostInput] = useState(product.cost_price > 0 ? String(product.cost_price) : "");
  const [trackStock, setTrackStock] = useState(product.track_stock);
  const [thresholdInput, setThresholdInput] = useState(String(product.low_stock_threshold));

  return (
    <Modal
      title={`Atur HPP & Stok — ${product.name}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving}
          onClick={() =>
            onSave({
              ...product,
              cost_price: costInput === "" ? 0 : Number(costInput),
              track_stock: trackStock,
              low_stock_threshold: thresholdInput === "" ? 0 : Number(thresholdInput),
            })
          }
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">HPP (Harga Pokok) per porsi</label>
        <input
          type="text"
          inputMode="numeric"
          value={costInput}
          onChange={(e) => setCostInput(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="Contoh: 8000"
          className="input-field"
        />
        <p className="text-xs text-neutral-400 mt-1">
          Harga jual saat ini: {formatRupiah(product.price)} — dipakai untuk hitung margin & laba kotor di Laporan.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} className="rounded" />
        Lacak stok menu ini (otomatis berkurang tiap terjual)
      </label>

      {trackStock && (
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Batas Stok Menipis</label>
          <input
            type="text"
            inputMode="numeric"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
          <p className="text-xs text-neutral-400 mt-1">
            Muncul peringatan kalau stok ≤ angka ini. Isi stok awal lewat tombol Restock setelah disimpan.
          </p>
        </div>
      )}
    </Modal>
  );
}

function RestockModal({
  product,
  saving,
  onClose,
  onSubmit,
}: {
  product: ProductStock;
  saving: boolean;
  onClose: () => void;
  onSubmit: (p: ProductStock, qty: number, note: string) => void;
}) {
  const [qtyInput, setQtyInput] = useState("");
  const [note, setNote] = useState("");
  const qty = qtyInput === "" ? 0 : Number(qtyInput);

  return (
    <Modal
      title={`Restock — ${product.name}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving || qty <= 0}
          onClick={() => onSubmit(product, qty, note)}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Tambah Stok
        </button>
      }
    >
      <p className="text-sm text-neutral-500">Stok saat ini: <span className="font-semibold text-neutral-900">{product.stock_qty}</span></p>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Jumlah Ditambahkan</label>
        <input
          type="text"
          inputMode="numeric"
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="Contoh: 20"
          className="input-field"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan (opsional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Beli dari supplier A" className="input-field" />
      </div>
    </Modal>
  );
}
