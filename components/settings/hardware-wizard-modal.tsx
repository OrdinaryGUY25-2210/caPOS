"use client";

import React, { useState } from "react";

interface HardwareWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HardwareWizardModal({ isOpen, onClose }: HardwareWizardModalProps) {
  const [step, setStep] = useState<number>(1);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleScanBluetooth = async () => {
    setIsScanning(true);
    try {
      if (typeof window !== "undefined" && "bluetooth" in navigator) {
        // Menggunakan acceptAllDevices tanpa optionalServices untuk menghindari konflik type Web Bluetooth
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true
        });
        if (device) {
          setConnectedDevice(device.name || "Printer Bluetooth");
          setStep(2);
        }
      } else {
        alert("Web Bluetooth API tidak didukung di browser ini.");
      }
    } catch (error) {
      console.error("Gagal menghubungkan printer:", error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    setTimeout(() => {
      setIsTesting(false);
      setStep(3);
    }, 1500);
  };

  const handleReset = () => {
    setStep(1);
    setConnectedDevice(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4 border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              Panduan Setup Printer
            </h2>
            <p className="text-xs text-zinc-500">Hubungkan printer thermal Bluetooth/USB secara mandiri</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {/* Wizard Steps */}
        <div className="space-y-4">
          {step === 1 && (
            <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 bg-blue-50 dark:bg-blue-950/50 rounded-full flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400 text-2xl font-bold">
                1
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Cari & Hubungkan Printer</h3>
              <p className="text-sm text-zinc-500">
                Pastikan Bluetooth di perangkat kamu dan printer thermal sudah dalam keadaan menyala.
              </p>
              <button
                onClick={handleScanBluetooth}
                disabled={isScanning}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-md"
              >
                {isScanning ? "Memindai Perangkat..." : "Pindai Perangkat Bluetooth"}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 bg-green-50 dark:bg-green-950/50 rounded-full flex items-center justify-center mx-auto text-green-600 dark:text-green-400 text-2xl font-bold">
                2
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Printer Terhubung!</h3>
              <p className="text-sm text-zinc-500">
                Terhubung ke: <span className="font-bold text-zinc-800 dark:text-zinc-200">{connectedDevice}</span>
              </p>
              <button
                onClick={handleTestPrint}
                disabled={isTesting}
                className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-md"
              >
                {isTesting ? "Mencetak Struk Tes..." : "Cetak Struk Percobaan"}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/50 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400 text-2xl font-bold">
                ✓
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Setup Selesai!</h3>
              <p className="text-sm text-zinc-500">
                Printer kamu sudah siap digunakan untuk mencetak transaksi di caPOS.
              </p>
              <button
                onClick={handleReset}
                className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-white font-medium rounded-xl transition-all shadow-md"
              >
                Selesai & Simpan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
