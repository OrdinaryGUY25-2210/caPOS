"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coffee, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
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

    // Direct Role Routing berdasarkan tabel profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const roleHome: Record<string, string> = {
      super_admin: "/admin",
      owner: "/dashboard",
      cashier: "/pos",
    };

    router.push(roleHome[profile?.role ?? "cashier"] ?? "/pos");
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.session.user.id)
      .single();

    const roleHome: Record<string, string> = {
      super_admin: "/admin",
      owner: "/dashboard",
      cashier: "/pos",
    };
    router.push(roleHome[profile?.role ?? "cashier"] ?? "/pos");
  }

  async function resendOtp() {
    const supabase = createClient();
    await supabase.auth.resend({ type: "signup", email });
    setResent(true);
    setTimeout(() => setResent(false), 5000);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-sm">
            <Coffee className="text-white" size={28} strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">caPOS</h1>
          <p className="text-sm text-neutral-500">Point of Sale Kafe by Studio D13</p>
        </div>

        {unconfirmed ? (
          <form onSubmit={handleVerifyOtp} className="card p-6 space-y-4">
            <div>
              <p className="font-semibold text-neutral-900">Masukkan Kode OTP</p>
              <p className="text-sm text-neutral-500 mt-1">
                Akun <span className="font-medium text-neutral-700">{email}</span> belum
                diverifikasi. Kami baru saja mengirim kode 6 digit ke email tersebut.
              </p>
            </div>

            {otpError && (
              <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{otpError}</div>
            )}

            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="input-field text-center text-2xl tracking-[0.5em] font-mono"
            />

            <button
              type="submit"
              disabled={verifying || otp.length !== 6}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {verifying && <Loader2 className="animate-spin" size={16} />}
              Verifikasi & Masuk
            </button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => setUnconfirmed(false)} className="text-neutral-500 hover:underline">
                Kembali ke login
              </button>
              <button type="button" onClick={resendOtp} className="text-primary font-medium hover:underline">
                {resent ? "Terkirim ulang ✓" : "Kirim ulang kode"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="card p-6 space-y-4">
            {error && (
              <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@kafeanda.com"
                className="input-field"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading && <Loader2 className="animate-spin" size={16} />}
              Masuk
            </button>

            <p className="text-center text-sm text-neutral-500">
              Belum punya akun?{" "}
              <Link href="/register" className="text-primary font-medium hover:underline">
                Daftar dengan Kode Akses
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
