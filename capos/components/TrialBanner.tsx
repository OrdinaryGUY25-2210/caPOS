"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function TrialBanner({ daysLeft }: { daysLeft: number }) {
  if (daysLeft > 3) return null;

  return (
    <div className="bg-urgent-light border-b border-red-200 px-5 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2 text-urgent text-sm font-medium">
        <AlertTriangle size={16} />
        {daysLeft > 0
          ? `Trial Hampir Habis — sisa ${daysLeft} hari lagi`
          : "Masa trial Anda sudah berakhir"}
      </div>
      <Link href="/dashboard/subscription" className="text-xs font-semibold text-urgent underline">
        Perpanjang Sekarang
      </Link>
    </div>
  );
}
