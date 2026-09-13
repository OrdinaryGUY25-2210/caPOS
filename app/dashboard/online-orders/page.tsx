"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Minus, X, Bike } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { formatRupiah, cx } from "@/lib/utils";
import type { OnlineChannel, ChannelCommissionRow } from "@/lib/types";
import type { Product, Order, OrderStatus } from "@/lib/types";

const CHANNEL_LABEL: Record<OnlineChannel, string> = {
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
  website: "Website caPOS",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Baru Masuk",
  ACCEPTED: "Diterima",
  PREPARING: "Disiapkan",
  READY: "Siap Diambil Kurir",
  SERVED: "Diserahkan",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

/**
 * Agregasi Pesanan Multisaluran — kasir/manager input manual pesanan yang
 * masuk dari aplikasi GoFood/GrabFood/ShopeeFood/website (caPOS belum
 * terhubung API resmi tiap platform, jadi tablet merchant masing-masing
 * tetap dipakai untuk MENERIMA order; di sinilah pesanannya dicatat
 * supaya masuk dapur/KDS dan laporan komisi tetap terpusat di caPOS).
 */
export default function OnlineOrdersPage() {
  const { selectedBranchId, branches } = useBranch();
  const [orders, setOrders] = useState<Order[]>([]);
  const [commission, setCommission] = useState<ChannelCommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const effectiveBranchId = selectedBranchId === ALL_BRANCHES ? branches[0]?.id : selectedBranchId;

  useEffect(() => {
    if (!effectiveBranchId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [{ data: ord }, { data: comm }] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("branch_id", effectiveBranchId)
        .neq("channel", "pos")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("channel_commission_report")
        .select("*")
        .eq("branch_id", effectiveBranchId)
        .order("sale_date", { ascending: false })
        .limit(30),
    ]);
    setOrders((ord as Order[]) ?? []);
    setCommission((comm as ChannelCommissionRow[]) ?? []);
    setLoading(false);
  }

  async function advanceStatus(order: Order) {
    const next: Partial<Record<OrderStatus, OrderStatus>> = {
      NEW: "ACCEPTED",
      ACCEPTED: "PREPARING",
      PREPARING: "READY",
      READY: "SERVED",
      SERVED: "COMPLETED",
    };
    const nextStatus = next[order.status];
    if (!nextStatus) return;

    const supabase = createClient();
    const { error } = await supabase.rpc("update_order_status", { p_order_id: order.id, p_new_status: nextStatus });
    if (error) {
      alert(error.message);
      return;
    }
    load();
  }

  const totalCommission = commission.reduce((sum, c) => sum + Number(c.total_commission), 0);
  const totalNet = commission.reduce((sum, c) => sum + Number(c.net_revenue), 0);
  const totalGross = commission.reduce((sum, c) => sum + Number(c.gross_revenue), 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Online Order Hub</h1>
          <p className="text-sm text-neutral-500 mt-1">Pesanan Takeaway &amp; Delivery dari semua kanal, terpusat di sini.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary text-white text-sm font-medium rounded-xl px-4 py-2.5"
        >
          <Plus size={16} /> Input Pesanan Masuk
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Omzet Kotor (30 transaksi terakhir)" value={formatRupiah(totalGross)} />
        <StatCard label="Total Komisi Platform" value={formatRupiah(totalCommission)} tone="urgent" />
        <StatCard label="Pendapatan Bersih" value={formatRupiah(totalNet)} tone="primary" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-neutral-300" size={28} />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-10">Belum ada pesanan online.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                  <Bike size={14} className="text-neutral-400" />
                  {o.order_number} · {CHANNEL_LABEL[o.channel as OnlineChannel] ?? o.channel}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">{o.customer_name ?? "Tanpa nama"}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600">
                  {STATUS_LABEL[o.status]}
                </span>
                {o.status !== "COMPLETED" && o.status !== "CANCELLED" && (
                  <button
                    onClick={() => advanceStatus(o)}
                    className="text-xs font-medium bg-primary text-white rounded-lg px-3 py-1.5"
                  >
                    Proses Selanjutnya
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && effectiveBranchId && (
        <OnlineOrderFormModal branchId={effectiveBranchId} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "primary" | "urgent" }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={cx("text-lg font-bold mt-1", tone === "primary" ? "text-primary" : tone === "urgent" ? "text-urgent" : "text-neutral-900")}>
        {value}
      </p>
    </div>
  );
}

function OnlineOrderFormModal({ branchId, onClose, onSaved }: { branchId: string; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [channel, setChannel] = useState<OnlineChannel>("gofood");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<{ product_id: string; name: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState("");

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      setTenantId(profile.tenant_id);
      const supabase = createClient();
      const { data } = await supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).eq("is_available", true).order("name");
      setProducts((data as Product[]) ?? []);
    })();
  }, []);

  function addItem(p: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === p.id);
      if (existing) return prev.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { product_id: p.id, name: p.name, qty: 1 }];
    });
  }

  function changeQty(index: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], qty: next[index].qty + delta };
      return next.filter((i) => i.qty > 0);
    });
  }

  async function submit() {
    if (cart.length === 0) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_online_order", {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_channel: channel,
      p_customer_name: customerName || null,
      p_notes: notes || null,
      p_items: cart.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    });
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-neutral-900">Input Pesanan Online Masuk</p>
          <button onClick={onClose} className="text-neutral-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          {(Object.keys(CHANNEL_LABEL) as OnlineChannel[]).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={cx(
                "px-3 py-1.5 rounded-lg text-xs font-medium border",
                channel === c ? "bg-primary text-white border-primary" : "bg-white text-neutral-600 border-neutral-200"
              )}
            >
              {CHANNEL_LABEL[c]}
            </button>
          ))}
        </div>

        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nama pelanggan (opsional)"
          className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mb-3"
        />

        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto mb-3 border border-neutral-100 rounded-xl p-2">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => addItem(p)}
              className="text-left text-xs bg-neutral-50 rounded-lg px-2 py-2 hover:bg-neutral-100"
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="space-y-2 mb-3">
          {cart.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{item.name}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => changeQty(i, -1)} className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center">
                  <Minus size={12} />
                </button>
                <span className="w-4 text-center text-xs">{item.qty}</span>
                <button onClick={() => changeQty(i, 1)} className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center">
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan (opsional)"
          rows={2}
          className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm resize-none mb-4"
        />

        <button
          onClick={submit}
          disabled={saving || cart.length === 0}
          className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          Kirim ke Dapur
        </button>
      </div>
    </div>
  );
}
