"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChefHat, Loader2, Store, WifiOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_HOME } from "@/lib/role";
import PasswordInput from "@/components/PasswordInput";

// Poin singkat di panel kiri (desktop). Isinya diambil dari fitur nyata caPOS
// — sama seperti yang dijanjikan di halaman website — bukan teks pengisi.
const HIGHLIGHTS = [
  { icon: WifiOff, title: "Tetap jualan saat internet mati", text: "Transaksi disimpan di perangkat, tersinkron otomatis begitu online." },
  { icon: ChefHat, title: "Pesanan langsung sampai dapur", text: "Kasir kirim, dapur lihat saat itu juga." },
  { icon: Store, title: "Satu akun, semua cabang", text: "Laporan tiap cabang terkumpul otomatis." },
];

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

  // --- OTP inline state (muncul kalau login gagal karena belum verifikasi) ---
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    // /pos & /dashboard layout.tsx mengarahkan ke sini dengan ?deactivated=1
    // begitu profiles.is_active = false, tapi redirect() di server component
    // TIDAK menghapus sesi Supabase yang tersimpan di browser. Sign-out paksa
    // di sini supaya sesi lokal akun yang dinonaktifkan benar-benar berakhir,
    // lalu tampilkan alasannya.
    if (searchParams.get("deactivated") === "1") {
      createClient().auth.signOut();
      setError("Akun ini sudah dinonaktifkan oleh Owner. Hubungi Owner kafe Anda kalau ini keliru.");
    }
  }, [searchParams]);

  // Direct Role Routing berdasarkan tabel profiles. Tujuan tiap role diambil
  // dari ROLE_HOME (lib/role.ts) — satu sumber kebenaran, sudah mencakup
  // Supervisor (/dashboard) dan Dapur (/kitchen).
  async function goToRoleHome(userId: string) {
    const supabase = createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    router.push(ROLE_HOME[profile?.role ?? "cashier"] ?? "/pos");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUnconfirmed(false);
    setResent(false);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Supabase mengembalikan pesan "Email not confirmed" persis begitu
      // saat user belum memasukkan kode OTP dari emailnya.
      if (authError.message.toLowerCase().includes("email not confirmed")) {
        setUnconfirmed(true);
        // Kirim kode OTP baru begitu status "belum konfirmasi" terdeteksi,
        // supaya user tidak perlu klik "kirim ulang" secara manual dulu.
        await supabase.auth.resend({ type: "signup", email });
      } else {
        setError("Email atau password salah. Silakan coba lagi.");
      }
      setLoading(false);
      return;
    }

    await goToRoleHome(data.user.id);
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    setVerifying(true);

    const supabase = createClient();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp.trim(),
      type: "signup",
    });

    if (verifyError || !data.session) {
      setOtpError("Kode OTP salah atau kedaluwarsa. Periksa lagi atau kirim ulang.");
      setVerifying(false);
      return;
    }

    await goToRoleHome(data.session.user.id);
  }

  async function resendOtp() {
    const supabase = createClient();
    await supabase.auth.resend({ type: "signup", email });
    setResent(true);
    setTimeout(() => setResent(false), 5000);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-emerald-50 via-white to-white">
      {/* Cahaya hijau lembut di belakang kartu — sama seperti hero website */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/4 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 sm:px-8">
        {/* Header merek, sejajar dengan navbar website */}
        <header className="flex items-center gap-2.5 py-5">
          <Image
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            priority
            className="h-9 w-9 rounded-xl"
          />
          <span className="text-xl font-bold text-neutral-900">caPOS</span>
        </header>

        <div className="flex flex-1 items-center justify-center gap-16 pb-12 pt-2 lg:justify-between">
          {/* Panel kiri — hanya desktop */}
          <section className="hidden max-w-xl lg:block">
            <span className="inline-flex items-center rounded-full bg-primary-light px-3.5 py-1.5 text-sm font-medium text-primary-dark">
              Dibuat oleh Studio D13
            </span>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.08] tracking-tight text-neutral-900">
              Masuk, lalu
              <br />
              <span className="text-primary">langsung jualan.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-neutral-500">
              Buka kasir, pantau dapur, dan cek laporan hari ini dari satu akun caPOS.
            </p>

            <ul className="mt-10 space-y-5">
              {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-dark">
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <div>
                    <p className="font-semibold text-neutral-900">{title}</p>
                    <p className="text-sm leading-relaxed text-neutral-500">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Kartu form */}
          <div className="w-full max-w-md">
            {unconfirmed ? (
              <form
                onSubmit={handleVerifyOtp}
                className="card space-y-5 p-6 shadow-xl shadow-neutral-900/5 sm:p-8"
              >
                <div>
                  <h2 className="text-xl font-bold text-neutral-900">Masukkan kode OTP</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">
                    Akun <span className="font-medium text-neutral-700">{email}</span> belum
                    diverifikasi. Kami baru saja mengirim kode 6 digit ke email tersebut.
                  </p>
                </div>

                {otpError && (
                  <div role="alert" className="badge-urgent w-full justify-start rounded-lg px-3 py-2 text-sm leading-snug">
                    {otpError}
                  </div>
                )}

                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="input-field text-center font-mono text-xl tracking-[0.3em] sm:text-2xl"
                />

                <button
                  type="submit"
                  disabled={verifying || otp.length < 6}
                  className="btn-primary flex w-full items-center justify-center gap-2 py-3"
                >
                  {verifying && <Loader2 className="animate-spin" size={16} />}
                  Verifikasi & Masuk
                </button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => setUnconfirmed(false)}
                    className="text-neutral-500 hover:underline"
                  >
                    Kembali ke login
                  </button>
                  <button
                    type="button"
                    onClick={resendOtp}
                    className="font-medium text-primary hover:underline"
                  >
                    {resent ? "Terkirim ulang ✓" : "Kirim ulang kode"}
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={handleLogin}
                className="card space-y-5 p-6 shadow-xl shadow-neutral-900/5 sm:p-8"
              >
                <div>
                  <h2 className="text-xl font-bold text-neutral-900">Masuk ke akun caPOS</h2>
                  <p className="mt-1.5 text-sm text-neutral-500">
                    Pakai email dan password yang terdaftar.
                  </p>
                </div>

                {error && (
                  <div role="alert" className="badge-urgent w-full justify-start rounded-lg px-3 py-2 text-sm leading-snug">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-neutral-700">
                    Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@kafeanda.com"
                    className="input-field"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="login-password" className="text-sm font-medium text-neutral-700">
                      Password
                    </label>
                    <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                      Lupa password?
                    </Link>
                  </div>
                  <PasswordInput
                    id="login-password"
                    required
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex w-full items-center justify-center gap-2 py-3"
                >
                  {loading && <Loader2 className="animate-spin" size={16} />}
                  Masuk
                </button>

                <p className="text-center text-sm text-neutral-500">
                  Belum punya akun?{" "}
                  <Link href="/register" className="font-medium text-primary hover:underline">
                    Coba gratis 28 hari
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
