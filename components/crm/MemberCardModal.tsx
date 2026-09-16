"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Award, Loader2, Sparkles } from "lucide-react";
import Modal from "@/components/Modal";
import { getCustomerTiers, assignCustomerTier } from "@/app/actions/customer-membership-actions";
import type { CustomerTier, MemberCard } from "@/lib/types";

/**
 * Kartu Member Digital (Modul Membership CRM, requirement #3) — Nama,
 * Status Tier, QR Code (isi: member_code = customers.customer_code), dan
 * Saldo Poin. Dibangun sebagai komponen BARU & terisolasi, dipanggil dari
 * app/dashboard/crm/customers/page.tsx.
 */
export default function MemberCardModal({
  card,
  onClose,
  onTierChanged,
}: {
  card: MemberCard;
  onClose: () => void;
  onTierChanged: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tiers, setTiers] = useState<CustomerTier[]>([]);
  const [changingTier, setChangingTier] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, card.member_code, {
        width: 180,
        margin: 1,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      });
    }
    getCustomerTiers().then((res) => {
      if (res.data) setTiers(res.data);
    });
  }, [card.member_code]);

  async function handleTierChange(tierId: string) {
    setChangingTier(true);
    const res = await assignCustomerTier(card.customer_id, tierId || null);
    setChangingTier(false);
    if (res.error) {
      alert("Gagal mengubah tier: " + res.error);
      return;
    }
    onTierChanged();
  }

  return (
    <Modal title="Kartu Member Digital" onClose={onClose}>
      <div className="space-y-4">
        {/* Kartu visual */}
        <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-dark text-white p-5 relative overflow-hidden">
          <Sparkles className="absolute -right-3 -top-3 opacity-20" size={90} />
          <p className="text-xs uppercase tracking-wide opacity-80">Kartu Member</p>
          <p className="text-lg font-bold mt-1">{card.customer_name}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <Award size={14} />
            <span className="text-sm font-medium">{card.tier_name}</span>
          </div>
          <div className="flex items-end justify-between mt-4">
            <div>
              <p className="text-xs opacity-80">Saldo Poin</p>
              <p className="text-2xl font-bold">{card.points_balance.toLocaleString("id-ID")}</p>
            </div>
            <div className="bg-white rounded-xl p-2">
              <canvas ref={canvasRef} />
            </div>
          </div>
          <p className="text-[11px] font-mono opacity-70 mt-2 text-center">{card.member_code}</p>
        </div>

        {card.tier_benefits?.length > 0 && (
          <div className="text-sm text-neutral-600">
            <p className="font-medium text-neutral-800 mb-1">Benefit {card.tier_name}:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {card.tier_benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-neutral-50 rounded-xl p-3">
            <p className="text-neutral-400 text-xs">Total Belanja</p>
            <p className="font-semibold text-neutral-900">Rp {card.lifetime_spend.toLocaleString("id-ID")}</p>
          </div>
          <div className="bg-neutral-50 rounded-xl p-3">
            <p className="text-neutral-400 text-xs">Kunjungan</p>
            <p className="font-semibold text-neutral-900">{card.visit_count}x</p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Ubah Tier</label>
          <select
            defaultValue={card.tier_id ?? ""}
            disabled={changingTier}
            onChange={(e) => handleTierChange(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">Reguler (tanpa tier)</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tier_name} — diskon {t.discount_percentage}%, poin {t.points_multiplier}x
              </option>
            ))}
          </select>
          {changingTier && (
            <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Menyimpan...
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
