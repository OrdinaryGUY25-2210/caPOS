"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { formatRupiah, cx } from "@/lib/utils";
import type { ChannelPricing, OnlineChannel } from "@/lib/types";
import type { Product } from "@/lib/types";

const CHANNELS: { key: OnlineChannel; label: string; defaultMarkup: number; defaultCommission: number }[] = [
  { key: "gofood", label: "GoFood", defaultMarkup: 20, defaultCommission: 20 },
  { key: "grabfood", label: "GrabFood", defaultMarkup: 20, defaultCommission: 20 },
  { key: "shopeefood", label: "ShopeeFood", defaultMarkup: 15, defaultCommission: 15 },
  { key: "website", label: "Website caPOS", defaultMarkup: 0, defaultCommission: 0 },
];

/**
 * Penyesuaian Harga per Saluran (Channel Price Markup) — Owner/Manager
 * mengatur markup% dan komisi% per produk per kanal. Dipakai oleh
 * get_channel_price()/create_online_order() di phase4_schema.sql supaya
 * harga & komisi selalu dihitung dari tabel ini, bukan input bebas kasir.
 */
export default function ChannelPricingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [pricings, setPricings] = useState<Record<string, ChannelPricing>>({});
  const [activeChannel, setActiveChannel] = useState<OnlineChannel>("gofood");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string>("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) return;
    setTenantId(profile.tenant_id);

    const supabase = createClient();
    const [{ data: prods }, { data: prices }] = await Promise.all([
      supabase.from("products").select("*").eq("tenant_id", profile.tenant_id).eq("is_available", true).order("name"),
      supabase.from("channel_pricings").select("*").eq("tenant_id", profile.tenant_id),
    ]);

    setProducts((prods as Product[]) ?? []);
    const map: Record<string, ChannelPricing> = {};
    ((prices as ChannelPricing[]) ?? []).forEach((p) => {
      map[`${p.product_id}:${p.channel}`] = p;
    });
    setPricings(map);
    setLoading(false);
  }

  function keyFor(productId: string) {
    return `${productId}:${activeChannel}`;
  }

  function getValue(productId: string, field: "markup_pct" | "commission_pct") {
    const existing = pricings[keyFor(productId)];
    if (existing) return existing[field];
    const channelDefault = CHANNELS.find((c) => c.key === activeChannel)!;
    return field === "markup_pct" ? channelDefault.defaultMarkup : channelDefault.defaultCommission;
  }

  function setLocalValue(productId: string, field: "markup_pct" | "commission_pct", value: number) {
    setPricings((prev) => {
      const key = keyFor(productId);
      const current = prev[key] ?? {
        id: "",
        tenant_id: tenantId,
        product_id: productId,
        channel: activeChannel,
        markup_pct: getValue(productId, "markup_pct"),
        commission_pct: getValue(productId, "commission_pct"),
        is_active: true,
        created_at: "",
      };
      return { ...prev, [key]: { ...current, [field]: value } };
    });
  }

  async function save(productId: string) {
    setSavingKey(keyFor(productId));
    const supabase = createClient();
    const markup = getValue(productId, "markup_pct");
    const commission = getValue(productId, "commission_pct");

    const { data, error } = await supabase
      .from("channel_pricings")
      .upsert(
        {
          tenant_id: tenantId,
          product_id: productId,
          channel: activeChannel,
          markup_pct: markup,
          commission_pct: commission,
          is_active: true,
        },
        { onConflict: "product_id,channel" }
      )
      .select()
      .single();

    setSavingKey(null);
    if (error) {
      alert("Gagal menyimpan: " + error.message);
      return;
    }
    setPricings((prev) => ({ ...prev, [keyFor(productId)]: data as ChannelPricing }));
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-neutral-900">Penyesuaian Harga per Kanal</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6">
        Atur markup harga otomatis & komisi platform untuk setiap menu di masing-masing kanal penjualan online.
      </p>

      <div className="flex gap-2 mb-5 overflow-x-auto">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            onClick={() => setActiveChannel(c.key)}
            className={cx(
              "shrink-0 px-4 py-2 rounded-xl text-sm font-medium border",
              activeChannel === c.key ? "bg-primary text-white border-primary" : "bg-white text-neutral-600 border-neutral-200"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-neutral-300" size={28} />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Menu</th>
                <th className="text-right px-4 py-3 font-medium">Harga Dine-in</th>
                <th className="text-right px-4 py-3 font-medium">Markup %</th>
                <th className="text-right px-4 py-3 font-medium">Harga di Kanal</th>
                <th className="text-right px-4 py-3 font-medium">Komisi %</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {products.map((p) => {
                const markup = getValue(p.id, "markup_pct");
                const commission = getValue(p.id, "commission_pct");
                const channelPrice = Math.round(p.price * (1 + markup / 100));
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium text-neutral-900">{p.name}</td>
                    <td className="px-4 py-3 text-right text-neutral-500">{formatRupiah(p.price)}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={markup}
                        onChange={(e) => setLocalValue(p.id, "markup_pct", Number(e.target.value))}
                        className="w-16 text-right border border-neutral-200 rounded-lg px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">{formatRupiah(channelPrice)}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={commission}
                        onChange={(e) => setLocalValue(p.id, "commission_pct", Number(e.target.value))}
                        className="w-16 text-right border border-neutral-200 rounded-lg px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => save(p.id)}
                        disabled={savingKey === keyFor(p.id)}
                        className="text-xs font-medium bg-neutral-900 text-white rounded-lg px-3 py-1.5 flex items-center gap-1 disabled:opacity-50"
                      >
                        {savingKey === keyFor(p.id) ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Simpan
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
