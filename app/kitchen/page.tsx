"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Wifi, WifiOff, Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { cx } from "@/lib/utils";
import OrderCard from "@/components/kitchen/OrderCard";
import MenuAvailabilityPanel from "@/components/kitchen/MenuAvailabilityPanel";
import type { KitchenStation, OrderWithItems, OrderStatus, Product } from "@/lib/types";
import { printStationTicket } from "@/lib/kitchenPrinter";
import QrOrderAlert from "@/components/pos/QrOrderAlert";
import { useProductAvailabilityChannel } from "@/lib/useProductAvailabilityChannel";
import ConfirmDialog from "@/components/ConfirmDialog";

// Order dianggap "aktif" di KDS selama belum SERVED/COMPLETED/CANCELLED.
// SERVED tetap ditampilkan sebentar (kolom terakhir) supaya dapur tahu
// pesanan sudah keluar, tapi tidak ikut dihitung di badge notifikasi.
const ACTIVE_STATUSES: OrderStatus[] = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];

export default function KitchenDisplayPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("cashier");
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [activeStationCode, setActiveStationCode] = useState<string>("all");
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [cashierNames, setCashierNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  // Sold Out / Menu 86 — daftar produk tenant (untuk panel Kelola
  // Ketersediaan Menu) + status simpan per-id (spinner tombol, cegah
  // double-tap saat jaringan lambat).
  const [products, setProducts] = useState<Product[]>([]);
  const [showAvailabilityPanel, setShowAvailabilityPanel] = useState(false);
  const [savingProductIds, setSavingProductIds] = useState<Set<string>>(new Set());

  const supabase = useMemo(() => createClient(), []);

  const loadOrders = useCallback(
    async (tid: string, bid: string | null) => {
      let query = supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("tenant_id", tid)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: true });
      if (bid) query = query.eq("branch_id", bid);

      const { data, error } = await query;
      if (!error && data) {
        setOrders(data as unknown as OrderWithItems[]);

        // Ambil nama kasir untuk order-order ini (satu query batch,
        // bukan N+1 per card).
        const cashierIds = Array.from(new Set((data as any[]).map((o) => o.cashier_id).filter(Boolean)));
        if (cashierIds.length > 0) {
          const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", cashierIds);
          const map: Record<string, string> = {};
          (profiles ?? []).forEach((p: any) => (map[p.id] = p.full_name || "Kasir"));
          setCashierNames(map);
        }
      }
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      setTenantId(profile.tenant_id);
      setRole(profile.role);

      // Owner/super_admin melihat SEMUA cabang (tidak difilter); manager/
      // cashier terkunci ke cabang penugasannya — sama seperti pola
      // branchContext.tsx dipakai di /dashboard.
      const effectiveBranchId = profile.role === "owner" || profile.role === "super_admin" ? null : profile.branch_id;
      setBranchId(effectiveBranchId);

      const { data: stationRows } = await supabase
        .from("kitchen_stations")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      setStations((stationRows as KitchenStation[]) ?? []);

      // Katalog menu tenant (untuk panel Kelola Ketersediaan Menu / Sold
      // Out) — semua produk, TERMASUK yang sedang is_available=false,
      // supaya dapur bisa lihat & buka kembali item yang sebelumnya
      // ditandai habis, bukan cuma yang masih tersedia.
      const { data: productRows } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .order("name");
      setProducts((productRows as Product[]) ?? []);

      await loadOrders(profile.tenant_id, effectiveBranchId);
    })();
  }, [loadOrders, supabase]);

  // Realtime ketersediaan menu (Migrasi 020) — dengar perubahan
  // `products` tenant ini dari perangkat manapun (POS, KDS lain,
  // /dashboard/menu) supaya panel di sini selalu sinkron; juga dipakai
  // untuk broadcast ke halaman QR Self-Order publik saat toggle dari
  // sini (lihat toggleSoldOut di bawah).
  const { broadcastAvailability } = useProductAvailabilityChannel(tenantId, (payload) => {
    if (payload.eventType === "DELETE") {
      setProducts((prev) => prev.filter((p) => p.id !== payload.old?.id));
      return;
    }
    const row = payload.new as Product;
    if (!row?.id) return;
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === row.id);
      return exists ? prev.map((p) => (p.id === row.id ? { ...p, ...row } : p)) : [...prev, row].sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  async function toggleSoldOut(product: Product) {
    const next = !product.is_available;
    setSavingProductIds((prev) => new Set(prev).add(product.id));
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_available: next } : p)));

    const { error } = await supabase.from("products").update({ is_available: next }).eq("id", product.id);

    setSavingProductIds((prev) => {
      const next = new Set(prev);
      next.delete(product.id);
      return next;
    });

    if (error) {
      // Revert optimistic update kalau server menolak.
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_available: !next } : p)));
      alert("Gagal mengubah status ketersediaan: " + error.message);
      return;
    }

    broadcastAvailability({
      id: product.id,
      name: product.name,
      price: product.price,
      category: product.category,
      image_url: product.image_url,
      is_available: next,
    });
  }

  // Realtime: dengar INSERT/UPDATE di `orders` (order baru masuk, atau
  // status berubah dari perangkat lain — mis. kasir lain membatalkan
  // pesanan). Reload penuh dipakai untuk kesederhanaan & konsistensi
  // (jumlah order aktif per cabang biasanya kecil, jadi cukup murah).
  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`kds-orders-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
        () => loadOrders(tenantId, branchId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => loadOrders(tenantId, branchId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, branchId, loadOrders, supabase]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function advanceStatus(orderId: string, nextStatus: OrderStatus) {
    // Optimistic update supaya tombol terasa responsif; realtime listener
    // di atas akan mengoreksi kalau ternyata RPC ditolak server.
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)));
    const { error } = await supabase.rpc("update_order_status", { p_order_id: orderId, p_new_status: nextStatus });
    if (error) {
      alert("Gagal mengubah status: " + error.message);
      if (tenantId) loadOrders(tenantId, branchId);
    }
  }

  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);

  function cancelOrder(orderId: string) {
    // Item #28 — tahap Confirmation (dialog, bukan window.confirm) dulu;
    // RPC pembatalan baru jalan di ConfirmDialog.onConfirm di bawah, yang
    // otomatis menangani tahap Processing & Success/Error.
    setCancelTargetId(orderId);
  }

  async function reprintOrder(order: OrderWithItems) {
    const relevantStations = stations.filter((s) => order.order_items.some((i) => i.station_id === s.id));
    if (relevantStations.length === 0) {
      alert("Item pesanan ini belum di-assign ke stasiun dapur manapun (atur di Kelola Menu).");
      return;
    }
    for (const station of relevantStations) {
      try {
        await printStationTicket(order, station.id, station.name, cashierNames[order.cashier_id ?? ""] ?? "Kasir", { reprint: true });
      } catch (e: any) {
        alert(`Printer "${station.name}" belum tersambung: ${e.message}`);
      }
    }
  }

  const visibleStations = stations.filter((s) => (branchId ? s.branch_id === branchId : true));

  const filteredOrders = useMemo(() => {
    if (activeStationCode === "all") return orders;
    const station = stations.find((s) => s.code === activeStationCode);
    if (!station) return orders;
    return orders.filter((o) => o.order_items.some((i) => i.station_id === station.id));
  }, [orders, activeStationCode, stations]);

  const columns: { status: OrderStatus; label: string }[] = [
    { status: "NEW", label: "Baru Masuk" },
    { status: "ACCEPTED", label: "Diterima" },
    { status: "PREPARING", label: "Sedang Disiapkan" },
    { status: "READY", label: "Siap Disajikan" },
    { status: "SERVED", label: "Sudah Disajikan" },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-neutral-900">Kitchen Display System</h1>
          {isOnline ? (
            <span className="badge-active"><Wifi size={12} /> Realtime Aktif</span>
          ) : (
            <span className="badge-urgent"><WifiOff size={12} /> Offline</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAvailabilityPanel(true)}
            className="btn-outline text-xs flex items-center gap-1.5 px-3 py-2 relative"
          >
            <Ban size={14} /> Sold Out
            {products.some((p) => !p.is_available) && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-urgent text-white text-[10px] font-bold flex items-center justify-center">
                {products.filter((p) => !p.is_available).length}
              </span>
            )}
          </button>
          <button
            onClick={() => tenantId && loadOrders(tenantId, branchId)}
            className="btn-outline text-xs flex items-center gap-1.5 px-3 py-2"
          >
            <RefreshCw size={14} /> Muat Ulang
          </button>
        </div>
      </header>

      {/* Phase 4 — notifikasi pesanan baru dari QR Self-Order / Online Order Hub */}
      <QrOrderAlert branchId={branchId} />

      {/* Filter stasiun — layar Barista hanya lihat minuman, Koki Dapur hanya makanan, dst */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 bg-white border-b border-neutral-200 shrink-0">
        <button
          onClick={() => setActiveStationCode("all")}
          className={cx(
            "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap shrink-0",
            activeStationCode === "all" ? "bg-primary text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          )}
        >
          Semua Stasiun
        </button>
        {visibleStations.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStationCode(s.code)}
            className={cx(
              "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap shrink-0",
              activeStationCode === s.code ? "bg-primary text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-x-auto p-4">
        {loading ? (
          <p className="text-center text-neutral-400 py-20">Memuat pesanan...</p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-center text-neutral-400 py-20">Tidak ada pesanan aktif saat ini.</p>
        ) : (
          <div className="flex gap-4 min-w-max h-full">
            {columns.map((col) => {
              const colOrders = filteredOrders.filter((o) => o.status === col.status);
              return (
                <div key={col.status} className="w-80 shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm font-bold text-neutral-700 uppercase tracking-wide">{col.label}</h2>
                    <span className="text-xs font-mono text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">{colOrders.length}</span>
                  </div>
                  <div className="space-y-3 overflow-y-auto flex-1 pb-4">
                    {colOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        cashierName={cashierNames[order.cashier_id ?? ""] ?? "Kasir"}
                        onAdvanceStatus={advanceStatus}
                        onCancel={cancelOrder}
                        onReprint={reprintOrder}
                        canReprint /* semua peran yang bisa akses /kitchen boleh reprint tiket */
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showAvailabilityPanel && (
        <MenuAvailabilityPanel
          products={products}
          savingIds={savingProductIds}
          onToggle={toggleSoldOut}
          onClose={() => setShowAvailabilityPanel(false)}
        />
      )}

      {cancelTargetId && (
        <ConfirmDialog
          title="Batalkan Pesanan?"
          description="Tindakan ini tidak bisa diurungkan. Pesanan akan ditandai batal dan hilang dari papan dapur."
          confirmLabel="Ya, Batalkan"
          successMessage="Pesanan dibatalkan."
          onClose={() => setCancelTargetId(null)}
          onConfirm={async () => {
            const { error } = await supabase.rpc("update_order_status", {
              p_order_id: cancelTargetId,
              p_new_status: "CANCELLED",
            });
            if (error) throw new Error(error.message);
            if (tenantId) loadOrders(tenantId, branchId);
          }}
        />
      )}
    </div>
  );
}
