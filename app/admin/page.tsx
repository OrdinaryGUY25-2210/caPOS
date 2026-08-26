"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, LogOut, Loader2 } from "lucide-react";
import { daysRemaining } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface TenantRow {
  id: string;
  name: string;
  status: "trial" | "active" | "past_due" | "expired";
  hasCustomWebsite: boolean;
  createdAt: string;
  trialEndsAt: string | null;
  daysLeft: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  active: "badge-active",
  trial: "badge-warning",
  past_due: "badge-warning",
  expired: "badge-urgent",
};

export default function AdminPanel() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extendingId, setExtendingId] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("id, name, has_custom_website, created_at, subscriptions(status, trial_ends_at)")
      .order("created_at", { ascending: false });

    setTenants(
      (tenantRows ?? []).map((t: any) => {
        const sub = t.subscriptions?.[0];
        return {
          id: t.id,
          name: t.name,
          hasCustomWebsite: t.has_custom_website,
          createdAt: new Date(t.created_at).toLocaleDateString("id-ID"),
          status: sub?.status ?? "trial",
          trialEndsAt: sub?.trial_ends_at ?? null,
          daysLeft: sub?.trial_ends_at ? daysRemaining(sub.trial_ends_at) : null,
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function extendTrial(tenantId: string) {
    setExtendingId(tenantId);
    const supabase = createClient();
    const { error } = await supabase
      .from("subscriptions")
      .update({ trial_ends_at: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("tenant_id", tenantId);
    setExtendingId(null);

    if (error) {
      alert("Gagal perpanjang trial: " + error.message);
      return;
    }
    loadData();
  }

  async function activateTenant(tenantId: string) {
    if (!confirm("Jadikan tenant ini 'active' (bebas dari hitungan trial) selama 1 tahun?")) return;
    setExtendingId(tenantId);
    const supabase = createClient();
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "active",
        valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("tenant_id", tenantId);
    setExtendingId(null);

    if (error) {
      alert("Gagal aktifkan tenant: " + error.message);
      return;
    }
    loadData();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat data admin...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
        <div className="flex items-center gap-2 text-white">
          <Shield size={20} />
          <span className="font-bold">caPOS — Super Admin</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
        </div>
        <button onClick={handleLogout} className="text-neutral-400 hover:text-white flex items-center gap-1.5 text-sm">
          <LogOut size={16} /> Keluar
        </button>
      </header>

      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Total Tenant</p>
            <p className="text-2xl font-bold text-neutral-900 mt-1">{tenants.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Active (Subscribed)</p>
            <p className="text-2xl font-bold text-primary mt-1">
              {tenants.filter((t) => t.status === "active").length}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Trial</p>
            <p className="text-2xl font-bold text-warning mt-1">
              {tenants.filter((t) => t.status === "trial").length}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-neutral-500">Expired / Past Due</p>
            <p className="text-2xl font-bold text-urgent mt-1">
              {tenants.filter((t) => t.status === "expired" || t.status === "past_due").length}
            </p>
          </div>
        </section>

        <section>
          <h1 className="text-lg font-bold text-neutral-900 mb-1">Daftar Tenant Kafe</h1>
          <p className="text-sm text-neutral-500 mb-4">
            Akses tak terbatas ke seluruh tenant untuk keperluan demo & konten. Registrasi
            terbuka untuk siapa saja lewat <code>/register</code> — tidak lagi memerlukan kode akses.
          </p>
          <div className="card divide-y divide-neutral-100">
            {tenants.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 text-sm truncate">{t.name}</p>
                  <p className="text-xs text-neutral-400">
                    Terdaftar {t.createdAt} {t.hasCustomWebsite && "· Website Custom Active"}
                    {t.status === "trial" && t.daysLeft !== null && (
                      <> · Sisa trial: {t.daysLeft > 0 ? `${t.daysLeft} hari` : "habis"}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={STATUS_STYLE[t.status]}>{t.status.replace("_", " ")}</span>
                  {t.status !== "active" && (
                    <>
                      <button
                        onClick={() => extendTrial(t.id)}
                        disabled={extendingId === t.id}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50 whitespace-nowrap"
                        title="Perpanjang trial 28 hari dari sekarang"
                      >
                        +28 hari
                      </button>
                      <button
                        onClick={() => activateTenant(t.id)}
                        disabled={extendingId === t.id}
                        className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-50 whitespace-nowrap"
                        title="Set jadi active, bebas hitungan trial"
                      >
                        Aktifkan
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {tenants.length === 0 && <p className="p-6 text-center text-neutral-400 text-sm">Belum ada tenant terdaftar.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
