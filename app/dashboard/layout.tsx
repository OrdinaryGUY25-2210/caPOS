import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import SubscriptionCutoffGate from "@/components/SubscriptionCutoffGate";
import { createClient } from "@/lib/supabase/server";
import { daysRemaining } from "@/lib/utils";
import { ROLE_HOME } from "@/lib/role";

// Data langganan/akun harus selalu segar di setiap request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Role yang boleh membuka /dashboard. Kasir & Dapur punya halaman sendiri
// (/pos, /kitchen) dan tidak perlu — tidak boleh — masuk ke sini.
const DASHBOARD_ROLES = ["super_admin", "owner", "manager"];

/**
 * Layout untuk seluruh /dashboard/*.
 *
 * PENTING: konten dibungkus <DashboardShell>, karena di situlah
 * <BranchProvider> dipasang. Halaman yang memanggil useBranch()
 * (dashboard, transaksi, stok, meja, dst.) akan crash dengan
 * "useBranch harus dipanggil di dalam <BranchProvider>" kalau layout ini
 * tidak memakai DashboardShell.
 *
 * Urutan pengecekan (server-side, tidak bisa dilewati dari client):
 *  1. Belum login              -> /login
 *  2. Akun dinonaktifkan Owner -> /login?deactivated=1 (LoginForm yang
 *     men-sign-out sesi lokalnya)
 *  3. Role bukan Owner/Supervisor -> dikembalikan ke halaman role-nya,
 *     dengan ?access_denied=/dashboard supaya AccessDeniedNotice
 *     menjelaskan kenapa
 *  4. Langganan 'expired' -> SubscriptionCutoffGate memblokir konten
 *     (kecuali /dashboard/subscription supaya Owner bisa membayar)
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");
  if (profile.is_active === false) redirect("/login?deactivated=1");

  if (!DASHBOARD_ROLES.includes(profile.role)) {
    const home = ROLE_HOME[profile.role] ?? "/pos";
    redirect(`${home}?access_denied=${encodeURIComponent("/dashboard")}`);
  }

  let subscriptionStatus: string | null = null;
  let daysLeft = 999; // 999 = jangan tampilkan TrialBanner

  if (profile.tenant_id) {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("status, trial_ends_at")
      .eq("tenant_id", profile.tenant_id)
      .single();

    subscriptionStatus = subscription?.status ?? null;

    // Banner hanya relevan selama masih masa trial; untuk paket berbayar
    // trial_ends_at lama tidak boleh memunculkan "trial berakhir".
    if (subscription?.status === "trial" && subscription.trial_ends_at) {
      daysLeft = daysRemaining(subscription.trial_ends_at);
    }
  }

  return (
    <SubscriptionCutoffGate status={subscriptionStatus} variant="dashboard">
      <DashboardShell daysLeft={daysLeft}>{children}</DashboardShell>
    </SubscriptionCutoffGate>
  );
}
