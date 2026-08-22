import DashboardShell from "@/components/DashboardShell";
import { createClient } from "@/lib/supabase/server";
import { daysRemaining } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let daysLeft = 999; // default aman: banner tidak muncul kalau data tidak ditemukan

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profile?.tenant_id) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("trial_ends_at, status")
        .eq("tenant_id", profile.tenant_id)
        .single();

      if (subscription?.status === "trial" && subscription.trial_ends_at) {
        daysLeft = daysRemaining(subscription.trial_ends_at);
      }
    }
  }

  return <DashboardShell daysLeft={daysLeft}>{children}</DashboardShell>;
}
