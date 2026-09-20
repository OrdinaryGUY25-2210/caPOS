import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import SubscriptionCutoffGate from "@/components/SubscriptionCutoffGate";
import { createClient } from "@/lib/supabase/server";
import { daysRemaining } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let daysLeft = 999; // default aman: banner tidak muncul kalau data tidak ditemukan
  // Auto-Cutoff (Modul Subscription SaaS) — default null = gate tidak
  // memblokir apa pun kalau data subscription tidak ditemukan (aman).
  let subscriptionStatus: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_active")
      .eq("id", user.id)
      .single();

    // BUG FIX — sama seperti app/pos/layout.tsx: "Nonaktifkan" karyawan
    // sebelumnya tidak pernah benar-benar dicek. Owner sendiri sengaja
    // TIDAK PERNAH is_active=false (tidak ada tombol nonaktifkan diri
    // sendiri), jadi pengecekan ini murni menyasar manager yang dinonaktifkan.
    if (profile && profile.is_active === false) {
      redirect("/login?deactivated=1");
    }

    if (profile?.tenant_id) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("trial_ends_at, status")
        .eq("tenant_id", profile.tenant_id)
        .single();

      if (subscription?.status === "trial" && subscription.trial_ends_at) {
        daysLeft = daysRemaining(subscription.trial_ends_at);
      }
      subscriptionStatus = subscription?.status ?? null;
    }
  }

  return (
    <DashboardShell daysLeft={daysLeft}>
      <SubscriptionCutoffGate status={subscriptionStatus} variant="dashboard">
        {children}
      </SubscriptionCutoffGate>
    </DashboardShell>
  );
}
