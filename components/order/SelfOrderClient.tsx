"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ShoppingBag, Plus, Minus, X, Loader2, CheckCircle2, ChefHat, Clock, ArrowLeft, Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, cx } from "@/lib/utils";
import type { QrOrderPageProduct, QrCartItem, QrOrderStatusData, QrPaymentMethod, MenuAvailabilityBroadcast } from "@/lib/types";

type Phase = "menu" | "checkout" | "paying" | "tracking";
type LiveProduct = QrOrderPageProduct & { is_available: boolean };

const STATUS_LABEL: Record<string, string> = {
  NEW: "Menunggu diterima kafe",
  ACCEPTED: "Diterima, segera disiapkan",
  PREPARING: "Sedang disiapkan",
  READY: "Siap disajikan",
  SERVED: "Sudah diantar ke meja",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const STATUS_STEP: Record<string, number> = {
  NEW: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY: 3,
  SERVED: 4,
  COMPLETED: 4,
};

export default function SelfOrderClient({
  branchSlug,
  tableNumber,
  branchName,
  tableCapacity,
  products,
  tenantId,
}: {
  branchSlug: string;
  tableNumber: string;
  branchName: string;
  tableCapacity: number;
  products: QrOrderPageProduct[];
  /** Migrasi 020 — dipakai murni sebagai nama topik broadcast realtime
   * `products-<tenant_id>`, bukan untuk query apa pun ke tabel. */
  tenantId?: string;
}) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [cart, setCart] = useState<QrCartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("Semua");
  const [trackedQrOrderId, setTrackedQrOrderId] = useState<string | null>(null);

  // Katalog menu lokal, mulai dari snapshot server-side (`products`) lalu
  // disinkron real-time (Requirement 1: QR Order langsung memblokir
  // pemesanan item yang baru saja ditandai Sold Out — termasuk untuk
  // pelanggan yang halamannya SUDAH TERBUKA, bukan cuma yang baru scan).
  const [liveProducts, setLiveProducts] = useState<LiveProduct[]>(() =>
    products.map((p) => ({ ...p, is_available: true }))
  );

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClient();
    // Broadcast, BUKAN postgres_changes — halaman ini anon/tanpa login,
    // RLS tabel `products` selalu memblokir baca langsung untuk anon
    // (lihat komentar di migration_020). Kasir/dapur yang mengirim pesan
    // ke topik ini setelah toggle Sold Out berhasil tersimpan.
    const channel = supabase
      .channel(`products-${tenantId}`)
      .on("broadcast", { event: "availability_changed" }, ({ payload }) => {
        const p = payload as MenuAvailabilityBroadcast;
        setLiveProducts((prev) => {
          const exists = prev.some((item) => item.id === p.id);
          if (!exists && !p.is_available) return prev; // tidak pernah tampil, tidak perlu ditambah cuma untuk langsung disembunyikan
          if (!exists) return [...prev, { id: p.id, name: p.name, price: p.price, category: p.category, image_url: p.image_url, is_available: true }];
          return prev.map((item) =>
            item.id === p.id
              ? { ...item, name: p.name, price: p.price, category: p.category, image_url: p.image_url, is_available: p.is_available }
              : item
          );
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const categories = useMemo(() => {
    const set = new Set(liveProducts.map((p) => p.category || "Lainnya"));
    return ["Semua", ...Array.from(set)];
  }, [liveProducts]);

  const visibleProducts = useMemo(
    () => (activeCategory === "Semua" ? liveProducts : liveProducts.filter((p) => (p.category || "Lainnya") === activeCategory)),
    [liveProducts, activeCategory]
  );

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  // Item di keranjang yang baru saja ditandai Sold Out SETELAH sempat
  // ditambahkan (mis. kasir toggle sementara pelanggan masih isi
  // keranjang) — tampilkan peringatan supaya tidak kaget saat submit
  // ditolak server (submit_qr_order juga memvalidasi is_available=true).
  const cartSoldOutIds = useMemo(() => {
    const soldOut = new Set(liveProducts.filter((p) => !p.is_available).map((p) => p.id));
    return new Set(cart.filter((i) => soldOut.has(i.product_id)).map((i) => i.product_id));
  }, [cart, liveProducts]);

  function addToCart(product: LiveProduct) {
    if (!product.is_available) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id && !i.variant_notes);
      if (existing) {
        return prev.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { product_id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }

  function changeQty(index: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const item = next[index];
      const newQty = item.qty + delta;
      if (newQty <= 0) {
        next.splice(index, 1);
      } else {
        next[index] = { ...item, qty: newQty };
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-28">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-bold text-neutral-900 text-sm leading-tight">{branchName}</p>
          <p className="text-xs text-neutral-500">
            Meja {tableNumber} · {tableCapacity} kursi
          </p>
        </div>
        {phase === "menu" && (
          <button
            onClick={() => setCartOpen(true)}
            className="relative bg-primary text-white rounded-full p-2.5"
            aria-label="Keranjang"
          >
            <ShoppingBag size={18} />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-urgent text-white text-[10px] font-bold flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        )}
      </div>

      {phase === "menu" && (
        <>
          {/* Kategori */}
          <div className="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={cx(
                  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border",
                  activeCategory === c
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-neutral-600 border-neutral-200"
                )}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Grid menu */}
          <div className="grid grid-cols-2 gap-3 px-4">
            {visibleProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={!p.is_available}
                className={cx(
                  "bg-white rounded-2xl border overflow-hidden text-left transition-transform",
                  p.is_available ? "border-neutral-200 active:scale-[0.98]" : "border-neutral-200 opacity-60 cursor-default"
                )}
              >
                <div className="aspect-square bg-neutral-100 flex items-center justify-center overflow-hidden relative">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <ChefHat size={28} className="text-neutral-300" />
                  )}
                  {!p.is_available && (
                    <div className="absolute inset-0 bg-neutral-900/60 flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold uppercase tracking-wide bg-neutral-800 px-2 py-1 rounded-full flex items-center gap-1">
                        <Ban size={10} /> Habis
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <p className={cx("text-sm font-semibold leading-tight line-clamp-2", p.is_available ? "text-neutral-900" : "text-neutral-400")}>
                    {p.name}
                  </p>
                  <p className={cx("text-xs font-bold mt-1", p.is_available ? "text-primary" : "text-neutral-400")}>{formatRupiah(p.price)}</p>
                </div>
              </button>
            ))}
            {visibleProducts.length === 0 && (
              <p className="col-span-2 text-center text-sm text-neutral-400 py-10">Menu belum tersedia.</p>
            )}
          </div>

          {/* Tombol keranjang mengambang */}
          {cartCount > 0 && (
            <button
              onClick={() => setCartOpen(true)}
              className="fixed bottom-4 left-4 right-4 bg-primary text-white rounded-2xl py-3.5 px-4 flex items-center justify-between font-semibold shadow-lg shadow-primary/30 z-30"
            >
              <span className="flex items-center gap-2 text-sm">
                <ShoppingBag size={16} /> {cartCount} item
              </span>
              <span className="text-sm">{formatRupiah(cartTotal)}</span>
            </button>
          )}
        </>
      )}

      {cartOpen && (
        <CartSheet
          cart={cart}
          soldOutIds={cartSoldOutIds}
          onClose={() => setCartOpen(false)}
          onChangeQty={changeQty}
          onCheckout={() => {
            setCartOpen(false);
            setPhase("checkout");
          }}
        />
      )}

      {phase === "checkout" && (
        <CheckoutView
          cart={cart}
          total={cartTotal}
          branchSlug={branchSlug}
          tableNumber={tableNumber}
          onBack={() => setPhase("menu")}
          onSubmitted={(id) => {
            setTrackedQrOrderId(id);
            setCart([]);
            setPhase("tracking");
          }}
        />
      )}

      {phase === "tracking" && trackedQrOrderId && <OrderTrackingView qrOrderId={trackedQrOrderId} />}
    </div>
  );
}

function OrderTrackingView({ qrOrderId }: { qrOrderId: string }) {
  const [data, setData] = useState<QrOrderStatusData | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { data: result } = await supabase.rpc("get_qr_order_status", { p_qr_order_id: qrOrderId });
      if (!cancelled) setData(result as QrOrderStatusData);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [qrOrderId]);

  if (!data || data.error) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-neutral-300" size={28} />
      </div>
    );
  }

  const step = STATUS_STEP[data.status ?? "NEW"] ?? 0;
  const steps = ["Diterima", "Diterima Dapur", "Disiapkan", "Siap", "Diantar"];

  return (
    <div className="px-4 py-6">
      <div className="text-center mb-6">
        <CheckCircle2 className="text-primary mx-auto mb-2" size={40} />
        <p className="font-bold text-neutral-900 text-lg">Pesanan {data.order_number} Terkirim!</p>
        <p className="text-sm text-neutral-500 mt-1">{STATUS_LABEL[data.status ?? "NEW"]}</p>
      </div>

      {data.status !== "CANCELLED" && (
        <div className="flex items-center justify-between mb-6 px-2">
          {steps.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center">
              <div
                className={cx(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                  i <= step ? "bg-primary text-white" : "bg-neutral-200 text-neutral-400"
                )}
              >
                {i + 1}
              </div>
              <p className={cx("text-[10px] mt-1 text-center", i <= step ? "text-primary font-medium" : "text-neutral-400")}>
                {label}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-4">
        <p className="font-bold text-neutral-900 mb-3 text-sm flex items-center gap-2">
          <Clock size={14} /> Meja {data.table_number}
        </p>
        <div className="space-y-1.5">
          {(data.items ?? []).map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-neutral-600">
                {item.qty}x {item.product_name}
                {item.variant_notes ? ` (${item.variant_notes})` : ""}
              </span>
              <span className="text-neutral-800 font-medium">{formatRupiah(item.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm font-bold border-t border-neutral-100 mt-3 pt-3">
          <span>Total</span>
          <span className="text-primary">{formatRupiah(data.total_amount ?? 0)}</span>
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          Pembayaran: {data.payment_method === "qris" ? "QRIS" : "Bayar di Kasir"} ·{" "}
          {data.payment_status === "paid" ? "Lunas" : data.payment_status === "pending" ? "Menunggu" : "Belum bayar"}
        </p>
      </div>
    </div>
  );
}

function CartSheet({
  cart,
  soldOutIds,
  onClose,
  onChangeQty,
  onCheckout,
}: {
  cart: QrCartItem[];
  soldOutIds: Set<string>;
  onClose: () => void;
  onChangeQty: (index: number, delta: number) => void;
  onCheckout: () => void;
}) {
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const hasSoldOut = soldOutIds.size > 0;
  return (
    <div className="fixed inset-0 z-40 flex items-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-neutral-100">
          <p className="font-bold text-neutral-900">Keranjang Pesanan</p>
          <button onClick={onClose} className="text-neutral-400 p-1">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 && <p className="text-center text-sm text-neutral-400 py-8">Keranjang masih kosong.</p>}
          {cart.map((item, i) => {
            const soldOut = soldOutIds.has(item.product_id);
            return (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cx("text-sm font-medium truncate", soldOut ? "text-neutral-400 line-through" : "text-neutral-900")}>{item.name}</p>
                  {soldOut ? (
                    <p className="text-xs text-urgent font-medium flex items-center gap-1">
                      <Ban size={10} /> Sedang Sold Out — hapus dari keranjang
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-500">{formatRupiah(item.price)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onChangeQty(i, -1)}
                    className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold">{item.qty}</span>
                  <button
                    onClick={() => onChangeQty(i, 1)}
                    disabled={soldOut}
                    className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {cart.length > 0 && (
          <div className="p-4 border-t border-neutral-100">
            <div className="flex justify-between text-sm mb-3">
              <span className="text-neutral-500">Total</span>
              <span className="font-bold text-neutral-900">{formatRupiah(total)}</span>
            </div>
            <button
              onClick={onCheckout}
              disabled={hasSoldOut}
              className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-50"
            >
              {hasSoldOut ? "Hapus item Sold Out dulu" : "Lanjut ke Pembayaran"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckoutView({
  cart,
  total,
  branchSlug,
  tableNumber,
  onBack,
  onSubmitted,
}: {
  cart: QrCartItem[];
  total: number;
  branchSlug: string;
  tableNumber: string;
  onBack: () => void;
  onSubmitted: (qrOrderId: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<QrPaymentMethod>("pay_at_cashier");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const [qrisImageUrl, setQrisImageUrl] = useState<string | null>(null);

  async function submitOrder() {
    setSubmitting(true);
    setErrorMsg(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("submit_qr_order", {
      p_branch_slug: branchSlug,
      p_table_number: tableNumber,
      p_customer_name: name || null,
      p_customer_phone: phone || null,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
      p_items: cart.map((i) => ({ product_id: i.product_id, qty: i.qty, variant_notes: i.variant_notes ?? null })),
    });

    if (error || !data || data.length === 0) {
      setSubmitting(false);
      setErrorMsg(error?.message ?? "Gagal mengirim pesanan. Silakan coba lagi.");
      return;
    }

    const result = data[0] as { order_id: string; qr_order_id: string; order_number: string; total_amount: number };
    setQrOrderId(result.qr_order_id);

    if (paymentMethod === "qris") {
      // Minta QRIS dinamis dari server (Midtrans) — nominal dihitung
      // ulang di server dari total_amount hasil submit_qr_order, bukan
      // dari state lokal, supaya tidak bisa dimanipulasi dari browser.
      try {
        const res = await fetch("/api/orders/qris-charge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr_order_id: result.qr_order_id }),
        });
        const json = await res.json();
        if (res.ok && json.qr_url) {
          setQrisImageUrl(json.qr_url);
        } else {
          setErrorMsg(json.message ?? "Gagal membuat kode QRIS. Silakan bayar di kasir.");
        }
      } catch {
        setErrorMsg("Gagal membuat kode QRIS. Silakan bayar di kasir.");
      }
    }

    setSubmitting(false);

    if (paymentMethod === "pay_at_cashier") {
      onSubmitted(result.qr_order_id);
    }
  }

  if (qrOrderId && paymentMethod === "qris") {
    return (
      <div className="px-4 py-6">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-neutral-500 mb-4">
          <ArrowLeft size={16} /> Kembali
        </button>
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 text-center">
          <p className="font-bold text-neutral-900 mb-1">Scan QRIS untuk Membayar</p>
          <p className="text-xs text-neutral-500 mb-4">{formatRupiah(total)}</p>
          {qrisImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrisImageUrl} alt="QRIS" className="w-56 h-56 mx-auto rounded-xl border border-neutral-100" />
          ) : (
            <div className="w-56 h-56 mx-auto rounded-xl border border-neutral-100 flex items-center justify-center">
              <Loader2 className="animate-spin text-neutral-300" size={28} />
            </div>
          )}
          {errorMsg && <p className="text-xs text-urgent mt-3">{errorMsg}</p>}
          <p className="text-xs text-neutral-400 mt-4">
            Halaman ini otomatis lanjut begitu pembayaran terkonfirmasi.
          </p>
        </div>
        <QrisPaymentWatcher qrOrderId={qrOrderId} onPaid={() => onSubmitted(qrOrderId)} />
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-neutral-500 mb-4">
        <ArrowLeft size={16} /> Kembali ke Menu
      </button>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-4">
        <p className="font-bold text-neutral-900 mb-3 text-sm">Ringkasan Pesanan</p>
        <div className="space-y-1.5">
          {cart.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-neutral-600">
                {item.qty}x {item.name}
              </span>
              <span className="text-neutral-800 font-medium">{formatRupiah(item.price * item.qty)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm font-bold border-t border-neutral-100 mt-3 pt-3">
          <span>Total</span>
          <span className="text-primary">{formatRupiah(total)}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-neutral-600">Nama (opsional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama Anda"
            className="w-full mt-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-600">No. WhatsApp (opsional)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="08xxxxxxxxxx"
            inputMode="tel"
            className="w-full mt-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-600">Catatan untuk dapur (opsional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Mis. tidak pedas, kursi bayi, dll."
            rows={2}
            className="w-full mt-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm resize-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-6">
        <p className="font-bold text-neutral-900 mb-3 text-sm">Metode Pembayaran</p>
        <div className="space-y-2">
          <button
            onClick={() => setPaymentMethod("qris")}
            className={cx(
              "w-full text-left px-3 py-2.5 rounded-xl border text-sm font-medium",
              paymentMethod === "qris" ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-700"
            )}
          >
            QRIS / E-Wallet (bayar sekarang)
          </button>
          <button
            onClick={() => setPaymentMethod("pay_at_cashier")}
            className={cx(
              "w-full text-left px-3 py-2.5 rounded-xl border text-sm font-medium",
              paymentMethod === "pay_at_cashier"
                ? "border-primary bg-primary-light text-primary"
                : "border-neutral-200 text-neutral-700"
            )}
          >
            Bayar di Kasir
          </button>
        </div>
      </div>

      {errorMsg && <p className="text-xs text-urgent mb-3 text-center">{errorMsg}</p>}

      <button
        onClick={submitOrder}
        disabled={submitting || cart.length === 0}
        className="w-full bg-primary text-white rounded-xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
        Kirim Pesanan · {formatRupiah(total)}
      </button>
    </div>
  );
}

/** Poll status pembayaran QRIS setiap 4 detik, otomatis lanjut kalau sudah "paid". */
function QrisPaymentWatcher({ qrOrderId, onPaid }: { qrOrderId: string; onPaid: () => void }) {
  const paidRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const interval = setInterval(async () => {
      if (paidRef.current) return;
      const { data } = await supabase.rpc("get_qr_order_status", { p_qr_order_id: qrOrderId });
      const status = data as QrOrderStatusData;
      if (status?.payment_status === "paid") {
        paidRef.current = true;
        clearInterval(interval);
        onPaid();
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOrderId]);

  return null;
}
