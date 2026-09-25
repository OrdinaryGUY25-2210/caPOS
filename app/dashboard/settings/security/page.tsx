'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Smartphone, LogOut, KeyRound } from 'lucide-react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/Skeleton';
import { createClient } from '@/lib/supabase/client';

/**
 * Sebelumnya halaman ini full mock (sesi "Chrome - Windows" palsu, tombol
 * 2FA/API Keys tidak melakukan apa-apa) karena dikira butuh tabel
 * database baru yang belum ada. Ternyata untuk 2FA & sesi, tabel baru itu
 * TIDAK PERLU — Supabase Auth sudah punya MFA TOTP bawaan
 * (supabase.auth.mfa.*) dan sesi yang sedang berjalan bisa dibaca lewat
 * auth.getSession(), tanpa skema tambahan sama sekali. Jadi dua bagian
 * itu sekarang beneran fungsional.
 *
 * "Sesi Aktif" jujur cuma menampilkan SESI DI PERANGKAT INI — Supabase
 * tidak punya endpoint client-side untuk daftar semua sesi di semua
 * perangkat (itu butuh service-role key + tabel refresh-token, di luar
 * cakupan halaman pengaturan biasa), jadi tidak dipalsukan jadi daftar
 * multi-device seperti sebelumnya.
 *
 * API Keys TETAP "Belum tersedia" — beda dari 2FA/Sesi, ini genuinely
 * butuh infrastruktur baru (generate+hash key, endpoint yang bisa
 * memverifikasinya), bukan sekadar baca/tulis 1 tabel. Menandainya siap
 * pakai tanpa backend itu akan lebih berbahaya daripada jujur bilang
 * belum ada.
 */

interface TotpFactor {
  id: string;
  friendly_name?: string | null;
  status: string;
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Alur enroll 2FA
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [unenrollingId, setUnenrollingId] = useState<string | null>(null);

  // Sesi saat ini
  const [sessionInfo, setSessionInfo] = useState<{ expiresAt: string | null; userAgent: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function loadFactors() {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      return;
    }
    setFactors((data?.totp ?? []) as TotpFactor[]);
  }

  useEffect(() => {
    (async () => {
      await loadFactors();
      const { data } = await supabase.auth.getSession();
      setSessionInfo({
        expiresAt: data.session?.expires_at ? new Date(data.session.expires_at * 1000).toLocaleString('id-ID') : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setError(null);
    setEnrolling(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'caPOS',
    });
    setEnrolling(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    if (!data?.id || !data.totp?.qr_code) {
      // Supabase project ini kemungkinan belum mengaktifkan TOTP MFA
      // (Authentication > MFA di dashboard Supabase), atau respons tidak
      // sesuai dugaan — jangan diam saja, kasih tahu apa yang terjadi.
      setError('Tidak bisa memulai pendaftaran 2FA. Pastikan TOTP MFA sudah diaktifkan di project Supabase (Authentication > MFA), lalu coba lagi.');
      return;
    }
    setPendingFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret ?? null);
  }

  function cancelEnroll() {
    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setOtpCode('');
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFactorId) return;
    setVerifying(true);
    setError(null);

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: pendingFactorId,
    });
    if (challengeError) {
      setVerifying(false);
      setError(challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challenge.id,
      code: otpCode.trim(),
    });

    setVerifying(false);
    if (verifyError) {
      setError('Kode salah atau kedaluwarsa: ' + verifyError.message);
      return;
    }

    cancelEnroll();
    await loadFactors();
  }

  async function handleUnenroll(factorId: string) {
    setUnenrollingId(factorId);
    setError(null);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    setUnenrollingId(null);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }
    await loadFactors();
  }

  async function handleSignOutHere() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
  }

  const verifiedFactor = factors.find((f) => f.status === 'verified');

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Keamanan" description="Kelola keamanan akun Anda" />
        <div className="card p-6 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Keamanan" description="Kelola keamanan akun Anda" />

      <Alert
        variant="info"
        title="Ganti password"
        message="Untuk ganti password, gunakan bagian Profil."
      />

      {error && <Alert variant="error" message={error} />}

      <SettingsCard title="Autentikasi Dua Faktor" description="Tambahkan lapisan keamanan ekstra dengan aplikasi authenticator (Google Authenticator, Authy, dsb.)">
        {verifiedFactor ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-700 flex items-center gap-2">
              <ShieldCheck size={16} className="text-primary" />
              2FA aktif{verifiedFactor.friendly_name ? ` — ${verifiedFactor.friendly_name}` : ''}
            </p>
            <Button
              variant="outline"
              size="sm"
              loading={unenrollingId === verifiedFactor.id}
              onClick={() => handleUnenroll(verifiedFactor.id)}
            >
              Nonaktifkan
            </Button>
          </div>
        ) : qrCode ? (
          <form onSubmit={confirmEnroll} className="space-y-4">
            <p className="text-sm text-neutral-600">
              Pindai kode QR ini dengan aplikasi authenticator, lalu masukkan kode 6 digit yang muncul untuk mengaktifkan.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="QR kode 2FA" className="w-40 h-40 border border-neutral-200 rounded-lg shrink-0" />
              <div className="space-y-2 flex-1 min-w-0">
                {secret && (
                  <p className="text-xs text-neutral-500 break-all">
                    Tidak bisa memindai? Masukkan manual: <span className="font-mono">{secret}</span>
                  </p>
                )}
                <Input
                  label="Kode 6 digit"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" size="sm" loading={verifying} disabled={otpCode.length < 6}>
                    Verifikasi & Aktifkan
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={cancelEnroll} disabled={verifying}>
                    Batal
                  </Button>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">Belum aktif.</p>
            <Button variant="primary" size="sm" loading={enrolling} onClick={startEnroll}>
              Aktifkan 2FA
            </Button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Sesi Aktif" description="Sesi login di perangkat ini">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 text-sm text-neutral-700 min-w-0">
            <Smartphone size={16} className="text-neutral-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate">{sessionInfo?.userAgent || 'Perangkat ini'}</p>
              {sessionInfo?.expiresAt && (
                <p className="text-xs text-neutral-400">Sesi berlaku sampai {sessionInfo.expiresAt}</p>
              )}
              <p className="text-xs text-neutral-400 mt-1">
                caPOS belum bisa menampilkan daftar sesi di perangkat lain — hanya sesi di perangkat ini.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" loading={signingOut} onClick={handleSignOutHere}>
            <LogOut size={14} /> Keluar dari sesi ini
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="API Keys" description="Kelola API keys untuk integrasi">
        <p className="text-sm text-gray-600 flex items-center gap-2">
          <KeyRound size={15} className="text-neutral-400" />
          Belum tersedia — fitur ini butuh infrastruktur otentikasi API terpisah (pembuatan, penyimpanan aman, dan
          verifikasi key) yang belum dibangun.
        </p>
      </SettingsCard>
    </div>
  );
}
