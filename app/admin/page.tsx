"use client";

import { useState } from "react";
import { Shield, Plus, Copy, X, LogOut } from "lucide-react";
import { cx } from "@/lib/utils";

interface TenantRow {
  id: string;
  name: string;
  status: "trial" | "active" | "past_due" | "expired";
  hasCustomWebsite: boolean;
  createdAt: string;
}

interface CodeRow {
  code: string;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
}

const DEMO_TENANTS: TenantRow[] = [
  { id: "t1", name: "Kafe Senja", status: "active", hasCustomWebsite: true, createdAt: "2026-06-01" },
  { id: "t2", name: "Kopi Kita", status: "trial", hasCustomWebsite: false, createdAt: "2026-08-14" },
  { id: "t3", name: "Rumah Kopi Nusantara", status: "past_due", hasCustomWebsite: false, createdAt: "2026-07-20" },
  { id: "t4", name: "Warung Kopi Pagi", status: "expired", hasCustomWebsite: false, createdAt: "2026-05-02" },
];

const DEMO_CODES: CodeRow[] = [
  { code: "CAPOSVIRAL", maxUses: 100, usedCount: 47, isActive: true },
  { code: "DEMOSTUDIOD13", maxUses: 1, usedCount: 1, isActive: false },
];

const STATUS_STYLE: Record<string, string> = {
  active: "badge-active",
  trial: "badge-warning",
  past_due: "badge-warning",
  expired: "badge-urgent",
};

export default function AdminPanel() {
  const [tenants] = useState<TenantRow[]>(DEMO_TENANTS);
  const [codes, setCodes] = useState<CodeRow[]>(DEMO_CODES);
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [form, setForm] = useState({ code: "", maxUses: 100 });

  function createCode() {
    if (!form.code.trim()) return;
    setCodes((prev) => [
      { code: form.code.trim().toUpperCase(), maxUses: form.maxUses, usedCount: 0, isActive: true },
      ...prev,
    ]);
    setForm({ code: "", maxUses: 100 });
    setShowCodeForm(false);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
        <div className="flex items-center gap-2 text-white">
          <Shield size={20} />
          <span className="font-bold">caPOS — Super Admin</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
        </div>
        <button className="text-neutral-400 hover:text-white flex items-center gap-1.5 text-sm">
          <LogOut size={16} /> Keluar
        </button>
      </header>

      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        <section>
          <h1 className="text-lg font-bold text-neutral-900 mb-1">Daftar Tenant Kafe</h1>
          <p className="text-sm text-neutral-500 mb-4">Akses tak terbatas ke seluruh tenant untuk keperluan demo & konten</p>
          <div className="card divide-y divide-neutral-100">
            {tenants.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-neutral-900 text-sm">{t.name}</p>
                  <p className="text-xs text-neutral-400">Terdaftar {t.createdAt} {t.hasCustomWebsite && "· Website Custom Active"}</p>
                </div>
                <span className={STATUS_STYLE[t.status]}>{t.status.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-neutral-900">Kode Akses Registrasi</h1>
              <p className="text-sm text-neutral-500">Kuota trial dibatasi maksimal 100 pendaftaran per kode</p>
            </div>
            <button onClick={() => setShowCodeForm(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} /> Generate Kode
            </button>
          </div>

          <div className="card divide-y divide-neutral-100">
            {codes.map((c) => {
              const pct = Math.min(100, Math.round((c.usedCount / c.maxUses) * 100));
              return (
                <div key={c.code} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-neutral-900">{c.code}</span>
                      <button onClick={() => copyCode(c.code)} className="text-neutral-400 hover:text-primary">
                        <Copy size={13} />
                      </button>
                    </div>
                    <span className={c.isActive ? "badge-active" : "badge-urgent"}>
                      {c.isActive ? "Active" : "Kuota Penuh"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={cx("h-full rounded-full", pct >= 100 ? "bg-urgent" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-neutral-500 font-mono">{c.usedCount}/{c.maxUses}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {showCodeForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Generate Kode Akses</h3>
              <button onClick={() => setShowCodeForm(false)}><X size={18} /></button>
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Kode</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="CAPOSVIRAL2"
                className="input-field font-mono uppercase"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Maksimal Penggunaan</label>
              <input
                type="number"
                max={100}
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: Math.min(100, Number(e.target.value)) })}
                className="input-field"
              />
              <p className="text-xs text-neutral-400 mt-1">Kuota trial massal dibatasi maksimal 100 tenant.</p>
            </div>
            <button onClick={createCode} className="btn-primary w-full">Buat Kode</button>
          </div>
        </div>
      )}
    </div>
  );
}
