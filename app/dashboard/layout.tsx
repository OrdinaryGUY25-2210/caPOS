"use client";

// Menandai halaman agar tidak di-prerender secara statis saat build di Vercel
export const dynamic = "force-dynamic";

import React from "react";
import Sidebar from "@/components/sidebar/Sidebar";
import AppTour from "@/components/onboarding/app-tour";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Interactive In-App Tour Component */}
      <AppTour />

      {/* Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
