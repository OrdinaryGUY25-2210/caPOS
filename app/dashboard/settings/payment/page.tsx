'use client';

import { useEffect, useState } from 'react';
import { ScanLine, Volume2, Upload } from 'lucide-react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/Skeleton';
import PasswordInput from '@/components/PasswordInput';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';
import { useBranch } from '@/lib/branchContext';
import { SOUND_TONES, unlockNotificationAudio, playNotificationSound } from '@/lib/notificationSound';

// migration_018 menambah tabel payment_methods_config (1 baris per
// tenant). Sebelumnya checkbox di halaman ini hardcoded/disabled karena
// memang belum ada tabelnya sama sekali — sekarang baca/tulis baris asli,
// dengan default (cash/kartu/e-wallet ON, transfer bank OFF) dipakai
// kalau tenant belum pernah menyimpan (belum ada baris).
interface MethodsState {
  cash: boolean;
  card: boolean;
  ewallet: boolean;
  bankTransfer: boolean;
}

const DEFAULT_METHODS: MethodsState = { cash: true, card: true, ewallet: true, bankTransfer: false };

// PRD "Pengaturan QRIS Self-Service & Storage Audio Notifikasi" —
// migration_022. QRIS & audio di-scope PER CABANG (branches), bukan per
// tenant seperti Tunai/Kartu/dst. di atas, karena Midtrans key memang
// sudah didesain BYOK per cabang di kode yang sudah ada (webhook
// notifikasi baca branches.midtrans_server_key) — satu tenant dengan 3
// cabang bisa saja pakai 3 akun Midtrans berbeda.
interface QrisSettingsState {
  qrisMode: 'DYNAMIC' | 'STATIC';
  midtransClientKey: string;
  midtransIsProduction: boolean;
  hasServerKey: boolean;
  staticQrisImageUrl: string | null;
  soundEnabled: boolean;
  soundTone: string;
  soundVolume: number;
}

const EMPTY_QRIS: QrisSettingsState = {
  qrisMode: 'DYNAMIC',
  midtransClientKey: '',
  midtransIsProduction: false,
  hasServerKey: false,
  staticQrisImageUrl: null,
  soundEnabled: true,
  soundTone: 'bell_chime',
  soundVolume: 0.8,
};

export default function PaymentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [methods, setMethods] = useState<MethodsState>(DEFAULT_METHODS);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // --- QRIS & Audio (per cabang) ---
  const { branches, ownBranchId, loading: branchesLoading } = useBranch();
  const [selectedBranchForQris, setSelectedBranchForQris] = useState<string | null>(null);
  const [qris, setQris] = useState<QrisSettingsState>(EMPTY_QRIS);
  const [qrisServerKeyInput, setQrisServerKeyInput] = useState('');
  const [qrisLoading, setQrisLoading] = useState(true);
  const [qrisSaving, setQrisSaving] = useState(false);
  const [qrisUploading, setQrisUploading] = useState(false);
  const [qrisStatus, setQrisStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function load() {
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setCanEdit(profile.role === 'owner' || profile.role === 'manager' || profile.role === 'super_admin');
    setTenantId(profile.tenant_id);

    const supabase = createClient();
    const { data: row } = await supabase
      .from('payment_methods_config')
      .select('cash_enabled, card_enabled, ewallet_enabled, bank_transfer_enabled')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();

    setMethods(
      row
        ? {
            cash: row.cash_enabled,
            card: row.card_enabled,
            ewallet: row.ewallet_enabled,
            bankTransfer: row.bank_transfer_enabled,
          }
        : DEFAULT_METHODS
    );

    // Kasir/manager cabang tertentu -> langsung terkunci ke cabangnya
    // sendiri (tidak ada pilihan). Owner/super_admin (branch_id null)
    // -> pilih cabang mana yang mau diatur, default cabang pertama.
    if (profile.branch_id) {
      setSelectedBranchForQris(profile.branch_id);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Owner/super_admin: begitu daftar cabang selesai dimuat, pilih cabang
  // pertama sebagai default kalau belum ada yang terpilih.
  useEffect(() => {
    if (!selectedBranchForQris && !branchesLoading && branches.length > 0) {
      setSelectedBranchForQris(ownBranchId ?? branches[0].id);
    }
  }, [branchesLoading, branches, ownBranchId, selectedBranchForQris]);

  async function loadQrisSettings(branchId: string) {
    setQrisLoading(true);
    setQrisStatus(null);
    try {
      const res = await fetch(`/api/branches/${branchId}/qris-settings`);
      const data = await res.json();
      if (!res.ok) {
        setQrisStatus({ type: 'error', message: data.message ?? 'Gagal memuat pengaturan QRIS.' });
        setQris(EMPTY_QRIS);
      } else {
        setQris({
          qrisMode: data.qris_mode ?? 'DYNAMIC',
          midtransClientKey: data.midtrans_client_key ?? '',
          midtransIsProduction: !!data.midtrans_is_production,
          hasServerKey: !!data.has_server_key,
          staticQrisImageUrl: data.static_qris_image_url ?? null,
          soundEnabled: data.sound_enabled ?? true,
          soundTone: data.sound_tone ?? 'bell_chime',
          soundVolume: data.sound_volume ?? 0.8,
        });
      }
    } catch {
      setQrisStatus({ type: 'error', message: 'Gagal terhubung ke server.' });
    }
    setQrisServerKeyInput('');
    setQrisLoading(false);
  }

  useEffect(() => {
    if (selectedBranchForQris) loadQrisSettings(selectedBranchForQris);
  }, [selectedBranchForQris]);

  async function handleCancel() {
    setStatus(null);
    setLoading(true);
    await load();
  }

  function toggle(key: keyof MethodsState) {
    if (!canEdit) return;
    setMethods((prev) => ({ ...prev, [key]: !prev[key] }));
    setStatus(null);
  }

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.from('payment_methods_config').upsert({
      tenant_id: tenantId,
      cash_enabled: methods.cash,
      card_enabled: methods.card,
      ewallet_enabled: methods.ewallet,
      bank_transfer_enabled: methods.bankTransfer,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    if (error) {
      setStatus({ type: 'error', message: 'Gagal menyimpan: ' + error.message });
      return;
    }
    setStatus({ type: 'success', message: 'Metode pembayaran tersimpan.' });
  }

  async function handleUploadStaticQris(file: File) {
    if (!tenantId || !file) return;
    if (file.size > 2 * 1024 * 1024) {
      setQrisStatus({ type: 'error', message: 'Ukuran gambar maksimal 2MB (PRD §4A).' });
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setQrisStatus({ type: 'error', message: 'Format harus JPG atau PNG.' });
      return;
    }
    setQrisUploading(true);
    setQrisStatus(null);

    const supabase = createClient();
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${tenantId}/qris-code.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('menu-images')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setQrisUploading(false);
      setQrisStatus({
        type: 'error',
        message:
          'Upload gagal: ' +
          uploadError.message +
          " — pastikan bucket Storage 'menu-images' sudah dibuat & diset Public di Supabase Dashboard.",
      });
      return;
    }

    const { data: pub } = supabase.storage.from('menu-images').getPublicUrl(path);
    // Tambahkan cache-buster supaya <img> di halaman ini & di
    // /order/[branch]/[table] langsung menampilkan gambar baru, bukan
    // versi lama yang ter-cache browser (path-nya sama persis setiap
    // upload ulang, upsert:true menimpa file yang sama).
    const bustedUrl = `${pub.publicUrl}?v=${Date.now()}`;
    setQris((prev) => ({ ...prev, staticQrisImageUrl: bustedUrl }));
    setQrisUploading(false);

    if (selectedBranchForQris) {
      await fetch(`/api/branches/${selectedBranchForQris}/qris-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ static_qris_image_url: bustedUrl }),
      });
    }
    setQrisStatus({ type: 'success', message: 'Gambar QRIS statis tersimpan.' });
  }

  async function handleSaveQris() {
    if (!selectedBranchForQris) return;
    if (qris.qrisMode === 'DYNAMIC' && !qris.hasServerKey && !qrisServerKeyInput.trim()) {
      setQrisStatus({ type: 'error', message: 'Isi Server Key Midtrans dulu untuk memakai mode QRIS Dinamis.' });
      return;
    }
    if (qris.qrisMode === 'STATIC' && !qris.staticQrisImageUrl) {
      setQrisStatus({ type: 'error', message: 'Unggah gambar QRIS statis dulu untuk memakai mode ini.' });
      return;
    }

    setQrisSaving(true);
    setQrisStatus(null);

    const res = await fetch(`/api/branches/${selectedBranchForQris}/qris-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qris_mode: qris.qrisMode,
        midtrans_client_key: qris.midtransClientKey,
        midtrans_is_production: qris.midtransIsProduction,
        midtrans_server_key: qrisServerKeyInput.trim() || undefined,
        sound_enabled: qris.soundEnabled,
        sound_tone: qris.soundTone,
        sound_volume: qris.soundVolume,
      }),
    });
    const data = await res.json();
    setQrisSaving(false);

    if (!res.ok) {
      setQrisStatus({ type: 'error', message: data.message ?? 'Gagal menyimpan.' });
      return;
    }
    setQrisStatus({ type: 'success', message: 'Pengaturan QRIS & audio tersimpan.' });
    await loadQrisSettings(selectedBranchForQris);
  }

  function handleTestSound() {
    // Klik tombol = gesture user yang sah, jadi sekalian dipakai untuk
    // "melepas kunci" AudioContext (lihat lib/notificationSound.ts) —
    // owner yang cuma mengetes suara di sini pun otomatis membuka jalan
    // untuk notifikasi beneran nanti tanpa perlu klik terpisah.
    unlockNotificationAudio();
    playNotificationSound(qris.soundTone, qris.soundVolume, true);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Pembayaran" description="Atur metode pembayaran yang tersedia" />
        <div className="card p-6 space-y-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-40" />
          ))}
        </div>
      </div>
    );
  }

  const ROWS: { key: keyof MethodsState; label: string; hint?: string }[] = [
    { key: 'cash', label: 'Tunai' },
    { key: 'card', label: 'Kartu Kredit', hint: 'Diproses lewat mesin EDC kasir sendiri' },
    { key: 'ewallet', label: 'E-Wallet' },
    { key: 'bankTransfer', label: 'Transfer Bank' },
  ];

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Pembayaran" description="Atur metode pembayaran yang tersedia" />

      {!canEdit && (
        <Alert variant="info" title="Khusus Owner/Supervisor" message="Kamu bisa melihat pengaturan ini, tapi hanya Owner atau Supervisor yang bisa mengubahnya." />
      )}

      {status && <Alert variant={status.type === 'success' ? 'success' : 'error'} message={status.message} />}

      <SettingsCard title="Metode Pembayaran" description="Pilih metode pembayaran yang diaktifkan di kasir (/pos)">
        <div className="space-y-3">
          {ROWS.map((row) => (
            <label key={row.key} className={"flex items-center gap-2" + (canEdit ? "" : " opacity-60")}>
              <input
                type="checkbox"
                checked={methods[row.key]}
                onChange={() => toggle(row.key)}
                disabled={!canEdit}
                className="w-4 h-4 accent-primary"
              />
              <span>{row.label}</span>
              {row.hint && <span className="text-xs text-neutral-400">— {row.hint}</span>}
            </label>
          ))}
        </div>
      </SettingsCard>

      <div className="flex justify-end gap-3">
        <Button variant="outline" disabled={!canEdit || saving} onClick={handleCancel}>
          Batal
        </Button>
        <Button variant="primary" disabled={!canEdit} loading={saving} onClick={handleSave}>
          Simpan Perubahan
        </Button>
      </div>

      {/* ============ QRIS Self-Service (PRD migration_022) ============ */}
      <div className="pt-2 border-t border-neutral-100" />

      <div>
        <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
          <ScanLine size={18} className="text-neutral-400" /> QRIS Self-Service
        </h2>
        <p className="text-sm text-neutral-500 mt-0.5">
          Pilih satu metode QRIS untuk layar Self-Service pelanggan — Dinamis (Midtrans) atau Statis (gambar toko),
          tidak bisa dua-duanya sekaligus.
        </p>
      </div>

      {branches.length > 1 && (
        <SettingsCard title="Cabang" description="Pengaturan QRIS berlaku per cabang">
          <Select
            value={selectedBranchForQris ?? ''}
            onChange={(e) => setSelectedBranchForQris(e.target.value)}
            disabled={!canEdit}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </SettingsCard>
      )}

      {qrisStatus && <Alert variant={qrisStatus.type === 'success' ? 'success' : 'error'} message={qrisStatus.message} />}

      {qrisLoading || !selectedBranchForQris ? (
        <div className="card p-6 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <>
          <SettingsCard title="Mode QRIS" description="Mengaktifkan salah satu akan mengunci opsi yang lain">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                    qris.qrisMode === 'DYNAMIC' ? 'border-primary bg-primary-light/40' : 'border-neutral-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="qris_mode"
                    className="mt-1 accent-primary"
                    checked={qris.qrisMode === 'DYNAMIC'}
                    disabled={!canEdit}
                    onChange={() => setQris((p) => ({ ...p, qrisMode: 'DYNAMIC' }))}
                  />
                  <div>
                    <p className="font-semibold text-sm text-neutral-900">QRIS Dinamis</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Otomatis via Midtrans — nominal terkunci, konfirmasi instan.</p>
                  </div>
                </label>
                <label
                  className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                    qris.qrisMode === 'STATIC' ? 'border-primary bg-primary-light/40' : 'border-neutral-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="qris_mode"
                    className="mt-1 accent-primary"
                    checked={qris.qrisMode === 'STATIC'}
                    disabled={!canEdit}
                    onChange={() => setQris((p) => ({ ...p, qrisMode: 'STATIC' }))}
                  />
                  <div>
                    <p className="font-semibold text-sm text-neutral-900">QRIS Statis</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Gambar QRIS toko — kasir konfirmasi lunas manual.</p>
                  </div>
                </label>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Kredensial Midtrans"
            description={qris.qrisMode === 'STATIC' ? 'Terkunci — sedang memakai mode QRIS Statis' : 'Wajib diisi untuk mode QRIS Dinamis'}
          >
            <fieldset disabled={qris.qrisMode === 'STATIC' || !canEdit} className={qris.qrisMode === 'STATIC' ? 'opacity-50' : ''}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                    Server Key {qris.hasServerKey && <span className="text-xs font-normal text-primary">(sudah diatur ✓)</span>}
                  </label>
                  <PasswordInput
                    value={qrisServerKeyInput}
                    onChange={setQrisServerKeyInput}
                    placeholder={qris.hasServerKey ? 'Kosongkan untuk tetap pakai yang lama' : 'SB-Mid-server-xxxxxxxxxxxxx'}
                    autoComplete="off"
                  />
                  <p className="text-xs text-neutral-400 mt-1">
                    Rahasia — tidak pernah ditampilkan lagi setelah disimpan, hanya status ada/tidaknya.
                  </p>
                </div>
                <Input
                  label="Client Key"
                  value={qris.midtransClientKey}
                  onChange={(e) => setQris((p) => ({ ...p, midtransClientKey: e.target.value }))}
                  placeholder="SB-Mid-client-xxxxxxxxxxxxx"
                />
              </div>
              <label className="flex items-center gap-2 mt-3 text-sm">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={qris.midtransIsProduction}
                  onChange={(e) => setQris((p) => ({ ...p, midtransIsProduction: e.target.checked }))}
                />
                Mode Produksi (akun Midtrans asli, bukan Sandbox)
              </label>
            </fieldset>
          </SettingsCard>

          <SettingsCard
            title="Gambar QRIS Statis"
            description={qris.qrisMode === 'DYNAMIC' ? 'Terkunci — sedang memakai mode QRIS Dinamis' : 'Format JPG/PNG, maksimal 2MB'}
          >
            <div className={qris.qrisMode === 'DYNAMIC' ? 'opacity-50 pointer-events-none' : ''}>
              <div className="flex items-start gap-4 flex-wrap">
                {qris.staticQrisImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qris.staticQrisImageUrl}
                    alt="QRIS Statis"
                    className="w-32 h-32 object-contain rounded-xl border border-neutral-200 bg-white p-1.5"
                  />
                )}
                <label className="btn-outline inline-flex items-center gap-2 cursor-pointer">
                  <Upload size={15} />
                  {qrisUploading ? 'Mengunggah...' : qris.staticQrisImageUrl ? 'Ganti Gambar' : 'Unggah Gambar'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    disabled={qris.qrisMode === 'DYNAMIC' || !canEdit || qrisUploading}
                    onChange={(e) => e.target.files?.[0] && handleUploadStaticQris(e.target.files[0])}
                  />
                </label>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="Suara Notifikasi Pembayaran" description="Berbunyi otomatis begitu QRIS berhasil dikonfirmasi">
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  disabled={!canEdit}
                  checked={qris.soundEnabled}
                  onChange={(e) => setQris((p) => ({ ...p, soundEnabled: e.target.checked }))}
                />
                Aktifkan suara notifikasi
              </label>

              <fieldset disabled={!qris.soundEnabled || !canEdit} className={!qris.soundEnabled ? 'opacity-50' : ''}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Nada Dering"
                    value={qris.soundTone}
                    onChange={(e) => setQris((p) => ({ ...p, soundTone: e.target.value }))}
                    options={SOUND_TONES.map((t) => ({ value: t.value, label: t.label }))}
                  />
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                      Volume — {Math.round(qris.soundVolume * 100)}%
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(qris.soundVolume * 100)}
                      onChange={(e) => setQris((p) => ({ ...p, soundVolume: Number(e.target.value) / 100 }))}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={handleTestSound}>
                  <Volume2 size={14} /> Tes Suara
                </Button>
              </fieldset>
            </div>
          </SettingsCard>

          {canEdit && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={handleSaveQris} loading={qrisSaving}>
                Simpan Pengaturan QRIS
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
