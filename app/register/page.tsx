"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coffee, Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/PasswordInput";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    cafeName: "",
    ownerName: "",
    email: "",
    password: "",
    confirmPassword: "",
    referralCode: "",
  });
  const [loading, setLoading] = useState(false);
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  // --- OTP state ---
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Dicek dulu di client untuk feedback instan — server tetap validasi
    // ulang semuanya di /api/register, jadi ini murni buat UX, bukan
    // satu-satunya lapisan keamanan.
    if (form.password !== form.confirmPassword) {
      setError("Konfirmasi password tidak cocok dengan password di atas.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result.message || "Pendaftaran gagal. Silakan coba lagi.");
        setLoading(false);
        return;
      }

      setRegisteredEmail(form.email);
      setShowOtpForm(true);
      setLoading(false);
    } catch {
      setError("Terjadi kesalahan jaringan. Silakan coba lagi.");
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    setVerifying(true);

    const supabase = createClient();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: registeredEmail,
      token: otp.trim(),
      type: "signup",
    });

    if (verifyError || !data.session) {
      setOtpError(
        verifyError?.message.toLowerCase().includes("expired")
          ? "Kode OTP sudah kedaluwarsa. Klik \"Kirim ulang kode\" di bawah."
          : "Kode OTP salah. Periksa kembali kode dari email Anda."
      );
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
    router.push(roleHome[profile?.role ?? "owner"] ?? "/dashboard");
  }

  async function resendOtp() {
    setResending(true);
    setOtpError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email: registeredEmail });
    setResending(false);
    if (error) {
      setOtpError("Gagal mengirim ulang kode. Coba beberapa saat lagi.");
      return;
    }
    setResent(true);
    setTimeout(() => setResent(false), 5000);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-sm">
            <Coffee className="text-white" size={28} strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">Daftar caPOS</h1>
          <p className="text-sm text-neutral-500 text-center">
            Mulai kelola kafe Anda — gratis 28 hari, tanpa kartu kredit
          </p>
        </div>

        {showOtpForm ? (
          <form onSubmit={handleVerifyOtp} className="card p-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2 mb-2">
              <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center">
                <MailCheck className="text-primary-dark" size={24} />
              </div>
              <p className="font-semibold text-neutral-900">Masukkan Kode OTP</p>
              <p className="text-sm text-neutral-500">
                Kami sudah mengirim kode ke{" "}
                <span className="font-medium text-neutral-700">{registeredEmail}</span>.
                Masukkan kodenya di bawah untuk mengaktifkan akun.
              </p>
            </div>

            {otpError && (
              <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{otpError}</div>
            )}

            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="input-field text-center text-xl sm:text-2xl tracking-[0.3em] font-mono"
            />

            <button
              type="submit"
              disabled={verifying || otp.length < 6}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {verifying && <Loader2 className="animate-spin" size={16} />}
              Verifikasi & Masuk
            </button>

            <button
              type="button"
              onClick={resendOtp}
              disabled={resending}
              className="w-full text-center text-sm text-primary font-medium hover:underline"
            >
              {resending ? "Mengirim..." : resent ? "Kode terkirim ulang ✓" : "Kirim ulang kode"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="card p-6 space-y-4">
            {error && (
              <div className="badge-urgent w-full justify-start px-3 py-2 rounded-lg">{error}</div>
            )}

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Kafe</label>
              <input
                required
                value={form.cafeName}
                onChange={(e) => setForm({ ...form, cafeName: e.target.value })}
                placeholder="Kafe Senja"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Pemilik</label>
              <input
                required
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                placeholder="Nama Anda"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="owner@kafeanda.com"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Password</label>
              <PasswordInput
                required
                minLength={8}
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                placeholder="Minimal 8 karakter, kombinasi huruf & angka"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Konfirmasi Password</label>
              <PasswordInput
                required
                minLength={8}
                value={form.confirmPassword}
                onChange={(v) => setForm({ ...form, confirmPassword: v })}
                placeholder="Ulangi password di atas"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">
                Kode Referral <span className="text-neutral-400 font-normal">(opsional)</span>
              </label>
              <input
                value={form.referralCode}
                onChange={(e) => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
                placeholder="Punya kode teman? Masukkan di sini"
                className="input-field uppercase tracking-wide"
                maxLength={20}
              />
              <p className="text-xs text-neutral-400 mt-1">
                Pakai kode referral dapat diskon 2% untuk pembayaran pertama Anda.
              </p>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading && <Loader2 className="animate-spin" size={16} />}
              Daftar Sekarang
            </button>

            <p className="text-center text-sm text-neutral-500">
              Sudah punya akun?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Masuk
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
