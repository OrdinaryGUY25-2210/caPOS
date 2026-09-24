"use client";

import React, { useEffect, useState } from "react";

interface Step {
  target: string;
  title: string;
  description: string;
}

const TOUR_STEPS: Step[] = [
  {
    target: "dashboard-nav",
    title: "Navigasi Utama",
    description: "Gunakan menu samping ini untuk berpindah antara Kasir, Laporan, Stok, dan Pengaturan."
  },
  {
    target: "pos-quick-access",
    title: "Akses Kasir / POS",
    description: "Klik di sini untuk membuka halaman transaksi kasir dengan cepat."
  },
  {
    target: "settings-hardware",
    title: "Pengaturan Hardware",
    description: "Atur dan hubungkan printer kasir Bluetooth atau USB Anda di menu Pengaturan."
  }
];

export default function AppTour() {
  const [currentStep, setCurrentStep] = useState<number | null>(null);

  useEffect(() => {
    const tourCompleted = localStorage.getItem("capos_tour_completed");
    if (!tourCompleted) {
      setCurrentStep(0);
    }
  }, []);

  const handleNext = () => {
    if (currentStep !== null) {
      if (currentStep < TOUR_STEPS.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        handleFinish();
      }
    }
  };

  const handleFinish = () => {
    localStorage.setItem("capos_tour_completed", "true");
    setCurrentStep(null);
  };

  if (currentStep === null) return null;

  const step = TOUR_STEPS[currentStep];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-xl border border-zinc-200 dark:border-zinc-800 space-y-4 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            Langkah {currentStep + 1} dari {TOUR_STEPS.length}
          </span>
          <button
            onClick={handleFinish}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Lewati Tour
          </button>
        </div>

        <div>
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {step.title}
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            {step.description}
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={handleFinish}
            className="text-sm text-zinc-500 hover:underline"
          >
            Selesai
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {currentStep === TOUR_STEPS.length - 1 ? "Selesai" : "Lanjut"}
          </button>
        </div>
      </div>
    </div>
  );
}
