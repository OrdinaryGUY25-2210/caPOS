"use client";

import { useEffect, useState } from "react";
import { Loader2, Phone, Mail, Award, Receipt, Clock } from "lucide-react";
import Modal from "@/components/Modal";
import { getCustomerProfile } from "@/app/actions/purchasing-loyalty-actions";

interface RecentTransaction {
  id: string;
  invoice_number: string;
  total_amount: number;
  created_at: string;
}

interface CustomerProfileData {
  id: string;
  customer_code: string;
  customer_name: string;
  phone_number: string | null;
  email: string | null;
  visit_count: number;
  lifetime_spend: number;
  customer_tiers?: { tier_name: string } | null;
  loyaltyBalance: number;
  recentTransactions: RecentTransaction[];
}

/**
 * Profil Pelanggan lengkap (item 15 — CRM) — melengkapi daftar pelanggan
 * yang sebelumnya cuma tabel (nama, kode, total belanja) dengan tampilan
 * "customer management" sungguhan: total kunjungan/order, kunjungan
 * terakhir, saldo loyalitas, membership, dan riwayat transaksi.
 *
 * Data diambil dari `getCustomerProfile` (server action yang sudah ada
 * sebelumnya untuk CustomerLoyaltyModal di kasir, tapi belum pernah
 * dipakai di dashboard CRM) — tidak menambah query/skema baru.
 */
export default function CustomerProfileModal({
  customerId,
  onClose,
  onOpenMemberCard,
}: {
  customerId: string;
  onClose: () => void;
  onOpenMemberCard: () => void;
}) {
  const [data, setData] = useState<CustomerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerProfile(customerId).then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setError(res.error ?? "Data pelanggan tidak ditemukan");
      } else {
        setData(res.data as CustomerProfileData);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const lastVisit = data?.recentTransactions?.[0]?.created_at ?? null;

  return (
    <Modal title="Profil Pelanggan" onClose={onClose} maxWidth="sm:max-w-md">
      {loading ? (
        <div className="flex justify-center py-10 text-neutral-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : error || !data ? (
        <p className="text-sm text-urgent text-center py-6">{error}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="font-bold text-neutral-900 text-base">{data.customer_name}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{data.customer_code}</p>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-neutral-500">
              {data.phone_number && (
                <span className="flex items-center gap-1">
                  <Phone size={12} /> {data.phone_number}
                </span>
              )}
              {data.email && (
                <span className="flex items-center gap-1">
                  <Mail size={12} /> {data.email}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-neutral-50 rounded-xl p-3">
              <p className="text-neutral-400 text-xs">Total Kunjungan/Order</p>
              <p className="font-semibold text-neutral-900 text-sm mt-0.5">{data.visit_count}x</p>
            </div>
            <div className="bg-neutral-50 rounded-xl p-3">
              <p className="text-neutral-400 text-xs">Total Belanja</p>
              <p className="font-semibold text-neutral-900 text-sm mt-0.5">
                Rp {Number(data.lifetime_spend || 0).toLocaleString("id-ID")}
              </p>
            </div>
            <div className="bg-neutral-50 rounded-xl p-3">
              <p className="text-neutral-400 text-xs">Kunjungan Terakhir</p>
              <p className="font-semibold text-neutral-900 text-sm mt-0.5 flex items-center gap-1">
                <Clock size={12} className="text-neutral-400" />
                {lastVisit
                  ? new Date(lastVisit).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                  : "Belum ada transaksi"}
              </p>
            </div>
            <div className="bg-neutral-50 rounded-xl p-3">
              <p className="text-neutral-400 text-xs">Saldo Poin Loyalitas</p>
              <p className="font-semibold text-neutral-900 text-sm mt-0.5">
                {data.loyaltyBalance.toLocaleString("id-ID")} pts
              </p>
            </div>
          </div>

          <button
            onClick={onOpenMemberCard}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary-light text-primary text-sm font-semibold py-2.5"
          >
            <Award size={15} />
            {data.customer_tiers?.tier_name
              ? `Membership: ${data.customer_tiers.tier_name} — Lihat Kartu`
              : "Lihat Kartu Member"}
          </button>

          <div>
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Receipt size={12} /> Riwayat Transaksi Terakhir
            </p>
            {data.recentTransactions.length === 0 ? (
              <p className="text-xs text-neutral-400 py-3 text-center bg-neutral-50 rounded-xl">
                Belum ada riwayat transaksi.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100 border border-neutral-100 rounded-xl overflow-hidden">
                {data.recentTransactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p className="font-mono text-xs text-neutral-700">{t.invoice_number}</p>
                      <p className="text-[11px] text-neutral-400">
                        {new Date(t.created_at).toLocaleString("id-ID")}
                      </p>
                    </div>
                    <p className="font-semibold text-neutral-900 text-sm">
                      Rp {Number(t.total_amount || 0).toLocaleString("id-ID")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
