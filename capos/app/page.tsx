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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Email atau password salah. Silakan coba lagi.");
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
      </div>
    </main>
  );
}
