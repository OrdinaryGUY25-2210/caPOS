"use client";

import React, { useState } from "react";
import HardwareWizardModal from "@/components/settings/hardware-wizard-modal";

export default function HardwareSettingsPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Pengaturan Hardware & Printer
        </h1>
        <p className="text-sm text-zinc-500">
          Kelola perangkat printer thermal dan periferal kasir caPOS.
        </p>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Printer Struk & Dapur
            </h2>
            <p className="text-xs text-zinc-500">
              Setup koneksi printer Bluetooth / USB secara langsung
            </p>
          </div>
          <button
            onClick={() => setIsWizardOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            Mulai Setup Wizard
          </button>
        </div>
      </div>

      {/* Hardware Setup Wizard Modal */}
      <HardwareWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
      />
    </div>
  );
}
