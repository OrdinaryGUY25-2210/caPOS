import DashboardSidebar from "@/components/DashboardSidebar";
import TrialBanner from "@/components/TrialBanner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // In production, fetch daysRemaining(subscription.trial_ends_at) server-side.
  const demoDaysLeft = 2;

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TrialBanner daysLeft={demoDaysLeft} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
