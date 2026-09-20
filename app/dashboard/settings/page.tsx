"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, AlertTriangle, Loader2, ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { compressImage } from "@/lib/compressImage";
import { db } from "@/lib/dexie";
import Modal from "@/components/Modal";
import { Skeleton } from "@/components/Skeleton";

/**
 * Phase 2A.2 §5 — sebelumnya form ini murni kosmetik: `handleSave` cuma
 * `setSaved(true)` tanpa menulis apa pun ke Supabase, dan field "Alamat"
 * tidak pernah ada kolomnya di tabel `tenants` — nilai defaultnya
 * ("Jl. Contoh No. 1, Jakarta") ikut tercetak di struk asli pelanggan
 * (lihat app/pos/page.tsx sebelum perbaikan ini). Sekarang:
 *  - Nama/Telepon/Pengaturan WiFi struk BENAR-BENAR disimpan ke `tenants`
 *    (kolom-kolom ini sudah ada sejak schema awal — lihat supabase/schema.sql).
 *  - Field "Alamat" DIHAPUS dari form ini karena `tenants` belum punya
 *    kolom untuk itu. Menambah kolom butuh migrasi baru, yang menurut
 *    aturan Fase ini ("ZERO DATABASE CHANGES" default) tidak dibuat begitu
 *    saja — lihat docs/PHASE_2A2_DB_CHANGE_PROPOSAL.md Case E untuk usulan
 *    kolom `address`/`receipt_footer` yang genuinely dibutuhkan tapi belum
 *    disetujui.
 *  - Logo kafe TIDAK butuh kolom baru: disimpan di Supabase Storage bucket
 *    "menu-images" (bucket yang sudah ada) di path tetap
 *    `${tenant_id}/cafe-logo.jpg`, jadi bisa langsung jalan tanpa migrasi.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    name: "",
    phone: "",
    showWifi: false,
    wifiSsid: "",
    wifiPassword: "",
    // Bug fix — dulu lebar struk hardcode "80mm" di app/pos/page.tsx,
    // sekarang bisa diatur per tenant (migration_16 bagian I, kolom
    // tenants.receipt_paper_width) supaya pengguna printer 58mm (mis.
    // POS-58) tidak lagi dapat struk yang kepotong.
    receiptPaperWidth: "80mm" as "58mm" | "80mm",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Logo kafe (Storage, bukan kolom DB — lihat catatan di atas) ---
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Zona Berbahaya: Hapus Akun (Owner only) ---
  const [isOwner, setIsOwner] = useState(false);
  const [cafeName, setCafeName] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function refreshLogo(supabase: ReturnType<typeof createClient>, tid: string) {
    // Path-nya tetap (`cafe-logo.jpg`), jadi kita tidak bisa asal getPublicUrl()
    // dan percaya itu ada — kalau belum pernah upload, itu akan 404 di struk
    // cetak. list() dulu untuk konfirmasi filenya benar-benar ada.
    const { data: files } = await supabase.storage.from("menu-images").list(tid, { search: "cafe-logo" });
    if (files && files.length > 0) {
      const { data } = supabase.storage.from("menu-images").getPublicUrl(`${tid}/cafe-logo.jpg`);
      // Cache-bust supaya preview langsung berubah setelah ganti logo,
      // bukan menampilkan versi lama dari cache browser/CDN.
      setLogoUrl(`${data.publicUrl}?v=${Date.now()}`);
    } else {
      setLogoUrl(null);
    }
  }

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      setTenantId(profile.tenant_id);
      setIsOwner(profile.role === "owner");

      const supabase = createClient();
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, phone, show_wifi_on_receipt, wifi_ssid, wifi_password, receipt_paper_width")
        .eq("id", profile.tenant_id)
        .single();

      if (tenant) {
        setCafeName(tenant.name ?? "");
        setSettings({
          name: tenant.name ?? "",
          phone: tenant.phone ?? "",
          showWifi: !!tenant.show_wifi_on_receipt,
          wifiSsid: tenant.wifi_ssid ?? "",
          wifiPassword: tenant.wifi_password ?? "",
          receiptPaperWidth: (tenant.receipt_paper_width as "58mm" | "80mm") ?? "80mm",
        });
      }

      await refreshLogo(supabase, profile.tenant_id);
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("tenants")
      .update({
        name: settings.name,
        phone: settings.phone,
        show_wifi_on_receipt: settings.showWifi,
        wifi_ssid: settings.wifiSsid,
        wifi_password: settings.wifiPassword,
        receipt_paper_width: settings.receiptPaperWidth,
      })
      .eq("id", tenantId);

    if (error) {
      setSaveError("Gagal menyimpan: " + error.message);
      setSaving(false);
      return;
    }

    setCafeName(settings.name);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleLogoUpload(file: File) {
    if (!tenantId) return;
    setLogoError(null);

    if (!file.type.startsWith("image/")) {
      setLogoError("File harus berupa gambar (PNG/JPG/WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoError("Ukuran file maksimal 5MB.");
      return;
    }

    setLogoUploading(true);
    try {
      // Dipaksa ke JPEG supaya nama filenya deterministik (`cafe-logo.jpg`)
      // — kalau formatnya berubah-ubah, upsert tidak akan menimpa file lama
      // dan bucket akan menumpuk file logo basi.
      const compressed = await compressImage(file, { format: "jpeg", maxDimension: 512, maxSizeKB: 180 });
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("menu-images")
        .upload(`${tenantId}/cafe-logo.jpg`, compressed, { upsert: true, contentType: "image/jpeg" });

      if (error) {
        setLogoError("Upload gagal: " + error.message);
        setLogoUploading(false);
        return;
      }

      await refreshLogo(supabase, tenantId);
    } catch {
      setLogoError("Gagal memproses gambar. Coba file lain.");
    }
    setLogoUploading(false);
  }

  async function handleLogoRemove() {
    if (!tenantId) return;
    setLogoUploading(true);
    setLogoError(null);
    const supabase = createClient();
    const { error } = await supabase.storage.from("menu-images").remove([`${tenantId}/cafe-logo.jpg`]);
    if (error) {
      setLogoError("Gagal menghapus logo: " + error.message);
    } else {
      setLogoUrl(null);
    }
    setLogoUploading(false);
  }

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

      // Bersihkan cache offline (IndexedDB) di device ini juga — ditulis
      // ulang belaka lewat /pos next login (lihat fix di app/pos/page.tsx)
      // seharusnya sudah cukup, tapi dibersihkan langsung di sini supaya
      // tidak ada jeda sama sekali kalau device yang sama nanti dipakai
      // login akun tenant lain (bukan cuma daftar ulang tenant yang sama).
      await db.products.clear().catch(() => {});
      await db.memberships.clear().catch(() => {});
      await db.pendingTransactions.clear().catch(() => {});

      await createClient().auth.signOut().catch(() => {});
      router.push("/register");
    } catch {
      setDeleteError("Terjadi kesalahan jaringan. Silakan coba lagi.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="card p-5 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Pengaturan Kafe</h1>
        <p className="text-sm text-neutral-500">Informasi kafe dan opsi struk cetak</p>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-neutral-900 text-sm">Logo Kafe / Struk</h2>
        <p className="text-xs text-neutral-500 -mt-2">
          Tampil di bagian atas struk cetak. Format PNG/JPG/WebP, maksimal 5MB.
        </p>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl border border-neutral-200 bg-neutral-50 flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo kafe" className="w-full h-full object-contain" />
            ) : (
              <ImagePlus size={22} className="text-neutral-300" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={logoUploading}
                className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-60"
              >
                {logoUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {logoUrl ? "Ganti Logo" : "Unggah Logo"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  disabled={logoUploading}
                  className="text-sm py-1.5 px-3 rounded-xl text-urgent border border-urgent/30 hover:bg-urgent-light flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  Hapus
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoUpload(file);
                e.target.value = "";
              }}
            />
            {logoError && <p className="text-xs text-urgent">{logoError}</p>}
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-neutral-900 text-sm">Informasi Kafe</h2>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Kafe</label>
          <input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">No. Telepon</label>
          <input value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} className="input-field" />
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-neutral-900 text-sm">Lebar Kertas Printer Struk</h2>
          <p className="text-xs text-neutral-500">
            Sesuaikan dengan printer thermal di kasir (mis. printer &quot;POS-58&quot; = pilih 58mm). Salah
            pilih di sini membuat struk kepotong saat dicetak.
          </p>
        </div>
        <div className="flex gap-3">
          {(["58mm", "80mm"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setSettings({ ...settings, receiptPaperWidth: w })}
              className={
                settings.receiptPaperWidth === w
                  ? "flex-1 rounded-xl border-2 border-primary bg-primary-light text-primary-dark font-semibold text-sm py-2.5"
                  : "flex-1 rounded-xl border border-neutral-200 text-neutral-600 text-sm py-2.5"
              }
            >
              {w}
            </button>
          ))}
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

      <div className="space-y-2">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saved ? "Tersimpan!" : saving ? "Menyimpan..." : "Simpan Perubahan"}
        </button>
        {saveError && <p className="text-sm text-urgent">{saveError}</p>}
      </div>

      <div className="card p-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-neutral-900 text-sm">Import / Migrasi Data</h2>
          <p className="text-xs text-neutral-500">Pindahkan menu dari POS/aplikasi lain lewat file CSV/Excel</p>
        </div>
        <Link href="/dashboard/settings/import" className="btn-outline text-sm py-1.5 px-3 whitespace-nowrap">
          Buka
        </Link>
      </div>

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
