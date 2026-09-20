import { redirect } from "next/navigation";
import SubscriptionCutoffGate from "@/components/SubscriptionCutoffGate";
import { createClient } from "@/lib/supabase/server";

/**
 * Auto-Cutoff untuk /pos (Modul Subscription SaaS, requirement #1).
 * File BARU — Next.js otomatis membungkus app/pos/page.tsx (yang sudah
 * stabil & tidak disentuh sama sekali) dengan layout ini tanpa perlu
 * mengedit page.tsx-nya.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let subscriptionStatus: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, is_active")
      .eq("id", user.id)
      .single();

    // BUG FIX — sebelumnya tombol "Nonaktifkan" di /dashboard/employees
    // cuma mengubah kolom `profiles.is_active` tanpa pernah benar-benar
    // dicek di mana pun, jadi karyawan yang sudah "dinonaktifkan" tetap
    // bisa login & pakai /pos seperti biasa. Dicek di sini (server-side,
    // di setiap load /pos) supaya tidak bisa dilewati dari client.
    if (profile && profile.is_active === false) {
      redirect("/login?deactivated=1");
    }

    if (profile?.tenant_id) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("tenant_id", profile.tenant_id)
        .single();
      subscriptionStatus = subscription?.status ?? null;
    }
  }

  return (
    <SubscriptionCutoffGate status={subscriptionStatus} variant="pos">
      {children}
    </SubscriptionCutoffGate>
  );
}
