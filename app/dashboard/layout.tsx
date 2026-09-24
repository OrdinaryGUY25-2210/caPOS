import React from "react";
import Sidebar from "@/components/sidebar/Sidebar";
import AppTour from "@/components/onboarding/app-tour";

// Opsi konfigurasi Route Segment untuk memaksa SSR (non-static export)
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppTour />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
