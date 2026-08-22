"use client";

import { useState } from "react";
import { Save } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    name: "Kafe Demo",
    address: "Jl. Contoh No. 1, Jakarta",
    phone: "0812xxxxxxx",
    showWifi: true,
    wifiSsid: "KafeDemo-WiFi",
    wifiPassword: "kopi1234",
  });
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Pengaturan Kafe</h1>
        <p className="text-sm text-neutral-500">Informasi kafe dan opsi struk cetak</p>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-neutral-900 text-sm">Informasi Kafe</h2>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Kafe</label>
          <input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Alamat</label>
          <input value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">No. Telepon</label>
          <input value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} className="input-field" />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-neutral-900 text-sm">Tampilkan WiFi di Struk</h2>
            <p className="text-xs text-neutral-500">SSID & Password akan dicetak di bagian bawah struk</p>
          </div>
          <button
            onClick={() => setSettings({ ...settings, showWifi: !settings.showWifi })}
            className={settings.showWifi ? "w-11 h-6 rounded-full bg-primary relative transition-colors" : "w-11 h-6 rounded-full bg-neutral-200 relative transition-colors"}
          >
            <span
              className={
                settings.showWifi
                  ? "absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                  : "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
              }
            />
          </button>
        </div>

        {settings.showWifi && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">SSID WiFi</label>
              <input value={settings.wifiSsid} onChange={(e) => setSettings({ ...settings, wifiSsid: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Password WiFi</label>
              <input value={settings.wifiPassword} onChange={(e) => setSettings({ ...settings, wifiPassword: e.target.value })} className="input-field" />
            </div>
          </div>
        )}
      </div>

      <button onClick={handleSave} className="btn-primary flex items-center gap-2">
        <Save size={16} /> {saved ? "Tersimpan!" : "Simpan Perubahan"}
      </button>
    </div>
  );
}
