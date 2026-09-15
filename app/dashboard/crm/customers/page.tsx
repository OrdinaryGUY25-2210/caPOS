"use client";

/**
 * Direktori Pelanggan (Phase 3 — CRM & Loyalitas).
 *
 * Catatan penggabungan: paket Phase 3 asli hanya menyediakan
 * CustomerLoyaltyModal (dipakai di alur kasir untuk cari/pilih pelanggan
 * saat checkout) tapi belum ada halaman daftar pelanggan penuh untuk
 * dashboard. Halaman ini melengkapi bagian itu — daftar, cari, dan
 * tambah pelanggan baru — memakai server actions yang sudah ada
 * (getCustomers/createCustomer) plus getCustomers yang ditambahkan saat
 * penggabungan.
 */

import { useEffect, useState } from "react";
import { Plus, Search, Loader2, UserRound, X } from "lucide-react";
import { getCustomers, createCustomer, toggleCustomerActive } from "@/app/actions/purchasing-loyalty-actions";
import Modal from "@/components/Modal";

interface CustomerRow {
  id: string;
  customer_code: string;
  customer_name: string;
  phone_number: string | null;
  whatsapp_number: string | null;
  email: string | null;
  visit_count: number;
  lifetime_spend: number;
  is_active: boolean;
  customer_tiers?: { tier_name: string } | null;
}

const emptyForm = {
  customer_code: "",
  customer_name: "",
  phone_number: "",
  whatsapp_number: "",
  email: "",
  city: "",
  notes: "",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await getCustomers();
    if (res.success) setCustomers((res.data as CustomerRow[]) ?? []);
    setLoading(false);
  }

  async function handleCreate() {
    if (!form.customer_code.trim() || !form.customer_name.trim()) {
      setError("Kode & nama pelanggan wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await createCustomer(form);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setShowForm(false);
    setForm(emptyForm);
    load();
  }

  const filtered = customers.filter((c) =>
    `${c.customer_name} ${c.customer_code} ${c.phone_number ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-neutral-900">Pelanggan</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-3 py-2 rounded-xl"
        >
          <Plus size={16} /> Pelanggan Baru
        </button>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        Data pelanggan & riwayat loyalitas. Pencarian cepat + tambah member baru juga tersedia
        langsung dari halaman Kasir.
      </p>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama, kode, atau nomor telepon..."
          className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-xl text-sm"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-neutral-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10">Belum ada pelanggan.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 divide-y divide-neutral-100">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center text-primary">
                  <UserRound size={18} />
                </div>
                <div>
                  <p className="font-semibold text-sm text-neutral-900">{c.customer_name}</p>
                  <p className="text-xs text-neutral-500">
                    {c.customer_code} · {c.phone_number || "-"}
                    {c.customer_tiers?.tier_name ? ` · ${c.customer_tiers.tier_name}` : ""}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-neutral-900">
                  Rp {Number(c.lifetime_spend || 0).toLocaleString("id-ID")}
                </p>
                <button
                  onClick={() => toggleCustomerActive(c.id, !c.is_active).then(load)}
                  className={`text-xs font-medium ${c.is_active ? "text-neutral-400" : "text-urgent"}`}
                >
                  {c.is_active ? "Aktif" : "Nonaktif — aktifkan"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal
          title="Pelanggan Baru"
          onClose={() => setShowForm(false)}
          footer={
            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 size={14} className="animate-spin" />} Simpan
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {error && (
              <p className="text-xs text-urgent bg-urgent-light rounded-lg px-3 py-2">{error}</p>
            )}
            <input
              placeholder="Kode pelanggan (mis. CUST-001)"
              value={form.customer_code}
              onChange={(e) => setForm({ ...form, customer_code: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-sm"
            />
            <input
              placeholder="Nama lengkap"
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-sm"
            />
            <input
              placeholder="No. HP / WhatsApp"
              value={form.phone_number}
              onChange={(e) =>
                setForm({ ...form, phone_number: e.target.value, whatsapp_number: e.target.value })
              }
              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-sm"
            />
            <input
              placeholder="Email (opsional)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-sm"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
