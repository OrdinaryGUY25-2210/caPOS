"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { Search, Plus, Minus, Trash2, Printer, ScanLine } from "lucide-react";
import PosNavbar from "@/components/PosNavbar";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import Modal from "@/components/Modal";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { db } from "@/lib/dexie";
import { formatRupiah, generateInvoiceNumber } from "@/lib/utils";
import type { CartItem, Product } from "@/lib/types";

const CATEGORIES = ["Semua", "Kopi", "Non-Kopi", "Makanan", "Dessert"];

// Dipakai HANYA kalau tenant belum punya menu sama sekali (tenant baru,
// belum sempat isi produk di /dashboard/menu) — supaya layar kasir tidak
// kosong melompong saat pertama kali dicoba.
const FALLBACK_PRODUCTS: Product[] = [
  { id: "p1", tenant_id: "demo", name: "Espresso", price: 18000, category: "Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p2", tenant_id: "demo", name: "Cappuccino", price: 25000, category: "Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p3", tenant_id: "demo", name: "Kopi Susu Gula Aren", price: 22000, category: "Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p4", tenant_id: "demo", name: "Matcha Latte", price: 27000, category: "Non-Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p5", tenant_id: "demo", name: "Chocolate Milk", price: 24000, category: "Non-Kopi", image_url: null, is_available: true, created_at: "" },
  { id: "p6", tenant_id: "demo", name: "Nasi Goreng Kafe", price: 32000, category: "Makanan", image_url: null, is_available: true, created_at: "" },
  { id: "p7", tenant_id: "demo", name: "Croissant", price: 19000, category: "Makanan", image_url: null, is_available: true, created_at: "" },
  { id: "p8", tenant_id: "demo", name: "Tiramisu", price: 28000, category: "Dessert", image_url: null, is_available: true, created_at: "" },
];

export default function PosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [memberCode, setMemberCode] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cashierName, setCashierName] = useState("Kasir");
  const [roleLabel, setRoleLabel] = useState("Kasir");
  const [shiftStartedAt, setShiftStartedAt] = useState<string | null>(null);
  const [session, setSession] = useState<{ tenantId: string; cashierId: string } | null>(null);
  const [cafeSettings, setCafeSettings] = useState({
    name: "Kafe Demo",
    address: "Jl. Contoh No. 1",
    showWifi: true,
    wifiSsid: "KafeDemo-WiFi",
    wifiPassword: "kopi1234",
  });

  useEffect(() => {
    (async () => {
      const { profile, userId } = await getCurrentProfile();
      if (!profile || !userId) return;

      setSession({ tenantId: profile.tenant_id, cashierId: userId });
      setCashierName(profile.full_name || "Kasir");
      setRoleLabel(profile.role === "owner" ? "Owner" : profile.role === "super_admin" ? "Super Admin" : "Kasir");

      const supabase = createClient();

      // Buka shift otomatis (idempotent — kalau sudah ada yang 'open'
      // untuk akun ini, dipakai lagi, tidak bikin baru) supaya navbar bisa
      // tampilkan "Shift dimulai HH:mm" dan tiap transaksi otomatis
      // tertaut ke shift ini lewat checkout_transaction().
      const { data: shiftId } = await supabase.rpc("open_shift", {
        p_tenant_id: profile.tenant_id,
        p_cashier_id: userId,
      });
      if (shiftId) {
        const { data: shiftRow } = await supabase
          .from("shifts")
          .select("opened_at")
          .eq("id", shiftId)
          .single();
        if (shiftRow) setShiftStartedAt(shiftRow.opened_at);
      }

      const cached = await db.products.toArray();
      if (cached.length > 0) setProducts(cached);

      // Muat data kafe (nama/alamat/WiFi) untuk struk.
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, show_wifi_on_receipt, wifi_ssid, wifi_password")
        .eq("id", profile.tenant_id)
        .single();
      if (tenant) {
        setCafeSettings((prev) => ({
          ...prev,
          name: tenant.name,
          showWifi: tenant.show_wifi_on_receipt,
          wifiSsid: tenant.wifi_ssid ?? prev.wifiSsid,
          wifiPassword: tenant.wifi_password ?? prev.wifiPassword,
        }));
      }

      // Coba refresh menu dari Supabase (hanya milik tenant sendiri —
      // RLS juga menegakkan ini, filter di sini murni untuk performa query).
      try {
        const { data } = await supabase
          .from("products")
          .select("*")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_available", true);

        if (data && data.length > 0) {
          setProducts(data as Product[]);
          await db.products.clear();
          await db.products.bulkPut(data as Product[]);
        } else if (cached.length === 0) {
          setProducts(FALLBACK_PRODUCTS);
        }
      } catch {
        // offline — cache lokal (kalau ada) tetap dipakai
        if (cached.length === 0) setProducts(FALLBACK_PRODUCTS);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchCategory = category === "Semua" || p.category === category;
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
      return matchCategory && matchSearch;
    });
  }, [products, search, category]);

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...product, qty: 1 }];
    });
  }

  function updateQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discountAmount = Math.round((subtotal * discountPct) / 100);
  const total = subtotal - discountAmount;

  async function applyMemberCode() {
    if (!memberCode.trim()) return;
    const member = await db.memberships.where("member_code").equals(memberCode.trim().toUpperCase()).first();
    if (member && member.is_active) {
      setDiscountPct(member.discount_percentage);
    } else {
      // Demo fallback: any code starting with MBR gets 10% for preview purposes
      if (memberCode.trim().toUpperCase().startsWith("MBR")) {
        setDiscountPct(10);
      } else {
        alert("Kode member tidak ditemukan atau tidak aktif.");
      }
    }
  }

  async function handleCheckout() {
    if (!session) {
      alert("Sesi tidak ditemukan. Silakan login ulang.");
      return;
    }

    const invoiceNumber = generateInvoiceNumber();
    const isOnline = navigator.onLine;

    // `total` here is only used for the on-screen receipt/UX. It is NEVER
    // sent to the server as the source of truth for how much was charged —
    // see the note below. A tampered client (DevTools, a proxy like Burp
    // Suite, or a modified build) could otherwise submit any total_amount
    // it wants and under-report sales.
    const txPayload = {
      tenant_id: session.tenantId,
      cashier_id: session.cashierId,
      invoice_number: invoiceNumber,
      total_amount: total,
      payment_method: paymentMethod,
      member_id: null,
      items: cart.map((i) => ({ product_id: i.id, qty: i.qty, subtotal: i.price * i.qty })),
      is_offline_sync: !isOnline,
      synced: 0 as const,
      created_at: new Date().toISOString(),
    };

    // Queue locally first — this is what lets checkout keep working
    // even when the "Online" badge in the navbar flips to "Offline".
    // Offline transactions are reconciled by syncPendingTransactions(),
    // which must also call checkout_transaction() (not a raw insert) once
    // back online, so re-priced totals are enforced even for queued sales.
    const localId = await db.pendingTransactions.add(txPayload);

    if (isOnline) {
      try {
        const supabase = createClient();
        // Server recomputes total_amount from products.price and
        // memberships.discount_percentage inside checkout_transaction() —
        // the client only supplies product_id/qty, never a price or total.
        const { error } = await supabase.rpc("checkout_transaction", {
          p_tenant_id: txPayload.tenant_id,
          p_cashier_id: txPayload.cashier_id,
          p_invoice_number: invoiceNumber,
          p_payment_method: paymentMethod,
          p_member_code: memberCode || null,
          p_items: txPayload.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
        });
        if (!error) {
          await db.pendingTransactions.update(localId, { synced: 1 });
        } else {
          console.error("checkout_transaction gagal:", error.message);
        }
      } catch {
        // will be retried by syncPendingTransactions later
      }
    }

    setReceipt({
      cafeName: cafeSettings.name,
      cafeAddress: cafeSettings.address,
      invoiceNumber,
      cashierName,
      items: cart,
      total,
      discount: discountAmount,
      paymentMethod,
      createdAt: txPayload.created_at,
      showWifi: cafeSettings.showWifi,
      wifiSsid: cafeSettings.wifiSsid,
      wifiPassword: cafeSettings.wifiPassword,
      width: "80mm",
    });

    setCart([]);
    setMemberCode("");
    setDiscountPct(0);
    setShowCheckout(false);
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <Suspense fallback={null}>
        <AccessDeniedNotice />
      </Suspense>
      <PosNavbar
        cashierName={cashierName}
        roleLabel={roleLabel}
        shiftStartedAt={shiftStartedAt}
        onLogout={async () => {
          await createClient().auth.signOut();
          window.location.href = "/login";
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Menu area — selalu ambil lebar penuh di HP (cart pindah jadi
            bottom sheet di bawah), baru berdampingan dengan sidebar
            keranjang mulai dari breakpoint lg ke atas. */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 pb-24 lg:pb-4 min-w-0">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu..."
                className="input-field pl-10"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto shrink-0">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={
                    cat === category
                      ? "px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium whitespace-nowrap shrink-0"
                      : "px-4 py-2 rounded-xl bg-white border border-neutral-200 text-neutral-600 text-sm font-medium whitespace-nowrap hover:bg-neutral-100 shrink-0"
                  }
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto pb-4">
            {filtered.map((product) => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                className="card p-3 text-left hover:border-primary hover:shadow-md transition-all active:scale-95"
              >
                <div className="aspect-square rounded-xl bg-neutral-100 mb-2 flex items-center justify-center text-neutral-300 text-3xl overflow-hidden">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    "☕"
                  )}
                </div>
                <p className="text-sm font-semibold text-neutral-900 line-clamp-2">{product.name}</p>
                <p className="text-sm font-bold text-primary mt-1">{formatRupiah(product.price)}</p>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full text-center text-neutral-400 py-10">Menu tidak ditemukan.</p>
            )}
          </div>
        </div>

        {/* Cart sidebar — HANYA dari layar lg ke atas. `shrink-0` + lebar
            eksplisit (bukan w-full) supaya tidak "menang" ruang dari area
            menu di flex row seperti bug sebelumnya. */}
        <div className="hidden lg:flex lg:w-96 shrink-0 bg-white border-l border-neutral-200 flex-col">
          <CartPanel
            cart={cart}
            memberCode={memberCode}
            setMemberCode={setMemberCode}
            applyMemberCode={applyMemberCode}
            updateQty={updateQty}
            removeItem={removeItem}
            subtotal={subtotal}
            discountPct={discountPct}
            discountAmount={discountAmount}
            total={total}
            onCheckout={() => setShowCheckout(true)}
          />
        </div>
      </div>

      {/* Tombol keranjang mengambang — HANYA di bawah lg. Tap untuk buka
          bottom sheet berisi keranjang lengkap, supaya area menu tetap
          dapat ruang penuh di layar sempit. */}
      <button
        onClick={() => setShowCartSheet(true)}
        className="lg:hidden fixed bottom-4 left-4 right-4 z-30 bg-primary hover:bg-primary-dark text-white rounded-2xl shadow-lg px-5 py-3.5 flex items-center justify-between font-semibold"
      >
        <span>Keranjang ({cart.length})</span>
        <span>{formatRupiah(total)}</span>
      </button>

      {/* Cart bottom sheet mobile */}
      {showCartSheet && (
        <Modal title={`Keranjang (${cart.length})`} onClose={() => setShowCartSheet(false)}>
          <CartPanel
            cart={cart}
            memberCode={memberCode}
            setMemberCode={setMemberCode}
            applyMemberCode={applyMemberCode}
            updateQty={updateQty}
            removeItem={removeItem}
            subtotal={subtotal}
            discountPct={discountPct}
            discountAmount={discountAmount}
            total={total}
            onCheckout={() => {
              setShowCartSheet(false);
              setShowCheckout(true);
            }}
            embedded
          />
        </Modal>
      )}

      {/* Checkout modal */}
      {showCheckout && (
        <Modal
          title="Konfirmasi Pembayaran"
          onClose={() => setShowCheckout(false)}
          footer={
            <button onClick={handleCheckout} className="btn-primary w-full">
              Selesaikan Transaksi
            </button>
          }
        >
          <p className="text-2xl font-bold text-primary">{formatRupiah(total)}</p>

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Metode Pembayaran</label>
            <div className="grid grid-cols-3 gap-2">
              {["cash", "qris", "debit"].map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={
                    m === paymentMethod
                      ? "py-2 rounded-xl bg-primary text-white text-sm font-medium uppercase"
                      : "py-2 rounded-xl border border-neutral-200 text-neutral-600 text-sm font-medium uppercase hover:bg-neutral-100"
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Receipt modal */}
      {receipt && (
        <Modal
          title="Struk Transaksi"
          onClose={() => setReceipt(null)}
          maxWidth="sm:max-w-xs"
          footer={
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Printer size={16} /> Cetak Struk
              </button>
              <button onClick={() => setReceipt(null)} className="btn-outline">Tutup</button>
            </div>
          }
        >
          <div className="bg-neutral-100 -m-5 p-4">
            <Receipt data={receipt} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function CartPanel({
  cart,
  memberCode,
  setMemberCode,
  applyMemberCode,
  updateQty,
  removeItem,
  subtotal,
  discountPct,
  discountAmount,
  total,
  onCheckout,
  embedded = false,
}: {
  cart: CartItem[];
  memberCode: string;
  setMemberCode: (v: string) => void;
  applyMemberCode: () => void;
  updateQty: (id: string, delta: number) => void;
  removeItem: (id: string) => void;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  total: number;
  onCheckout: () => void;
  /** true saat dipakai di dalam Modal (bottom sheet mobile) — modal sudah
   * punya header/padding sendiri, jadi header "Keranjang" internal ini
   * disembunyikan supaya tidak dobel. */
  embedded?: boolean;
}) {
  return (
    <>
      {!embedded && (
        <div className="p-4 border-b border-neutral-200 shrink-0">
          <h2 className="font-bold text-neutral-900">Keranjang ({cart.length})</h2>
        </div>
      )}

      <div className={embedded ? "space-y-3" : "flex-1 overflow-y-auto p-4 space-y-3"}>
        {cart.length === 0 && (
          <p className="text-center text-neutral-400 text-sm py-10">Belum ada item dipilih.</p>
        )}
        {cart.map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{item.name}</p>
              <p className="text-xs text-neutral-500">{formatRupiah(item.price)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100">
                <Minus size={12} />
              </button>
              <span className="text-sm font-medium w-5 text-center">{item.qty}</span>
              <button onClick={() => updateQty(item.id, 1)} className="w-7 h-7 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100">
                <Plus size={12} />
              </button>
            </div>
            <button onClick={() => removeItem(item.id)} className="text-neutral-300 hover:text-urgent p-1">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className={embedded ? "space-y-3 pt-4 mt-4 border-t border-neutral-100" : "p-4 border-t border-neutral-200 space-y-3 shrink-0"}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
            <input
              value={memberCode}
              onChange={(e) => setMemberCode(e.target.value)}
              placeholder="Kode Member / Scan QR"
              className="input-field pl-9 text-sm"
            />
          </div>
          <button onClick={applyMemberCode} className="btn-outline text-sm px-3 shrink-0">Pakai</button>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-neutral-500">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          {discountPct > 0 && (
            <div className="flex justify-between text-primary">
              <span>Diskon Member ({discountPct}%)</span>
              <span>-{formatRupiah(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-neutral-900 text-base pt-1">
            <span>Total</span>
            <span>{formatRupiah(total)}</span>
          </div>
        </div>

        <button
          disabled={cart.length === 0}
          onClick={onCheckout}
          className="btn-primary w-full"
        >
          Bayar
        </button>
      </div>
    </>
  );
}
