"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  LogOut,
  Loader2,
  Gift,
  KeyRound,
  Plus,
  Ban,
  RefreshCw,
  Users,
  Store,
  LayoutDashboard,
  CreditCard,
  TrendingUp,
  Search,
  BarChart3,
  Wallet,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { daysRemaining } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { generateReferralCode } from "@/lib/generateReferralCode";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Skeleton, SkeletonStatGrid, SkeletonList } from "@/components/Skeleton";

type TenantStatus = "trial" | "active" | "past_due" | "expired";
type Tier = "free" | "pro" | "supreme";

interface TenantRow {
  id: string;
  name: string;
  status: TenantStatus;
  plan: string | null;
  hasCustomWebsite: boolean;
  createdAt: string;
  createdAtRaw: string;
  trialEndsAt: string | null;
  validUntil: string | null;
  daysLeft: number | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string | null;
  tenantName: string;
  isActive: boolean;
  createdAt: string;
  createdAtRaw: string;
}

interface SpecialCodeRow {
  id: string;
  code: string;
  trialDays: number;
  discountPct: number;
  expiresAt: string;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  note: string | null;
}

type TabKey = "ringkasan" | "diagram" | "langganan" | "pengguna" | "kode";

const STATUS_STYLE: Record<string, string> = {
  active: "badge-active",
  trial: "badge-warning",
  past_due: "badge-warning",
  expired: "badge-urgent",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  owner: "Admin",
  manager: "Supervisor",
  cashier: "Kasir",
  kitchen: "Dapur",
};

const TIER_STYLE: Record<Tier, { label: string; badge: string; color: string }> = {
  supreme: { label: "Supreme", badge: "badge-active", color: "#7c3aed" },
  pro: { label: "Pro", badge: "badge-active", color: "#2563eb" },
  free: { label: "Free / Trial", badge: "badge-warning", color: "#94a3b8" },
};

const PLAN_PRICE_MONTHLY = 100000;
const PLAN_PRICE_YEARLY = 900000;

function rupiah(n: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
}

// Meniru fungsi SQL `tenant_tier()` supaya angka di dashboard konsisten
// dengan limitasi fitur yang ditegakkan di database.
function tierOf(t: TenantRow): Tier {
  if (t.status === "active" && t.plan === "yearly") return "supreme";
  if (t.status === "active" && t.plan === "monthly") return "pro";
  return "free";
}

function monthKey(value: string | Date): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastNMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: monthKey(d),
      label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }),
    });
  }
  return out;
}

export default function AdminPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("ringkasan");

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extendingId, setExtendingId] = useState<string | null>(null);

  const [missingReferrals, setMissingReferrals] = useState<{ id: string; name: string }[]>([]);
  const [generatingReferralId, setGeneratingReferralId] = useState<string | null>(null);

  const [specialCodes, setSpecialCodes] = useState<SpecialCodeRow[]>([]);
  const [showSpecialForm, setShowSpecialForm] = useState(false);
  const [savingSpecial, setSavingSpecial] = useState(false);
  const [togglingCodeId, setTogglingCodeId] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const [userQuery, setUserQuery] = useState("");
  const [authorized, setAuthorized] = useState(false);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("id, name, has_custom_website, created_at, subscriptions(status, plan, trial_ends_at, valid_until)")
      .order("created_at", { ascending: false });

    const mappedTenants: TenantRow[] = (tenantRows ?? []).map((t: any) => {
      const sub = t.subscriptions?.[0];
      return {
        id: t.id,
        name: t.name,
        hasCustomWebsite: t.has_custom_website,
        createdAt: new Date(t.created_at).toLocaleDateString("id-ID"),
        createdAtRaw: t.created_at,
        status: (sub?.status ?? "trial") as TenantStatus,
        plan: sub?.plan ?? null,
        trialEndsAt: sub?.trial_ends_at ?? null,
        validUntil: sub?.valid_until ?? null,
        daysLeft: sub?.trial_ends_at ? daysRemaining(sub.trial_ends_at) : null,
      };
    });
    setTenants(mappedTenants);

    // Semua akun terdaftar (RLS mengizinkan super_admin membaca seluruh baris).
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, tenant_id, role, full_name, email, is_active, created_at")
      .order("created_at", { ascending: false });

    const tenantNameById = new Map(mappedTenants.map((t) => [t.id, t.name]));
    const mappedUsers: UserRow[] = (profileRows ?? []).map((p: any) => ({
      id: p.id,
      name: p.full_name || "(tanpa nama)",
      email: p.email || "-",
      role: p.role || "cashier",
      tenantId: p.tenant_id ?? null,
      tenantName: p.tenant_id ? tenantNameById.get(p.tenant_id) ?? "Tenant tidak dikenal" : "— Platform",
      isActive: p.is_active !== false,
      createdAt: new Date(p.created_at).toLocaleDateString("id-ID"),
      createdAtRaw: p.created_at,
    }));
    setUsers(mappedUsers);

    // Cari tenant yang belum punya baris di tabel `referrals` (kode
    // referral tidak akan muncul di halaman mereka sampai ini diisi).
    const { data: referralRows } = await supabase.from("referrals").select("tenant_id");
    const tenantIdsWithReferral = new Set((referralRows ?? []).map((r: any) => r.tenant_id));
    setMissingReferrals(
      (tenantRows ?? [])
        .filter((t: any) => !tenantIdsWithReferral.has(t.id))
        .map((t: any) => ({ id: t.id, name: t.name }))
    );

    const { data: specialRows } = await supabase
      .from("admin_special_codes")
      .select("id, code, trial_days, discount_pct, expires_at, max_uses, used_count, is_active, note")
      .order("created_at", { ascending: false });

    setSpecialCodes(
      (specialRows ?? []).map((r: any) => ({
        id: r.id,
        code: r.code,
        trialDays: r.trial_days,
        discountPct: Number(r.discount_pct),
        expiresAt: r.expires_at,
        maxUses: r.max_uses,
        usedCount: r.used_count,
        isActive: r.is_active,
        note: r.note,
      }))
    );

    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { profile } = await getCurrentProfile();
      if (cancelled) return;
      if (!profile) {
        router.replace("/login");
        return;
      }
      if (profile.role !== "super_admin") {
        router.replace("/dashboard");
        return;
      }
      setAuthorized(true);
      loadData();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const byTier: Record<Tier, number> = { free: 0, pro: 0, supreme: 0 };
    tenants.forEach((t) => {
      byTier[tierOf(t)] += 1;
    });
    return {
      totalTenant: tenants.length,
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.isActive).length,
      byTier,
      trial: tenants.filter((t) => t.status === "trial").length,
      active: tenants.filter((t) => t.status === "active").length,
      expired: tenants.filter((t) => t.status === "expired" || t.status === "past_due").length,
    };
  }, [tenants, users]);

  const chartData = useMemo(() => {
    const months = lastNMonths(12);
    const tenantByMonth = new Map<string, number>();
    const userByMonth = new Map<string, number>();
    tenants.forEach((t) => {
      const k = monthKey(t.createdAtRaw);
      tenantByMonth.set(k, (tenantByMonth.get(k) ?? 0) + 1);
    });
    users.forEach((u) => {
      const k = monthKey(u.createdAtRaw);
      userByMonth.set(k, (userByMonth.get(k) ?? 0) + 1);
    });
    return {
      growth: months.map((m) => ({
        label: m.label,
        Tenant: tenantByMonth.get(m.key) ?? 0,
        Pengguna: userByMonth.get(m.key) ?? 0,
      })),
      planPie: (["supreme", "pro", "free"] as Tier[]).map((tier) => ({
        name: TIER_STYLE[tier].label,
        value: stats.byTier[tier],
        color: TIER_STYLE[tier].color,
      })),
    };
  }, [tenants, users, stats.byTier]);

  const extra = useMemo(() => {
    const statusCount: Record<TenantStatus, number> = { trial: 0, active: 0, past_due: 0, expired: 0 };
    tenants.forEach((t) => {
      statusCount[t.status] += 1;
    });

    const statusPie = [
      { name: "Aktif", value: statusCount.active, color: "#16a34a" },
      { name: "Trial", value: statusCount.trial, color: "#f59e0b" },
      { name: "Past Due", value: statusCount.past_due, color: "#f97316" },
      { name: "Expired", value: statusCount.expired, color: "#dc2626" },
    ].filter((d) => d.value > 0);

    const activeUsers = users.filter((u) => u.isActive).length;
    const userPie = [
      { name: "Aktif", value: activeUsers, color: "#2563eb" },
      { name: "Nonaktif", value: users.length - activeUsers, color: "#94a3b8" },
    ].filter((d) => d.value > 0);

    const customWebsite = tenants.filter((t) => t.hasCustomWebsite).length;
    const websitePie = [
      { name: "Website Custom", value: customWebsite, color: "#7c3aed" },
      { name: "Standar", value: tenants.length - customWebsite, color: "#94a3b8" },
    ].filter((d) => d.value > 0);

    const mrr = tenants.reduce((sum, t) => {
      if (t.status !== "active") return sum;
      if (t.plan === "yearly") return sum + PLAN_PRICE_YEARLY / 12;
      if (t.plan === "monthly") return sum + PLAN_PRICE_MONTHLY;
      return sum;
    }, 0);

    const usersByTenant = new Map<string, number>();
    users.forEach((u) => {
      if (!u.tenantId) return;
      usersByTenant.set(u.tenantId, (usersByTenant.get(u.tenantId) ?? 0) + 1);
    });
    const topTenants = tenants
      .map((t) => ({ name: t.name, Pengguna: usersByTenant.get(t.id) ?? 0 }))
      .sort((a, b) => b.Pengguna - a.Pengguna)
      .slice(0, 5);

    const months = lastNMonths(12);
    const tenantByMonth = new Map<string, number>();
    tenants.forEach((t) => {
      const k = monthKey(t.createdAtRaw);
      tenantByMonth.set(k, (tenantByMonth.get(k) ?? 0) + 1);
    });
    const windowStart = months[0].key;
    const baseline = tenants.filter((t) => monthKey(t.createdAtRaw) < windowStart).length;
    const cumulative = months.reduce<{ label: string; Tenant: number }[]>((acc, m) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].Tenant : baseline;
      acc.push({ label: m.label, Tenant: prev + (tenantByMonth.get(m.key) ?? 0) });
      return acc;
    }, []);

    const thisMonth = tenantByMonth.get(months[months.length - 1].key) ?? 0;
    const prevMonth = months.length > 1 ? tenantByMonth.get(months[months.length - 2].key) ?? 0 : 0;
    const momPct = prevMonth > 0 ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : thisMonth > 0 ? 100 : 0;

    const referralCount = Math.max(0, tenants.length - missingReferrals.length);
    const activeCodes = specialCodes.filter((c) => {
      const expired = new Date(c.expiresAt) < new Date();
      const usedUp = c.maxUses !== null && c.usedCount >= c.maxUses;
      return c.isActive && !expired && !usedUp;
    }).length;
    const totalSpecialUses = specialCodes.reduce((sum, c) => sum + c.usedCount, 0);

    return {
      statusPie,
      userPie,
      websitePie,
      customWebsite,
      mrr,
      arr: mrr * 12,
      avgUsersPerTenant: users.length / Math.max(1, tenants.length),
      topTenants,
      cumulative,
      newThisMonth: thisMonth,
      momPct,
      referralCount,
      activeCodes,
      totalSpecialUses,
    };
  }, [tenants, users, specialCodes, missingReferrals]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.tenantName.toLowerCase().includes(q) ||
        (ROLE_LABEL[u.role] ?? u.role).toLowerCase().includes(q)
    );
  }, [users, userQuery]);

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

  async function generateMissingReferral(tenantId: string) {
    setGeneratingReferralId(tenantId);
    const supabase = createClient();
    let lastError: string | null = null;

    // Coba beberapa kali kalau kebetulan kodenya sudah dipakai tenant lain
    // (sangat jarang — 6 karakter dari 32 pilihan huruf/angka).
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode();
      const { error } = await supabase.rpc("admin_upsert_referral_code", {
        p_tenant_id: tenantId,
        p_code: code,
      });
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error.message;
    }

    setGeneratingReferralId(null);
    if (lastError) {
      alert("Gagal membuat kode referral: " + lastError);
      return;
    }
    loadData();
  }

  async function createSpecialCode(input: {
    code: string;
    trialDays: number;
    discountPct: number;
    expiresAt: string;
    maxUses: number | null;
    note: string;
  }) {
    setSavingSpecial(true);
    const { profile } = await getCurrentProfile();
    const supabase = createClient();
    const { error } = await supabase.from("admin_special_codes").insert({
      code: input.code,
      trial_days: input.trialDays,
      discount_pct: input.discountPct,
      expires_at: input.expiresAt,
      max_uses: input.maxUses,
      note: input.note || null,
      created_by: profile?.id ?? null,
    });
    setSavingSpecial(false);
    if (error) {
      alert("Gagal membuat kode khusus: " + error.message);
      return;
    }
    setShowSpecialForm(false);
    loadData();
  }

  async function toggleSpecialCode(row: SpecialCodeRow) {
    setTogglingCodeId(row.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("admin_special_codes")
      .update({ is_active: !row.isActive })
      .eq("id", row.id);
    setTogglingCodeId(null);
    if (error) {
      alert("Gagal mengubah status kode: " + error.message);
      return;
    }
    loadData();
  }

  async function applyLogout() {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
    router.push("/login");
  }

  if (loading || !authorized) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-white">
            <Shield size={20} />
            <span className="font-bold">caPOS — Super Admin</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
          </div>
        </header>
        <div className="p-6 space-y-8 max-w-5xl mx-auto">
          <SkeletonStatGrid count={4} gridClassName="grid-cols-2 sm:grid-cols-4" />
          <section>
            <Skeleton className="h-4 w-48 mb-1" />
            <Skeleton className="h-3 w-full max-w-lg mb-4" />
            <SkeletonList rows={5} withAvatar={false} />
          </section>
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: typeof Store }[] = [
    { key: "ringkasan", label: "Ringkasan", icon: LayoutDashboard },
    { key: "diagram", label: "Diagram", icon: BarChart3 },
    { key: "langganan", label: "Langganan", icon: CreditCard },
    { key: "pengguna", label: "Pengguna", icon: Users },
    { key: "kode", label: "Kode & Referral", icon: KeyRound },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="h-16 bg-neutral-900 flex items-center justify-between px-6">
        <div className="flex items-center gap-2 text-white">
          <Shield size={20} />
          <span className="font-bold">caPOS — Super Admin</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full ml-2">Studio D13</span>
        </div>
        <button onClick={() => setConfirmLogout(true)} className="text-neutral-400 hover:text-white flex items-center gap-1.5 text-sm">
          <LogOut size={16} /> Keluar
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-6">
        <nav className="flex gap-1 border-b border-neutral-200 mt-4 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-6 space-y-8 max-w-5xl mx-auto">
        {tab === "ringkasan" && (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Total Tenant" value={stats.totalTenant} icon={Store} tone="neutral" />
              <StatCard label="Total Pengguna" value={stats.totalUsers} icon={Users} tone="primary" sub={`${stats.activeUsers} aktif`} />
              <StatCard label="Supreme" value={stats.byTier.supreme} icon={TrendingUp} tone="violet" />
              <StatCard label="Pro" value={stats.byTier.pro} icon={CreditCard} tone="primary" />
              <StatCard label="Free / Trial" value={stats.byTier.free} icon={Store} tone="warning" />
              <StatCard label="Expired" value={stats.expired} icon={Ban} tone="urgent" />
            </section>

            <section className="grid gap-4 lg:grid-cols-5">
              <div className="card p-5 lg:col-span-3">
                <h2 className="text-base font-bold text-neutral-900">Pertumbuhan 12 Bulan</h2>
                <p className="text-xs text-neutral-500 mb-4">Registrasi tenant baru &amp; pengguna baru per bulan.</p>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData.growth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Tenant" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Pengguna" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-5 lg:col-span-2">
                <h2 className="text-base font-bold text-neutral-900">Distribusi Paket</h2>
                <p className="text-xs text-neutral-500 mb-4">Jumlah tenant per paket berjalan.</p>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={chartData.planPie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {chartData.planPie.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-neutral-900 mb-1">Hitungan per Paket</h2>
              <p className="text-sm text-neutral-500 mb-4">Total paket berjalan dihitung dari status langganan tiap tenant.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(["supreme", "pro", "free"] as Tier[]).map((tier) => (
                  <div key={tier} className="card p-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_STYLE[tier].color }} />
                      <p className="text-xs text-neutral-500">{TIER_STYLE[tier].label}</p>
                    </div>
                    <p className="text-2xl font-bold text-neutral-900 mt-1">{stats.byTier[tier]}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {stats.totalTenant > 0 ? Math.round((stats.byTier[tier] / stats.totalTenant) * 100) : 0}% dari tenant
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === "diagram" && (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="MRR (estimasi)" value={rupiah(extra.mrr)} icon={Wallet} tone="primary" sub="per bulan" />
              <StatCard label="ARR (estimasi)" value={rupiah(extra.arr)} icon={TrendingUp} tone="violet" sub="per tahun" />
              <StatCard label="Rata-rata Pengguna / Tenant" value={extra.avgUsersPerTenant.toFixed(1)} icon={Users} tone="neutral" />
              <StatCard
                label="Tenant Baru Bulan Ini"
                value={extra.newThisMonth}
                icon={Store}
                tone="warning"
                sub={`${extra.momPct >= 0 ? "+" : ""}${extra.momPct}% vs bulan lalu`}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="card p-5">
                <h2 className="text-base font-bold text-neutral-900">Status Langganan</h2>
                <p className="text-xs text-neutral-500 mb-4">Sebaran status seluruh tenant.</p>
                <div style={{ width: "100%", height: 250 }}>
                  {extra.statusPie.length > 0 ? (
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={extra.statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                          {extra.statusPie.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart />
                  )}
                </div>
              </div>

              <div className="card p-5">
                <h2 className="text-base font-bold text-neutral-900">Status Pengguna</h2>
                <p className="text-xs text-neutral-500 mb-4">Akun aktif vs nonaktif lintas tenant.</p>
                <div style={{ width: "100%", height: 250 }}>
                  {extra.userPie.length > 0 ? (
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={extra.userPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                          {extra.userPie.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart />
                  )}
                </div>
              </div>

              <div className="card p-5">
                <h2 className="text-base font-bold text-neutral-900">Website Custom</h2>
                <p className="text-xs text-neutral-500 mb-4">Tenant bercustom website vs standar.</p>
                <div style={{ width: "100%", height: 250 }}>
                  {extra.websitePie.length > 0 ? (
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={extra.websitePie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                          {extra.websitePie.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart />
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="card p-5">
                <h2 className="text-base font-bold text-neutral-900">Top 5 Tenant (Pengguna)</h2>
                <p className="text-xs text-neutral-500 mb-4">Tenant dengan jumlah akun terbanyak.</p>
                <div style={{ width: "100%", height: 280 }}>
                  {extra.topTenants.length > 0 ? (
                    <ResponsiveContainer>
                      <BarChart data={extra.topTenants} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <Tooltip />
                        <Bar dataKey="Pengguna" fill="#2563eb" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart />
                  )}
                </div>
              </div>

              <div className="card p-5">
                <h2 className="text-base font-bold text-neutral-900">Pertumbuhan Kumulatif Tenant</h2>
                <p className="text-xs text-neutral-500 mb-4">Total tenant menaik tiap bulan.</p>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={extra.cumulative} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Bar dataKey="Tenant" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-neutral-900 mb-1">Referral &amp; Kode</h2>
              <p className="text-sm text-neutral-500 mb-4">Ringkasan kode referral tenant dan kode khusus admin.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard label="Kode Referral" value={extra.referralCount} icon={Gift} tone="neutral" />
                <StatCard label="Kode Khusus Aktif" value={extra.activeCodes} icon={KeyRound} tone="primary" />
                <StatCard label="Total Pemakaian Kode Khusus" value={extra.totalSpecialUses} icon={CreditCard} tone="violet" />
              </div>
            </section>
          </>
        )}

        {tab === "langganan" && (
          <section>
            <h1 className="text-lg font-bold text-neutral-900 mb-1">Langganan Tenant</h1>
            <p className="text-sm text-neutral-500 mb-4">
              Akses tak terbatas ke seluruh tenant. Registrasi terbuka lewat <code>/register</code>.
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500 border-b border-neutral-100">
                    <th className="font-medium px-4 py-3">Tenant</th>
                    <th className="font-medium px-4 py-3">Status</th>
                    <th className="font-medium px-4 py-3">Paket</th>
                    <th className="font-medium px-4 py-3">Berakhir</th>
                    <th className="font-medium px-4 py-3">Terdaftar</th>
                    <th className="font-medium px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {tenants.map((t) => {
                    const tier = tierOf(t);
                    const endDate = t.status === "active" ? t.validUntil : t.trialEndsAt;
                    return (
                      <tr key={t.id} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-900">{t.name}</p>
                          {t.hasCustomWebsite && <p className="text-xs text-neutral-400">Website Custom</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={STATUS_STYLE[t.status]}>{t.status.replace("_", " ")}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={TIER_STYLE[tier].badge}>{TIER_STYLE[tier].label}</span>
                        </td>
                        <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                          {endDate ? new Date(endDate).toLocaleDateString("id-ID") : "-"}
                          {t.status === "trial" && t.daysLeft !== null && (
                            <span className="block text-xs text-neutral-400">
                              {t.daysLeft > 0 ? `sisa ${t.daysLeft} hari` : "habis"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{t.createdAt}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {t.status !== "active" ? (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => extendTrial(t.id)}
                                disabled={extendingId === t.id}
                                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                                title="Perpanjang trial 28 hari dari sekarang"
                              >
                                +28 hari
                              </button>
                              <button
                                onClick={() => activateTenant(t.id)}
                                disabled={extendingId === t.id}
                                className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-50"
                                title="Set jadi active, bebas hitungan trial"
                              >
                                Aktifkan
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {tenants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                        Belum ada tenant terdaftar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "pengguna" && (
          <section>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h1 className="text-lg font-bold text-neutral-900 mb-1">Pengguna Terdaftar</h1>
                <p className="text-sm text-neutral-500">Semua akun lintas tenant ({users.length} akun).</p>
              </div>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Cari nama / email / tenant…"
                  className="input-field pl-9 w-64"
                />
              </div>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500 border-b border-neutral-100">
                    <th className="font-medium px-4 py-3">Nama</th>
                    <th className="font-medium px-4 py-3">Email</th>
                    <th className="font-medium px-4 py-3">Peran</th>
                    <th className="font-medium px-4 py-3">Tenant</th>
                    <th className="font-medium px-4 py-3">Status</th>
                    <th className="font-medium px-4 py-3">Terdaftar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredUsers.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{u.name}</td>
                      <td className="px-4 py-3 text-neutral-600">{u.email}</td>
                      <td className="px-4 py-3 text-neutral-600">{ROLE_LABEL[u.role] ?? u.role}</td>
                      <td className="px-4 py-3 text-neutral-600">{u.tenantName}</td>
                      <td className="px-4 py-3">
                        <span className={u.isActive ? "badge-active" : "badge-urgent"}>
                          {u.isActive ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{u.createdAt}</td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                        {users.length === 0 ? "Belum ada pengguna terdaftar." : "Tidak ada pengguna yang cocok."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "kode" && (
          <>
            {missingReferrals.length > 0 && (
              <section>
                <h2 className="text-lg font-bold text-neutral-900 mb-1 flex items-center gap-2">
                  <Gift size={18} /> Kode Referral Bermasalah
                </h2>
                <p className="text-sm text-neutral-500 mb-4">
                  Tenant di bawah ini belum punya kode referral (biasanya akun dibuat sebelum fitur ini ada, atau dibuat manual). Klik generate untuk membuatkan kode baru untuk mereka.
                </p>
                <div className="card divide-y divide-neutral-100">
                  {missingReferrals.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-4 gap-3">
                      <p className="font-medium text-neutral-900 text-sm truncate">{t.name}</p>
                      <button
                        onClick={() => generateMissingReferral(t.id)}
                        disabled={generatingReferralId === t.id}
                        className="btn-outline text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                      >
                        {generatingReferralId === t.id ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                        Generate Kode
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                  <KeyRound size={18} /> Kode Khusus Admin
                </h2>
                <button onClick={() => setShowSpecialForm(true)} className="btn-primary text-sm flex items-center gap-1.5">
                  <Plus size={14} /> Buat Kode Baru
                </button>
              </div>
              <p className="text-sm text-neutral-500 mb-4">
                Kode promo yang Anda buat & bagikan sendiri (misal ke partner/campaign tertentu) — beda dari kode referral tenant. Setiap kode punya masa berlaku, lama trial Supreme, diskon pendaftar, dan batas pemakaian sendiri.
              </p>
              <div className="card divide-y divide-neutral-100">
                {specialCodes.map((c) => {
                  const expired = new Date(c.expiresAt) < new Date();
                  const usedUp = c.maxUses !== null && c.usedCount >= c.maxUses;
                  const statusLabel = !c.isActive ? "Nonaktif" : expired ? "Kedaluwarsa" : usedUp ? "Habis Kuota" : "Aktif";
                  const statusStyle = statusLabel === "Aktif" ? "badge-active" : statusLabel === "Nonaktif" ? "badge-urgent" : "badge-warning";
                  return (
                    <div key={c.id} className="flex items-center justify-between p-4 gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-neutral-900 text-sm">{c.code}</p>
                        <p className="text-xs text-neutral-400">
                          Trial {c.trialDays} hari · Diskon {c.discountPct}% · Berlaku s/d {new Date(c.expiresAt).toLocaleDateString("id-ID")}
                          {" · "}Dipakai {c.usedCount}{c.maxUses !== null ? `/${c.maxUses}` : ""}
                          {c.note ? ` · ${c.note}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={statusStyle}>{statusLabel}</span>
                        <button
                          onClick={() => toggleSpecialCode(c)}
                          disabled={togglingCodeId === c.id}
                          className="text-xs font-medium text-neutral-500 hover:underline disabled:opacity-50 flex items-center gap-1"
                          title={c.isActive ? "Nonaktifkan kode" : "Aktifkan lagi kode"}
                        >
                          <Ban size={12} /> {c.isActive ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {specialCodes.length === 0 && (
                  <p className="p-6 text-center text-neutral-400 text-sm">Belum ada kode khusus dibuat.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {showSpecialForm && (
        <SpecialCodeFormModal
          saving={savingSpecial}
          onClose={() => setShowSpecialForm(false)}
          onSave={createSpecialCode}
        />
      )}

      {confirmLogout && (
        <ConfirmDialog
          title="Keluar dari Akun?"
          description="Anda akan keluar dari sesi Super Admin ini di perangkat ini."
          danger={false}
          confirmLabel="Ya, Keluar"
          onClose={() => setConfirmLogout(false)}
          onConfirm={applyLogout}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  icon: typeof Store;
  tone: "neutral" | "primary" | "violet" | "warning" | "urgent";
  sub?: string;
}) {
  const toneClass: Record<typeof tone, string> = {
    neutral: "text-neutral-900",
    primary: "text-primary",
    violet: "text-violet-600",
    warning: "text-warning",
    urgent: "text-urgent",
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">{label}</p>
        <Icon size={15} className="text-neutral-300" />
      </div>
      <p className={`text-2xl font-bold mt-1 ${toneClass[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-neutral-400">
      Belum ada data.
    </div>
  );
}

function SpecialCodeFormModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    code: string;
    trialDays: number;
    discountPct: number;
    expiresAt: string;
    maxUses: number | null;
    note: string;
  }) => void;
}) {
  const [code, setCode] = useState(generateReferralCode());
  const [trialDays, setTrialDays] = useState("5");
  const [discountPct, setDiscountPct] = useState("2");
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [maxUses, setMaxUses] = useState("");
  const [note, setNote] = useState("");

  const valid = code.trim().length >= 4 && Number(trialDays) > 0 && expiresAt;

  return (
    <Modal
      title="Buat Kode Khusus Admin"
      onClose={onClose}
      footer={
        <button
          disabled={saving || !valid}
          onClick={() =>
            onSave({
              code: code.trim().toUpperCase(),
              trialDays: Number(trialDays),
              discountPct: discountPct === "" ? 0 : Number(discountPct),
              expiresAt: new Date(expiresAt + "T23:59:59").toISOString(),
              maxUses: maxUses === "" ? null : Number(maxUses),
              note,
            })
          }
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Kode
        </button>
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Kode</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            className="input-field font-mono"
            maxLength={12}
          />
        </div>
        <button
          type="button"
          onClick={() => setCode(generateReferralCode())}
          className="btn-outline shrink-0 px-3 py-2"
          title="Acak ulang kode"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Lama Trial Supreme (hari)</label>
          <input
            type="text" inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Diskon Pendaftar (%)</label>
          <input
            type="text" inputMode="numeric"
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value.replace(/[^0-9]/g, ""))}
            className="input-field"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Berlaku Sampai</label>
          <input
            type="date"
            value={expiresAt}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Batas Pemakaian (opsional)</label>
          <input
            type="text" inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Kosongkan = tak terbatas"
            className="input-field"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan (opsional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Campaign IG Agustus" className="input-field" />
      </div>
    </Modal>
  );
}
