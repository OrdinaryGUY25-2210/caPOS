"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";

interface Cashier {
  id: string;
  full_name: string;
  email: string;
  active: boolean;
}

const DEMO_CASHIERS: Cashier[] = [
  { id: "c1", full_name: "Rizky Pratama", email: "rizky@kafeanda.com", active: true },
  { id: "c2", full_name: "Sari Wulandari", email: "sari@kafeanda.com", active: true },
];

export default function CashiersPage() {
  const [cashiers, setCashiers] = useState<Cashier[]>(DEMO_CASHIERS);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });

  function addCashier() {
    setCashiers((prev) => [
      { id: crypto.randomUUID(), full_name: form.full_name, email: form.email, active: true },
      ...prev,
    ]);
    setForm({ full_name: "", email: "", password: "" });
    setShowForm(false);
  }

  function toggleActive(id: string) {
    setCashiers((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));
  }

  function removeCashier(id: string) {
    setCashiers((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Kasir</h1>
          <p className="text-sm text-neutral-500">Kelola akun staf kasir kafe Anda</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Tambah Kasir
        </button>
      </div>

      <div className="card divide-y divide-neutral-100">
        {cashiers.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-light text-primary-dark flex items-center justify-center font-bold text-sm">
                {c.full_name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-neutral-900 text-sm">{c.full_name}</p>
                <p className="text-xs text-neutral-500">{c.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleActive(c.id)}
                className={c.active ? "badge-active" : "badge-urgent"}
              >
                {c.active ? "Active" : "Nonaktif"}
              </button>
              <button onClick={() => removeCashier(c.id)} className="text-neutral-300 hover:text-urgent">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {cashiers.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada akun kasir.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Tambah Akun Kasir</h3>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Lengkap</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Password Sementara</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input-field" />
            </div>
            <button onClick={addCashier} className="btn-primary w-full">Buat Akun Kasir</button>
          </div>
        </div>
      )}
    </div>
  );
}
