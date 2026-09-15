"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, Tag, Ticket } from "lucide-react";
import { PromotionBuilder } from "@/components/crm/CustomerLoyaltyModal";
import { getPromotions, togglePromotionActive } from "@/app/actions/purchasing-loyalty-actions";

interface PromoRow {
  id: string;
  promo_name: string;
  promo_type: "PERCENTAGE" | "NOMINAL" | "BOGO" | "BUNDLE";
  discount_value?: number;
  promo_code: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  vouchers?: { id: string; voucher_code: string; is_redeemed: boolean }[];
}

const typeLabel: Record<string, string> = {
  PERCENTAGE: "Diskon %",
  NOMINAL: "Diskon Rp",
  BOGO: "Buy 1 Get 1",
  BUNDLE: "Paket/Bundle",
};

export default function PromotionsPage() {
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await getPromotions();
    if (res.success) setPromos((res.data as PromoRow[]) ?? []);
    setLoading(false);
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-neutral-900">Promosi & Voucher</h1>
        <button
          onClick={() => setShowBuilder(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-3 py-2 rounded-xl"
        >
          <Plus size={16} /> Promosi Baru
        </button>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Diskon persentase/nominal, BOGO, atau paket bundle — lengkap dengan aturan (minimum
        belanja, khusus member, jam tertentu, dll).
      </p>

      {loading ? (
        <div className="flex justify-center py-10 text-neutral-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : promos.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10">Belum ada promosi.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {promos.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center text-primary">
                    <Tag size={16} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-neutral-900">{p.promo_name}</p>
                    <p className="text-xs text-neutral-500">
                      {typeLabel[p.promo_type]}
                      {p.promo_code ? ` · Kode: ${p.promo_code}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => togglePromotionActive(p.id, !p.is_active).then(load)}
                  className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    p.is_active ? "bg-primary-light text-primary" : "bg-neutral-100 text-neutral-400"
                  }`}
                >
                  {p.is_active ? "Aktif" : "Nonaktif"}
                </button>
              </div>
              <p className="text-xs text-neutral-400 mt-3">
                {p.start_date}
                {p.end_date ? ` s/d ${p.end_date}` : " (tanpa batas akhir)"}
              </p>
              {!!p.vouchers?.length && (
                <p className="text-xs text-neutral-500 mt-2 flex items-center gap-1">
                  <Ticket size={12} /> {p.vouchers.length} voucher terkait
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <PromotionBuilder
        isOpen={showBuilder}
        onClose={() => {
          setShowBuilder(false);
          load();
        }}
      />
    </div>
  );
}
