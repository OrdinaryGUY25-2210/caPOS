import React from "react";
import AppTour from "@/components/onboarding/app-tour";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Interactive In-App Tour Component */}
      <AppTour />
      
      <main className="w-full">
        {children}
      </main>
    </div>
  );
}
