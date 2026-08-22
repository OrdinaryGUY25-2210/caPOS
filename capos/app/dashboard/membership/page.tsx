"use client";

import { useState } from "react";
import { CreditCard, Sparkles, Plus, X } from "lucide-react";
import { whatsappLink } from "@/lib/utils";
import type { Membership } from "@/lib/types";

// Demo tenant flag — in production this comes from tenants.has_custom_website
const DEMO_HAS_CUSTOM_WEBSITE = false;

const DEMO_MEMBERS: Membership[] = [
  { id: "m1", tenant_id: "demo", customer_name: "Andi Saputra", customer_phone: "0812xxxxxxx", member_code: "MBR-2026-0001", discount_percentage: 10, valid_until: "2027-01-01", is_active: true, created_at: "" },
  { id: "m2", tenant_id: "demo", customer_name: "Dewi Lestari", customer_phone: "0813xxxxxxx", member_code: "MBR-2026-0002", discount_percentage: 15, valid_until: "2027-03-01", is_active: true, created_at: "" },
];

export default function MembershipPage() {
  const [hasCustomWebsite] = useState(DEMO_HAS_CUSTOM_WEBSITE);

  if (!hasCustomWebsite) {
    return (
      <div className="max-w-lg mx-auto mt-10">
        <div className="card p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center mx-auto">
            <Sparkles className="text-primary-dark" size={26} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Fitur Membership Eksklusif</h1>
          <p className="text-sm text-neutral-500">
            Fitur Membership terintegrasi langsung dengan Website Custom Kafe Anda —
            pelanggan bisa mendaftar, melihat diskon, dan mengecek riwayat member secara online.
            Upgrade paket Anda untuk membuka fitur ini.
          </p>
          <a
            href={whatsappLink("Halo Studio D13, saya ingin upgrade ke Website Custom untuk membuka fitur Membership caPOS.")}
            target="_blank"
            rel="noreferrer"
            className="btn-primary w-full inline-block"
          >
            Hubungi Developer (Studio D13) via WhatsApp
          </a>
        </div>
      </div>
    );
  }

  return <MembershipPanel />;
}

function MembershipPanel() {
  const [members, setMembers] = useState<Membership[]>(DEMO_MEMBERS);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", discount_percentage: 10 });

  function addMember() {
    const seq = String(members.length + 1).padStart(4, "0");
    setMembers((prev) => [
      {
        id: crypto.randomUUID(),
        tenant_id: "demo",
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        member_code: `MBR-2026-${seq}`,
        discount_percentage: form.discount_percentage,
        valid_until: "2027-12-31",
        is_active: true,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
    setForm({ customer_name: "", customer_phone: "", discount_percentage: 10 });
    setShowForm(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Membership</h1>
          <p className="text-sm text-neutral-500">Kelola kartu langganan pelanggan kafe Anda</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Tambah Member
        </button>
      </div>

      <div className="card divide-y divide-neutral-100">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center">
                <CreditCard size={18} />
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{m.customer_name}</p>
                <p className="text-xs text-neutral-500 font-mono">{m.member_code} · {m.customer_phone}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="badge-active">Diskon {m.discount_percentage}%</span>
              <p className="text-xs text-neutral-400 mt-1">Berlaku s/d {m.valid_until}</p>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Tambah Member Baru</h3>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Pelanggan</label>
              <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">No. HP</label>
              <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Diskon Member (%)</label>
              <input
                type="number"
                value={form.discount_percentage}
                onChange={(e) => setForm({ ...form, discount_percentage: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <button onClick={addMember} className="btn-primary w-full">Buat Kartu Member</button>
          </div>
        </div>
      )}
    </div>
  );
}
