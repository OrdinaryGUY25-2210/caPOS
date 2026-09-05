"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import Modal from "@/components/Modal";

export default function SettingsPage() {
  const router = useRouter();
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

  // --- Zona Berbahaya: Hapus Akun (Owner only) ---
  const [isOwner, setIsOwner] = useState(false);
  const [cafeName, setCafeName] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile || profile.role !== "owner") return;
      setIsOwner(true);

      const supabase = createClient();
      const { data: tenant } = await supabase.from("tenants").select("name").eq("id", profile.tenant_id).single();
      setCafeName(tenant?.name ?? "");
    })();
  }, []);

  async function handleDeleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDeleteError(result.message || "Gagal menghapus akun. Silakan coba lagi.");
        setDeleting(false);
        return;
      }

      await createClient().auth.signOut().catch(() => {});
      router.push("/register");
    } catch {
      setDeleteError("Terjadi kesalahan jaringan. Silakan coba lagi.");
      setDeleting(false);
    }
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

      {isOwner && (
        <div className="card p-5 space-y-3 border-urgent/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-urgent" size={18} />
            <h2 className="font-semibold text-neutral-900 text-sm">Zona Berbahaya</h2>
          </div>
          <p className="text-xs text-neutral-500">
            Menghapus akun akan menghapus PERMANEN seluruh data kafe: menu, transaksi, karyawan, cabang, stok,
            membership, dan riwayat lainnya — sekaligus akun login Anda dan seluruh karyawan. Tindakan ini
            tidak bisa dibatalkan.
          </p>
          <button
            onClick={() => {
              setDeleteError(null);
              setConfirmText("");
              setShowDeleteModal(true);
            }}
            className="text-sm font-medium text-urgent border border-urgent/40 rounded-lg px-4 py-2 hover:bg-urgent/5 transition-colors"
          >
            Hapus Akun
          </button>
        </div>
      )}

      {showDeleteModal && (
        <Modal
          title="Hapus Akun Kafe"
          onClose={() => !deleting && setShowDeleteModal(false)}
          footer={
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="btn-outline flex-1 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || confirmText !== cafeName}
                className="flex-1 bg-urgent text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {deleting && <Loader2 className="animate-spin" size={16} />}
                Hapus Permanen
              </button>
            </div>
          }
        >
          <p className="text-sm text-neutral-600">
            Ini akan menghapus <strong>{cafeName || "kafe Anda"}</strong> beserta SEMUA data terkait (menu,
            transaksi, karyawan, cabang, stok, membership, dst) dan akun login Anda maupun karyawan, secara
            permanen.
          </p>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">
              Ketik <strong>{cafeName}</strong> untuk konfirmasi
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="input-field"
              placeholder={cafeName}
              disabled={deleting}
            />
          </div>
          {deleteError && <p className="text-sm text-urgent">{deleteError}</p>}
        </Modal>
      )}
    </div>
  );
}
