"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Search, Plus, Minus, Trash2, Printer, ScanLine } from "lucide-react";
import PosNavbar from "@/components/PosNavbar";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import Modal from "@/components/Modal";
import CashierQuickActions from "@/components/CashierQuickActions";
import AccessDeniedNotice from "@/components/AccessDeniedNotice";
import SendToKitchenModal from "@/components/SendToKitchenModal";
import OpenBillPanel from "@/components/pos/OpenBillPanel";
import ShiftModal from "@/components/ShiftModal";
import SoldOutToggle from "@/components/pos/SoldOutToggle";
import { CustomerLoyaltyModal } from "@/components/crm/CustomerLoyaltyModal";
import { UserRound, X as XIcon, Wallet } from "lucide-react";
import { validateAndApplyVoucher } from "@/app/actions/purchasing-loyalty-actions";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { db } from "@/lib/dexie";
import { useProductAvailabilityChannel } from "@/lib/useProductAvailabilityChannel";
import { formatRupiah, generateInvoiceNumber, formatNumberWithDots, stripNumberDots, cx } from "@/lib/utils";
import type { CartItem, KitchenStation, OrderWithItems, Product } from "@/lib/types";

/**
 * Kolom stok (track_stock, stock_qty) ditambahkan lewat migration_009,
 * belum ada di lib/types.ts — diperluas di sini saja (pola yang sama
 * dipakai di app/dashboard/stock/page.tsx) supaya types.ts yang sudah
 * ada tidak perlu disentuh.
 */
interface StockAwareProduct extends Product {
  track_stock?: boolean;
  stock_qty?: number;
  low_stock_threshold?: number;
}

type StockAwareCartItem = StockAwareProduct & { qty: number };

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
  const [products, setProducts] = useState<StockAwareProduct[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<StockAwareCartItem[]>([]);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [memberCode, setMemberCode] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherDiscountPreview, setVoucherDiscountPreview] = useState(0);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; customer_name: string } | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  // Uang diterima (tunai) — dipakai modal Konfirmasi Pembayaran untuk
  // kalkulasi kembalian otomatis + tombol preset (Requirement 2).
  const [cashReceived, setCashReceived] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cashierName, setCashierName] = useState("Kasir");
  const [cashierEmail, setCashierEmail] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState("Kasir");
  const [role, setRole] = useState<string>("cashier");
  const [shiftStartedAt, setShiftStartedAt] = useState<string | null>(null);
  const [session, setSession] = useState<{ tenantId: string; cashierId: string; branchId: string | null } | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  // Phase 2 Update 1 — jalur KDS/meja (create_kitchen_order -> /kitchen -> checkout_order_v2),
  // dijalankan BERDAMPINGAN dengan "Bayar Langsung" (checkout_transaction) lama, bukan menggantinya,
  // supaya kasir tetap punya jalur cepat untuk item yang memang tidak butuh dapur/meja.
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [kitchenStations, setKitchenStations] = useState<KitchenStation[]>([]);
  const [showSendToKitchen, setShowSendToKitchen] = useState(false);
  const [showOpenBills, setShowOpenBills] = useState(false);
  const [cafeSettings, setCafeSettings] = useState({
    name: "Kafe Demo",
    address: "Jl. Contoh No. 1",
    showWifi: true,
    wifiSsid: "KafeDemo-WiFi",
    wifiPassword: "kopi1234",
  });

  // --- Shift Closing Kasir (Blind Z-Report) ---
  // Modal Buka/Tutup Shift (components/ShiftModal.tsx) sudah lama dibuat
  // tapi belum pernah dipasang di halaman manapun — sebelumnya /pos
  // otomatis membuka shift TANPA minta modal awal (RPC lama `open_shift`,
  // lihat di bawah). Sekarang: cek dulu apakah kasir ini SUDAH punya
  // shift 'open'; kalau belum, modal awal (Opening Float) WAJIB diisi
  // lewat ShiftModal sebelum layar kasir bisa dipakai transaksi.
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(true);

  // --- Sold Out / Menu 86 ---
  const [savingProductIds, setSavingProductIds] = useState<Set<string>>(new Set());

  // --- Keyboard shortcuts (F1 Cari Produk, F2 Bayar, F4 Diskon, ESC Batal) ---
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingDiscountFocus, setPendingDiscountFocus] = useState(false);

  useEffect(() => {
    (async () => {
      const { profile, userId } = await getCurrentProfile();
      if (!profile || !userId) return;

      setCashierName(profile.full_name || "Kasir");
      setCashierEmail(profile.email ?? null);
      setRoleLabel(profile.role === "owner" ? "Owner" : profile.role === "super_admin" ? "Super Admin" : profile.role === "manager" ? "Manager" : "Kasir");
      setRole(profile.role);

      const supabase = createClient();

      // Resolusi cabang efektif untuk sesi kasir ini: kasir/manager pakai
      // branch_id penugasan mereka (migration_011); owner yang kebetulan
      // login langsung ke /pos (jarang, tapi mungkin untuk uji coba) di-
      // fallback ke Cabang Utama tenant supaya checkout tetap tahu harus
      // mengurangi stok cabang mana.
      let effectiveBranchId = profile.branch_id;
      if (!effectiveBranchId) {
        const { data: mainBranch } = await supabase
          .from("branches")
          .select("id, name")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_main", true)
          .single();
        effectiveBranchId = mainBranch?.id ?? null;
        if (mainBranch) setBranchName(mainBranch.name);
      } else {
        const { data: branch } = await supabase.from("branches").select("name").eq("id", effectiveBranchId).single();
        if (branch) setBranchName(branch.name);
      }
      setSession({ tenantId: profile.tenant_id, cashierId: userId, branchId: effectiveBranchId });

      // Cek apakah kasir ini SUDAH punya shift 'open' — TIDAK lagi
      // auto-buka shift baru tanpa modal awal (RPC lama `open_shift`
      // dipanggil di sini sebelumnya, defaultnya opening_cash=0, jadi
      // Shift Closing/Z-Report di akhir hari tidak punya modal awal yang
      // benar untuk direkonsiliasi). Kalau belum ada shift terbuka,
      // `showShiftModal` di bawah memaksa kasir mengisi Opening Float
      // lewat ShiftModal (open_shift_v2) SEBELUM bisa mulai transaksi —
      // lihat render <ShiftModal> di akhir file.
      const { data: openShiftRow } = await supabase
        .from("shifts")
        .select("id, opened_at")
        .eq("tenant_id", profile.tenant_id)
        .eq("cashier_id", userId)
        .eq("status", "open")
        .maybeSingle();
      if (openShiftRow) {
        setShiftId(openShiftRow.id as string);
        setShiftStartedAt(openShiftRow.opened_at);
      } else {
        setShowShiftModal(true);
      }
      setShiftLoading(false);

      // Stasiun dapur cabang ini — dipakai SendToKitchenModal untuk cetak
      // tiket per stasiun (Bar/Kitchen/Dessert) begitu order dikirim.
      if (effectiveBranchId) {
        const { data: stationRows } = await supabase
          .from("kitchen_stations")
          .select("*")
          .eq("branch_id", effectiveBranchId)
          .eq("is_active", true)
          .order("sort_order");
        setKitchenStations((stationRows as KitchenStation[]) ?? []);
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
      // CATATAN: filter `is_available=true` SENGAJA dihapus dari sini —
      // kasir sekarang perlu melihat item yang sedang Sold Out juga
      // (ditampilkan abu-abu dengan badge "Habis") supaya bisa langsung
      // ditandai tersedia lagi lewat SoldOutToggle begitu stok datang,
      // bukan menghilang sepenuhnya dari layar seperti sebelumnya.
      try {
        const { data } = await supabase
          .from("products")
          .select("*")
          .eq("tenant_id", profile.tenant_id);

        if (data && data.length > 0) {
          // Sejak migration_011, stok per menu dibaca dari branch_stock
          // (cabang tempat kasir ini bertugas) — BUKAN lagi
          // products.stock_qty (legacy, tidak lagi diperbarui). Kalau
          // sebuah produk track_stock=true tapi belum ada baris
          // branch_stock untuk cabang ini, dianggap stoknya 0 (bukan
          // unlimited) supaya tidak bisa terjual tanpa batas.
          let merged = data as StockAwareProduct[];
          if (effectiveBranchId) {
            const { data: stockRows } = await supabase
              .from("branch_stock")
              .select("product_id, stock_qty, low_stock_threshold")
              .eq("branch_id", effectiveBranchId);
            const stockMap = new Map(
              (stockRows ?? []).map((s: any) => [s.product_id, { qty: Number(s.stock_qty), threshold: Number(s.low_stock_threshold) }])
            );
            merged = merged.map((p) =>
              p.track_stock
                ? { ...p, stock_qty: stockMap.get(p.id)?.qty ?? 0, low_stock_threshold: stockMap.get(p.id)?.threshold ?? p.low_stock_threshold }
                : p
            );
          }
          setProducts(merged);
          await db.products.clear();
          await db.products.bulkPut(merged as Product[]);
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

  // Realtime ketersediaan menu (Migrasi 020) — dengar toggle Sold Out/
  // Menu 86 dari perangkat lain (KDS, kasir lain, /dashboard/menu) dan
  // langsung update grid tanpa reload; `broadcastAvailability` dipakai
  // saat KASIR INI yang toggle, supaya halaman QR Self-Order publik yang
  // tidak kena postgres_changes (RLS) tetap tahu secara instan.
  const { broadcastAvailability } = useProductAvailabilityChannel(session?.tenantId ?? null, (payload) => {
    if (payload.eventType === "DELETE") {
      setProducts((prev) => prev.filter((p) => p.id !== payload.old?.id));
      return;
    }
    const row = payload.new as Product;
    if (!row?.id) return;
    setProducts((prev) => {
      // Merge HANYA kolom dasar `products` (name/price/category/
      // is_available/image_url/track_stock) — stock_qty/low_stock_threshold
      // di state ini hasil gabungan dari branch_stock (lihat fetch di
      // atas), BUKAN kolom asli tabel products, jadi jangan ditimpa oleh
      // payload realtime supaya angka stok cabang tidak "mundur".
      const existing = prev.find((p) => p.id === row.id);
      if (!existing) return [...prev, row as StockAwareProduct];
      return prev.map((p) =>
        p.id === row.id
          ? { ...p, name: row.name, price: row.price, category: row.category, image_url: row.image_url, is_available: row.is_available, track_stock: (row as any).track_stock ?? p.track_stock }
          : p
      );
    });
  });

  async function toggleSoldOut(product: StockAwareProduct) {
    const next = !product.is_available;
    setSavingProductIds((prev) => new Set(prev).add(product.id));
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_available: next } : p)));

    const supabase = createClient();
    const { error } = await supabase.from("products").update({ is_available: next }).eq("id", product.id);

    setSavingProductIds((prev) => {
      const copy = new Set(prev);
      copy.delete(product.id);
      return copy;
    });

    if (error) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_available: !next } : p)));
      showStockNotice("Gagal mengubah status: " + error.message);
      return;
    }

    await db.products.update(product.id, { is_available: next }).catch(() => {});
    broadcastAvailability({
      id: product.id,
      name: product.name,
      price: product.price,
      category: product.category,
      image_url: product.image_url,
      is_available: next,
    });

    // Kalau produk yang barusan ditandai Sold Out sedang ada di keranjang
    // (belum sempat dibayar), kasir perlu tahu — TIDAK otomatis dihapus
    // dari keranjang (mungkin memang sudah disiapkan/dipegang), cukup
    // notifikasi supaya sadar sebelum checkout.
    if (next && cart.some((i) => i.id === product.id)) {
      showStockNotice(`"${product.name}" ditandai Sold Out — masih ada di keranjang, cek sebelum bayar.`);
    }
  }

  // Batas maksimum yang boleh dimasukkan ke keranjang untuk satu produk.
  // Kalau produk ini track_stock=true, batasnya stock_qty (stok HPP yang
  // tersedia); produk yang tidak dilacak stoknya tidak dibatasi di sini.
  function availableStock(product: StockAwareProduct) {
    if (!product.track_stock) return Infinity;
    return Math.max(0, product.stock_qty ?? 0);
  }

  function showStockNotice(message: string) {
    setStockNotice(message);
    setTimeout(() => setStockNotice(null), 3000);
  }

  function addToCart(product: StockAwareProduct) {
    if (!product.is_available) {
      showStockNotice(`"${product.name}" sedang Sold Out.`);
      return;
    }
    const limit = availableStock(product);
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      const currentQty = existing?.qty ?? 0;

      // Perbaikan bug: sebelumnya tidak ada pengecekan sama sekali di sini,
      // jadi kasir bisa terus menambah qty melebihi stock_qty yang
      // tersedia di menu Stok & HPP. Sekarang ditolak begitu qty di
      // keranjang akan melampaui stok, dengan notifikasi ke kasir.
      if (currentQty + 1 > limit) {
        showStockNotice(`Stok "${product.name}" tidak cukup — tersisa ${limit}.`);
        return prev;
      }

      if (existing) {
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...product, qty: 1 }];
    });
  }

  function updateQty(id: string, delta: number) {
    setCart((prev) => {
      if (delta > 0) {
        const item = prev.find((i) => i.id === id);
        if (item) {
          const limit = availableStock(item);
          if (item.qty + delta > limit) {
            showStockNotice(`Stok "${item.name}" tidak cukup — tersisa ${limit}.`);
            return prev;
          }
        }
      }
      return prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0);
    });
  }

  // Phase 2A.2 §10 — cashier can type an exact quantity instead of tapping
  // +/- one at a time (e.g. "12x Es Teh" for a big order). Same stock-limit
  // guard as the +/- buttons; not a new business rule, just a faster way to
  // reach the same state updateQty already allows one tap at a time.
  function setQtyDirect(id: string, qty: number) {
    setCart((prev) => {
      const item = prev.find((i) => i.id === id);
      if (!item) return prev;
      if (!Number.isFinite(qty) || qty <= 0) {
        return prev.filter((i) => i.id !== id);
      }
      const limit = availableStock(item);
      if (qty > limit) {
        showStockNotice(`Stok "${item.name}" tidak cukup — tersisa ${limit}.`);
        return prev.map((i) => (i.id === id ? { ...i, qty: limit } : i));
      }
      return prev.map((i) => (i.id === id ? { ...i, qty } : i));
    });
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const memberDiscountAmount = Math.round((subtotal * discountPct) / 100);
  // Preview saja (dari validateAndApplyVoucher, dipanggil terhadap subtotal
  // yang sama dipakai server) — total yang benar-benar ditagih tetap
  // dihitung ulang oleh checkout_transaction() saat submit. Kalau preview
  // dan hasil server beda (mis. voucher habis di detik terakhir), struk
  // yang dicetak di sini bisa saja tidak 100% match — kasir akan lihat
  // error dari server sebelum itu terjadi (lihat handleCheckout).
  const discountAmount = memberDiscountAmount + voucherDiscountPreview;
  const total = Math.max(0, subtotal - discountAmount);

  async function applyVoucherCode() {
    setVoucherError(null);
    if (!voucherCode.trim()) {
      setVoucherDiscountPreview(0);
      return;
    }
    const result = await validateAndApplyVoucher(voucherCode.trim().toUpperCase(), subtotal);
    if (result.error || !result.data) {
      setVoucherError(result.error ?? "Voucher tidak valid");
      setVoucherDiscountPreview(0);
      return;
    }
    setVoucherDiscountPreview(result.data.discount);
  }

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

    // Tunai: pastikan uang diterima cukup sebelum lanjut — tombol
    // "Selesaikan Transaksi" sudah di-disable untuk kasus ini juga, cek
    // di sini murni jaring pengaman kedua.
    if (paymentMethod === "cash" && (!cashReceived || Number(cashReceived) < total)) {
      alert("Uang diterima belum cukup / belum diisi.");
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
      branch_id: session.branchId,
      invoice_number: invoiceNumber,
      total_amount: total,
      payment_method: paymentMethod,
      member_id: null,
      items: cart.map((i) => ({ product_id: i.id, qty: i.qty, subtotal: i.price * i.qty })),
      is_offline_sync: !isOnline,
      synced: 0 as const,
      created_at: new Date().toISOString(),
      // Pelanggan/voucher hanya bisa diproses saat online (checkout_transaction
      // butuh validasi server-side real-time terhadap sisa kuota voucher, dsb).
      // Kalau offline, transaksi tetap masuk antrian TANPA keduanya — kasir
      // sudah diberi tahu (lihat alert di bawah) supaya tidak salah kira
      // poin/voucher sudah diterapkan.
      customer_id: selectedCustomer?.id ?? null,
      voucher_code: voucherCode.trim() || null,
    };

    if (!isOnline && (selectedCustomer || voucherCode.trim())) {
      alert(
        "Sedang offline: transaksi tetap tersimpan, tapi poin loyalitas dan voucher TIDAK akan diterapkan (butuh koneksi untuk validasi server). Lanjutkan checkout, lalu terapkan voucher/poin manual setelah online kembali kalau perlu."
      );
    }

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
          p_branch_id: session.branchId,
          p_customer_id: selectedCustomer?.id ?? null,
          p_voucher_code: voucherCode.trim() || null,
        });
        if (!error) {
          await db.pendingTransactions.update(localId, { synced: 1 });
        } else if (error.message.includes("STOCK_INSUFFICIENT")) {
          // Ini BUKAN kegagalan jaringan (kita sedang online) — server
          // menolak karena stok memang sudah tidak cukup di saat checkout
          // benar-benar diproses (mis. kasir lain di cabang sama baru
          // saja menghabiskannya). Batalkan alur struk sepenuhnya di sini
          // supaya tidak ada struk tercetak untuk transaksi yang server
          // TOLAK — ini bagian inti dari perbaikan "kasir bisa menjual
          // melebihi stok".
          await db.pendingTransactions.delete(localId);
          alert(error.message.replace(/^STOCK_INSUFFICIENT:\s*/, ""));
          return;
        } else {
          // Server MENOLAK checkout_transaction() untuk alasan lain
          // (voucher tidak valid, kode member kedaluwarsa, pelanggan
          // tidak ditemukan, dll — lihat RAISE EXCEPTION di migration_017).
          // Ini bukan kegagalan jaringan (kita online dan dapat respons),
          // jadi tidak akan pernah berhasil di-retry oleh
          // syncPendingTransactions(). Perlakukan sama seperti
          // STOCK_INSUFFICIENT: batalkan antrean lokal dan JANGAN cetak
          // struk untuk transaksi yang server tolak — sebelumnya alur ini
          // hanya console.error lalu tetap lanjut ke setReceipt(), yang
          // membuat kasir melihat struk "berhasil" untuk transaksi yang
          // sebenarnya tidak pernah tersimpan di server.
          console.error("checkout_transaction gagal:", error.message);
          await db.pendingTransactions.delete(localId);
          alert(
            "Transaksi tidak dapat diproses: " +
              error.message.replace(/^STOCK_INSUFFICIENT:\s*/, "") +
              "\nStruk tidak dicetak. Periksa voucher/member/pelanggan lalu coba lagi."
          );
          return;
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
      // Uang diterima/kembalian (tunai) — kosong untuk metode lain.
      cashReceived: paymentMethod === "cash" ? Number(cashReceived) : undefined,
      changeDue: paymentMethod === "cash" ? Number(cashReceived) - total : undefined,
    });

    setCart([]);
    setMemberCode("");
    setDiscountPct(0);
    setVoucherCode("");
    setVoucherDiscountPreview(0);
    setVoucherError(null);
    setSelectedCustomer(null);
    setCashReceived("");
    setShowCheckout(false);
  }

  // Dipanggil begitu OpenBillPanel berhasil membayar sebuah order KDS
  // lewat checkout_order_v2 — tampilkan struk yang sama dengan jalur
  // Bayar Langsung, dari data order (bukan dari cart, karena cart di
  // layar ini tidak dipakai untuk order yang sudah dikirim ke dapur).
  function handleOpenBillPaid(_transactionId: string, order: OrderWithItems) {
    setShowOpenBills(false);
    const total = order.order_items.reduce((sum, i) => sum + i.subtotal, 0);
    setReceipt({
      cafeName: cafeSettings.name,
      cafeAddress: cafeSettings.address,
      invoiceNumber: order.order_number,
      cashierName,
      items: order.order_items.map((i) => ({ id: i.id, name: i.product_name, price: i.unit_price, qty: i.qty })) as unknown as ReceiptData["items"],
      total,
      discount: 0,
      paymentMethod: "lihat rincian di kasir",
      createdAt: new Date().toISOString(),
      showWifi: cafeSettings.showWifi,
      wifiSsid: cafeSettings.wifiSsid,
      wifiPassword: cafeSettings.wifiPassword,
      width: "80mm",
    });
  }

  // Fokus otomatis ke input diskon (voucher/member) di CartPanel setelah
  // bottom sheet mobile selesai terbuka (F4 di HP: buka sheet dulu, baru
  // input-nya ada di DOM) — lihat pemicu di listener keydown di bawah.
  useEffect(() => {
    if (!pendingDiscountFocus) return;
    const id = setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-discount-input]");
      for (const el of Array.from(inputs)) {
        if (el.offsetParent !== null) {
          el.focus();
          break;
        }
      }
      setPendingDiscountFocus(false);
    }, 50);
    return () => clearTimeout(id);
  }, [pendingDiscountFocus, showCartSheet]);

  // --- Keyboard Shortcuts (Requirement 2) ---
  // F1 = Cari Produk, F2 = Bayar/Checkout, F4 = Diskon, ESC = Batal/Tutup
  // Modal. Dipasang sebagai listener global (bukan per-elemen) supaya
  // aktif dari mana pun fokus sedang berada di layar kasir — penting
  // untuk alur cepat saat jam sibuk, kasir tidak perlu klik dulu.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F1") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === "F2") {
        e.preventDefault();
        if (cart.length === 0) {
          showStockNotice("Keranjang masih kosong — tidak ada yang bisa dibayar.");
          return;
        }
        setShowCartSheet(false);
        setShowCheckout(true);
        return;
      }

      if (e.key === "F4") {
        e.preventDefault();
        const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
        if (isDesktop) {
          document.querySelector<HTMLInputElement>("[data-discount-input]")?.focus();
        } else {
          setShowCartSheet(true);
          setPendingDiscountFocus(true);
        }
        return;
      }

      if (e.key === "Escape") {
        // Tutup modal yang sedang terbuka, dari yang paling "atas" —
        // kalau tidak ada modal terbuka, ESC tidak melakukan apa-apa.
        if (receipt) return setReceipt(null);
        if (showCustomerModal) return setShowCustomerModal(false);
        if (showOpenBills) return setShowOpenBills(false);
        if (showSendToKitchen) return setShowSendToKitchen(false);
        if (showCheckout) return setShowCheckout(false);
        if (showShiftModal && shiftId) return setShowShiftModal(false); // hanya kalau BUKAN wajib buka shift
        if (showCartSheet) return setShowCartSheet(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cart.length, receipt, showCustomerModal, showOpenBills, showSendToKitchen, showCheckout, showCartSheet, showShiftModal, shiftId]);

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <Suspense fallback={null}>
        <AccessDeniedNotice />
      </Suspense>
      <PosNavbar
        cashierName={cashierName}
        roleLabel={roleLabel}
        email={cashierEmail}
        cafeName={cafeSettings.name}
        branchName={branchName}
        branchId={session?.branchId ?? null}
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
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu... (F1)"
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
            {session && (
              <button onClick={() => setShowOpenBills(true)} className="btn-outline text-sm px-3 shrink-0 whitespace-nowrap">
                Meja &amp; Bill Terbuka
              </button>
            )}
            {/* Kas & Shift — buka ShiftModal (Cash In/Out/Tutup Shift) kapan
                saja di tengah hari, bukan cuma paksaan di awal shift. */}
            {session && shiftId && (
              <button
                onClick={() => setShowShiftModal(true)}
                className="btn-outline text-sm px-3 shrink-0 whitespace-nowrap flex items-center gap-1.5"
              >
                <Wallet size={14} /> Kas &amp; Shift
              </button>
            )}
            {/* Cuma kasir yang lihat tombol ini — owner/manager sudah punya
                akses penuh lewat Dashboard, tidak perlu jalur usulan. */}
            {role === "cashier" && session && (
              <CashierQuickActions tenantId={session.tenantId} cashierId={session.cashierId} />
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto pb-4">
            {filtered.map((product) => {
              const outOfStock = product.track_stock && (product.stock_qty ?? 0) <= 0;
              const soldOut = !product.is_available;
              const blocked = outOfStock || soldOut;
              return (
                <div
                  key={product.id}
                  role="button"
                  tabIndex={blocked ? -1 : 0}
                  onClick={() => !blocked && addToCart(product)}
                  onKeyDown={(e) => {
                    if (!blocked && (e.key === "Enter" || e.key === " ")) addToCart(product);
                  }}
                  className={cx(
                    "card p-3 text-left transition-all relative",
                    blocked
                      ? "opacity-60 cursor-default"
                      : "hover:border-primary hover:shadow-md active:scale-95 cursor-pointer"
                  )}
                >
                  {/* Sold Out / Menu 86 quick-toggle (Requirement 1) — elemen
                      <button> TERPISAH dari card (yang sendiri bukan <button>
                      lagi, supaya tombol ini valid & tidak ikut memicu
                      addToCart lewat bubbling; stopPropagation tetap dijaga
                      di SoldOutToggle sendiri sebagai lapis kedua). */}
                  <SoldOutToggle
                    isAvailable={product.is_available}
                    saving={savingProductIds.has(product.id)}
                    onToggle={() => toggleSoldOut(product)}
                    size="sm"
                    className="absolute top-1.5 left-1.5 z-10"
                  />

                  <div className="aspect-square rounded-xl bg-neutral-100 mb-2 flex items-center justify-center text-neutral-300 text-3xl overflow-hidden relative">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      "☕"
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 bg-neutral-900/60 flex items-center justify-center">
                        <span className="text-white text-xs font-bold uppercase tracking-wide bg-urgent px-2 py-1 rounded-full">Sold Out</span>
                      </div>
                    )}
                    {/* Sisa stok — hanya untuk produk yang dilacak stoknya
                        di menu Stok & HPP, supaya kasir tahu batasnya sebelum
                        mencoba menambah lebih dari yang tersedia. */}
                    {!soldOut && product.track_stock && (
                      <span
                        className={
                          outOfStock
                            ? "badge-urgent absolute top-1.5 right-1.5"
                            : (product.stock_qty ?? 0) <= (product.low_stock_threshold ?? 5)
                            ? "badge-urgent absolute top-1.5 right-1.5"
                            : "badge-active absolute top-1.5 right-1.5"
                        }
                      >
                        {outOfStock ? "Habis" : `Stok ${product.stock_qty}`}
                      </span>
                    )}
                  </div>
                  <p className={cx("text-sm font-semibold line-clamp-2", soldOut ? "text-neutral-400" : "text-neutral-900")}>{product.name}</p>
                  <p className={cx("text-sm font-bold mt-1", soldOut ? "text-neutral-400" : "text-primary")}>{formatRupiah(product.price)}</p>
                </div>
              );
            })}
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
            voucherCode={voucherCode}
            setVoucherCode={setVoucherCode}
            applyVoucherCode={applyVoucherCode}
            voucherError={voucherError}
            voucherDiscountPreview={voucherDiscountPreview}
            selectedCustomer={selectedCustomer}
            onOpenCustomerModal={() => setShowCustomerModal(true)}
            onClearCustomer={() => setSelectedCustomer(null)}
            updateQty={updateQty}
            setQty={setQtyDirect}
            removeItem={removeItem}
            subtotal={subtotal}
            discountPct={discountPct}
            discountAmount={discountAmount}
            total={total}
            onCheckout={() => setShowCheckout(true)}
            onSendToKitchen={() => setShowSendToKitchen(true)}
          />
        </div>
      </div>

      {/* Notifikasi stok tidak cukup — muncul saat kasir mencoba menambah
          qty melebihi stock_qty yang tersedia di menu Stok & HPP. */}
      {stockNotice && (
        <div className="fixed bottom-24 lg:bottom-4 left-4 right-4 lg:left-auto lg:right-[26rem] z-40 bg-neutral-900 text-white text-sm rounded-2xl px-4 py-3 shadow-lg">
          {stockNotice}
        </div>
      )}

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
            voucherCode={voucherCode}
            setVoucherCode={setVoucherCode}
            applyVoucherCode={applyVoucherCode}
            voucherError={voucherError}
            voucherDiscountPreview={voucherDiscountPreview}
            selectedCustomer={selectedCustomer}
            onOpenCustomerModal={() => setShowCustomerModal(true)}
            onClearCustomer={() => setSelectedCustomer(null)}
            updateQty={updateQty}
            setQty={setQtyDirect}
            removeItem={removeItem}
            subtotal={subtotal}
            discountPct={discountPct}
            discountAmount={discountAmount}
            total={total}
            onCheckout={() => {
              setShowCartSheet(false);
              setShowCheckout(true);
            }}
            onSendToKitchen={() => {
              setShowCartSheet(false);
              setShowSendToKitchen(true);
            }}
            embedded
          />
        </Modal>
      )}

      {/* Checkout modal */}
      {showCheckout && (() => {
        const received = Number(cashReceived) || 0;
        const change = received - total;
        const cashInsufficient = paymentMethod === "cash" && (!cashReceived || received < total);
        return (
          <Modal
            title="Konfirmasi Pembayaran"
            onClose={() => setShowCheckout(false)}
            footer={
              <button disabled={cashInsufficient} onClick={handleCheckout} className="btn-primary w-full disabled:opacity-50">
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
                    onClick={() => {
                      setPaymentMethod(m);
                      if (m !== "cash") setCashReceived("");
                    }}
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

            {/* Quick Cash Buttons — kalkulasi kembalian otomatis (Requirement 2) */}
            {paymentMethod === "cash" && (
              <div className="space-y-2 pt-1">
                <label className="text-sm font-medium text-neutral-700 block">Uang Diterima</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={formatNumberWithDots(cashReceived)}
                  onChange={(e) => setCashReceived(stripNumberDots(e.target.value))}
                  placeholder="Contoh: 100.000"
                  className="input-field text-lg font-semibold"
                />
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Uang Pas", value: total },
                    { label: "Rp 20rb", value: 20000 },
                    { label: "Rp 50rb", value: 50000 },
                    { label: "Rp 100rb", value: 100000 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setCashReceived(String(preset.value))}
                      className={cx(
                        "py-2 rounded-xl border text-xs font-semibold transition-colors",
                        Number(cashReceived) === preset.value
                          ? "bg-primary border-primary text-white"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {cashReceived && (
                  <p className={cx("text-sm font-semibold text-right", change < 0 ? "text-urgent" : "text-emerald-600")}>
                    {change < 0 ? `Kurang ${formatRupiah(-change)}` : `Kembalian: ${formatRupiah(change)}`}
                  </p>
                )}
              </div>
            )}
          </Modal>
        );
      })()}

      {/* Kirim ke Dapur — jalur KDS/meja (Phase 2 Update 1) */}
      {showSendToKitchen && session && shiftId && (
        <SendToKitchenModal
          tenantId={session.tenantId}
          branchId={session.branchId}
          shiftId={shiftId}
          cashierId={session.cashierId}
          cashierName={cashierName}
          cart={cart.map((i) => ({ product_id: i.id, name: i.name, qty: i.qty }))}
          stations={kitchenStations}
          onClose={() => setShowSendToKitchen(false)}
          onSent={() => {
            setShowSendToKitchen(false);
            setCart([]);
            setShowCartSheet(false);
          }}
        />
      )}

      {/* Meja & Bill Terbuka (Phase 2 Update 1) */}
      {showOpenBills && (
        <OpenBillPanel branchId={session?.branchId ?? null} cashierName={cashierName} role={role} onClose={() => setShowOpenBills(false)} onPaid={handleOpenBillPaid} />
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

      {/* Cari/pilih pelanggan untuk transaksi ini — poin loyalitas hanya
          dihitung server-side (lihat checkout_transaction, migration_017)
          kalau ada customer_id yang terpasang di sini. */}
      <CustomerLoyaltyModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        transactionAmount={total}
        onSelectCustomer={(customer) => {
          setSelectedCustomer({ id: customer.id, customer_name: customer.customer_name });
          setShowCustomerModal(false);
        }}
      />

      {/* Buka Shift (wajib, modal awal) & Manajemen Kas Shift (Requirement 3) —
          shiftId null berarti kasir ini BELUM punya shift 'open', modal
          tampil sebagai form Opening Cash yang wajib diisi (onClose no-op,
          tidak bisa ditutup paksa) sebelum layar kasir bisa dipakai. Kalau
          shiftId sudah ada, modal ini juga dipakai untuk Cash In/Out dan
          Blind Closing (Z-Report) lewat tombol "Kas & Shift" di atas. */}
      {session && shiftLoading === false && (showShiftModal || !shiftId) && (
        <ShiftModal
          tenantId={session.tenantId}
          branchId={session.branchId}
          cashierId={session.cashierId}
          shiftId={shiftId}
          onOpened={(id, openedAt) => {
            setShiftId(id);
            setShiftStartedAt(openedAt);
            setShowShiftModal(false);
          }}
          onClosed={() => {
            // Shift baru saja ditutup (Z-Report sudah ditampilkan & di-
            // acknowledge kasir) — kembalikan layar ke status "belum ada
            // shift", memaksa Opening Float baru diisi sebelum transaksi
            // berikutnya (giliran shift baru, kasir sama atau berikutnya).
            setShiftId(null);
            setShiftStartedAt(null);
            setShowShiftModal(false);
          }}
          onClose={() => setShowShiftModal(false)}
        />
      )}
    </div>
  );
}

function CartPanel({
  cart,
  memberCode,
  setMemberCode,
  applyMemberCode,
  voucherCode,
  setVoucherCode,
  applyVoucherCode,
  voucherError,
  voucherDiscountPreview,
  selectedCustomer,
  onOpenCustomerModal,
  onClearCustomer,
  updateQty,
  setQty,
  removeItem,
  subtotal,
  discountPct,
  discountAmount,
  total,
  onCheckout,
  onSendToKitchen,
  embedded = false,
}: {
  cart: CartItem[];
  memberCode: string;
  setMemberCode: (v: string) => void;
  applyMemberCode: () => void;
  voucherCode: string;
  setVoucherCode: (v: string) => void;
  applyVoucherCode: () => void;
  voucherError: string | null;
  voucherDiscountPreview: number;
  selectedCustomer: { id: string; customer_name: string } | null;
  onOpenCustomerModal: () => void;
  onClearCustomer: () => void;
  updateQty: (id: string, delta: number) => void;
  setQty: (id: string, qty: number) => void;
  removeItem: (id: string) => void;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  total: number;
  onCheckout: () => void;
  onSendToKitchen: () => void;
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
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={item.qty}
                onChange={(e) => setQty(item.id, parseInt(e.target.value, 10))}
                onFocus={(e) => e.target.select()}
                aria-label={`Jumlah ${item.name}`}
                className="text-sm font-medium w-9 text-center bg-transparent border-b border-transparent focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
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
              // Dipakai shortcut keyboard F4 (Diskon) untuk auto-focus ke
              // sini — lihat listener F4 di komponen utama PosPage.
              data-discount-input
            />
          </div>
          <button onClick={applyMemberCode} className="btn-outline text-sm px-3 shrink-0">Pakai</button>
        </div>

        <div className="flex gap-2">
          <input
            value={voucherCode}
            onChange={(e) => setVoucherCode(e.target.value)}
            placeholder="Kode Voucher"
            className="input-field flex-1 text-sm"
          />
          <button onClick={applyVoucherCode} className="btn-outline text-sm px-3 shrink-0">Cek</button>
        </div>
        {voucherError && <p className="text-xs text-urgent -mt-2">{voucherError}</p>}

        <button
          onClick={onOpenCustomerModal}
          className="w-full flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          <span className="flex items-center gap-2 text-neutral-700">
            <UserRound size={15} />
            {selectedCustomer ? selectedCustomer.customer_name : "Pelanggan / Poin Loyalitas"}
          </span>
          {selectedCustomer ? (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearCustomer();
              }}
              className="text-neutral-400 hover:text-urgent"
            >
              <XIcon size={14} />
            </span>
          ) : (
            <span className="text-primary text-xs font-medium">Pilih</span>
          )}
        </button>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-neutral-500">
            <span>Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          {discountPct > 0 && (
            <div className="flex justify-between text-primary">
              <span>Diskon Member ({discountPct}%)</span>
              <span>-{formatRupiah((subtotal * discountPct) / 100)}</span>
            </div>
          )}
          {voucherDiscountPreview > 0 && (
            <div className="flex justify-between text-primary">
              <span>Diskon Voucher</span>
              <span>-{formatRupiah(voucherDiscountPreview)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-neutral-900 text-base pt-1">
            <span>Total</span>
            <span>{formatRupiah(total)}</span>
          </div>
        </div>

        {/* Jalur utama F&B (Phase 2): kirim ke dapur dulu, lalu bayar
            begitu siap/disajikan lewat "Meja & Bill Terbuka". */}
        <button
          disabled={cart.length === 0}
          onClick={onSendToKitchen}
          className="btn-primary w-full"
        >
          Kirim ke Dapur
        </button>
        {/* Jalur cepat lama — dipertahankan untuk item yang memang tidak
            butuh dapur/meja (mis. air mineral kemasan, retail rak). Tidak
            membuat order KDS/tidak mengisi meja. */}
        <button
          disabled={cart.length === 0}
          onClick={onCheckout}
          className="btn-outline w-full text-sm"
        >
          Bayar Langsung (tanpa dapur)
        </button>
      </div>
    </>
  );
}
