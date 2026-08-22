"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coffee, Loader2, KeyRound, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resent, setResent] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);

    setLoading(false);

    // Selalu tampilkan layar sukses walau email tidak terdaftar — kalau
    // pesan error dibedakan antara "email ada" vs "email tidak ada", itu
    // membocorkan daftar akun terdaftar ke siapa pun yang iseng coba-coba
    // (OWASP A07: user enumeration). Yang benar-benar tidak terdaftar
    // cukup tidak akan menerima kode apa pun.
    if (resetError) {
      console.error("resetPasswordForEmail failed", resetError);
    }
    setStep("reset");
  }

  async function resendOtp() {
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email);
    setResent(true);
    setTimeout(() => setResent(false), 5000);
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError("Password baru minimal 8 karakter, kombinasi huruf & angka.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Verifikasi kode OTP reset (type: "recovery") — kalau benar, sesi
    // langsung aktif sehingga updateUser() di bawah bisa langsung dipanggil
    // tanpa perlu login ulang manual.
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp.trim(),
      type: "recovery",
    });

    if (verifyError || !data.session) {
      setError("Kode OTP salah atau kedaluwarsa. Periksa lagi atau kirim ulang kode.");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setError("Gagal mengubah password. Silakan coba lagi.");
      setLoading(false);
      return;
    }

    // Password berhasil diganti & sesi sudah aktif — langsung arahkan
    // sesuai role, tidak perlu login ulang manual.
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

        {step === "email" ? (
          <form onSubmit={requestOtp} className="card p-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2 mb-2">
              <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center">
                <KeyRound className="text-primary-dark" size={22} />
              </div>
              <p className="font-semibold text-neutral-900">Lupa Password</p>
              <p className="text-sm text-neutral-500">
                Masukkan email akun kamu. Kami akan kirim kode OTP untuk atur password baru.
              </p>
            </div>

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

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading && <Loader2 className="animate-spin" size={16} />}
              Kirim Kode OTP
            </button>

            <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-neutral-500 hover:underline">
              <ArrowLeft size={14} /> Kembali ke login
            </Link>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="card p-6 space-y-4">
            <div className="text-center mb-2">
              <p className="font-semibold text-neutral-900">Masukkan Kode & Password Baru</p>
              <p className="text-sm text-neutral-500 mt-1">
                Kode 6 digit sudah dikirim ke <span className="font-medium text-neutral-700">{email}</span>.
                Kalau tidak terdaftar, tidak ada kode yang akan diterima.
              </p>
            </div>

            {error && (
              <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{error}</div>
            )}

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Kode OTP</label>
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
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Password Baru</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimal 8 karakter, huruf & angka"
                className="input-field"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Konfirmasi Password Baru</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading && <Loader2 className="animate-spin" size={16} />}
              Ubah Password & Masuk
            </button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => setStep("email")} className="text-neutral-500 hover:underline">
                Ganti email
              </button>
              <button type="button" onClick={resendOtp} className="text-primary font-medium hover:underline">
                {resent ? "Terkirim ulang ✓" : "Kirim ulang kode"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
