"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, Tag, Ticket, ListChecks } from "lucide-react";
import { PromotionBuilder } from "@/components/crm/CustomerLoyaltyModal";
import { getPromotions, togglePromotionActive } from "@/app/actions/purchasing-loyalty-actions";

interface VoucherRow {
  id: string;
  voucher_code: string;
  discount_type: "PERCENTAGE" | "NOMINAL";
  discount_value: number;
  usage_limit: number | null;
  usage_count: number | null;
  is_redeemed?: boolean;
}

interface RuleRow {
  id: string;
  rule_type: string;
  rule_value: string;
}

interface PromoRow {
  id: string;
  promo_name: string;
  promo_type: "PERCENTAGE" | "NOMINAL" | "BOGO" | "BUNDLE";
  promo_code: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  vouchers?: VoucherRow[];
  promotion_rules?: RuleRow[];
}

const RULE_TYPE_LABEL: Record<string, string> = {
  MIN_PURCHASE: "Minimal belanja",
  MEMBER_ONLY: "Khusus member",
  TIME_RANGE: "Jam tertentu",
  DAY_OF_WEEK: "Hari tertentu",
  BRANCH: "Cabang tertentu",
  PRODUCT: "Produk tertentu",
  CATEGORY: "Kategori tertentu",
};

function ruleLabel(r: RuleRow) {
  return `${RULE_TYPE_LABEL[r.rule_type] ?? r.rule_type}: ${r.rule_value}`;
}

function voucherDiscountLabel(v: VoucherRow) {
  return v.discount_type === "PERCENTAGE" ? `${v.discount_value}%` : `Rp ${v.discount_value.toLocaleString("id-ID")}`;
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

              {!!p.promotion_rules?.length && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-neutral-600 flex items-center gap-1">
                    <ListChecks size={12} /> Syarat &amp; Ketentuan
                  </p>
                  <ul className="text-xs text-neutral-500 list-disc list-inside mt-1 space-y-0.5">
                    {p.promotion_rules.map((r) => (
                      <li key={r.id}>{ruleLabel(r)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!!p.vouchers?.length && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-neutral-600 flex items-center gap-1">
                    <Ticket size={12} /> {p.vouchers.length} voucher terkait
                  </p>
                  {p.vouchers.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs bg-neutral-50 rounded-lg px-2.5 py-1.5">
                      <span className="font-mono text-neutral-700">{v.voucher_code}</span>
                      <span className="text-neutral-500">
                        Diskon {voucherDiscountLabel(v)} · Terpakai {v.usage_count ?? 0}
                        {v.usage_limit ? `/${v.usage_limit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
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
