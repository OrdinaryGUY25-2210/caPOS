import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,'&()-]{2,80}$/u;

function sanitize(input: unknown, max = 200) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

/**
 * Memastikan pemanggil request ini benar-benar sudah login DAN berperan
 * sebagai owner/super_admin — mencegah endpoint ini dipakai sembarang
 * orang yang kebetulan tahu URL-nya untuk membuat akun baru di tenant
 * manapun (Broken Access Control / OWASP A01).
 */
async function requireOwnerOrAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "UNAUTHORIZED" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "owner" && profile.role !== "super_admin")) {
    return { error: "FORBIDDEN" as const };
  }

  return { profile };
}

export async function POST(request: Request) {
  const auth = await requireOwnerOrAdmin();
  if ("error" in auth) {
    return NextResponse.json(
      { message: "Anda tidak punya izin membuat akun kasir." },
      { status: auth.error === "UNAUTHORIZED" ? 401 : 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const fullName = sanitize(body.fullName, 80);
  const email = sanitize(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  const errors: string[] = [];
  if (!SAFE_TEXT_RE.test(fullName)) errors.push("Nama tidak valid.");
  if (!EMAIL_RE.test(email)) errors.push("Format email tidak valid.");
  if (password.length < 8) errors.push("Password minimal 8 karakter.");
  if (errors.length > 0) {
    return NextResponse.json({ message: errors.join(" ") }, { status: 400 });
  }

  const supabase = serviceClient();

  // Akun kasir dibuat langsung terkonfirmasi (email_confirm: true) karena
  // yang membuatkan adalah owner-nya sendiri (bukan pendaftaran publik),
  // owner sudah tahu & mempercayai email kasirnya — beda kasus dengan
  // /api/register yang publik dan wajib verifikasi email asli.
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    return NextResponse.json(
      { message: authError?.message.includes("already registered") ? "Email sudah terdaftar." : "Gagal membuat akun kasir." },
      { status: 400 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: auth.profile.tenant_id,
    role: "cashier",
    full_name: fullName,
    email,
  });

  if (profileError) {
    // Bersihkan auth user kalau insert profile gagal, biar tidak ada akun
    // "yatim" tanpa profil/tenant.
    await supabase.auth.admin.deleteUser(authUser.user.id);

    // Trigger database enforce_cashier_limit() melempar pesan berawalan
    // "FREE_TIER_CASHIER_LIMIT:" — teruskan pesan itu ke client supaya
    // bisa ditampilkan sebagai upsell yang jelas, bukan error generik.
    if (profileError.message.includes("FREE_TIER_CASHIER_LIMIT")) {
      return NextResponse.json(
        { message: "Paket Free Trial maksimal 2 akun kasir. Upgrade ke Pro untuk tambah kasir.", reason: "FREE_TIER_CASHIER_LIMIT" },
        { status: 403 }
      );
    }

    return NextResponse.json({ message: "Gagal menyimpan data kasir." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const auth = await requireOwnerOrAdmin();
  if ("error" in auth) {
    return NextResponse.json(
      { message: "Anda tidak punya izin menghapus akun kasir." },
      { status: auth.error === "UNAUTHORIZED" ? 401 : 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const cashierId = searchParams.get("id");
  if (!cashierId) {
    return NextResponse.json({ message: "ID kasir wajib diisi." }, { status: 400 });
  }

  const supabase = serviceClient();

  // Pastikan kasir yang mau dihapus benar-benar anggota tenant milik
  // pemanggil — mencegah owner tenant A menghapus akun kasir tenant B
  // walau tahu/menebak ID-nya (Insecure Direct Object Reference).
  const { data: target } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", cashierId)
    .single();

  if (!target || target.tenant_id !== auth.profile.tenant_id || target.role !== "cashier") {
    return NextResponse.json({ message: "Kasir tidak ditemukan di tenant Anda." }, { status: 404 });
  }

  // Menghapus auth user otomatis ikut menghapus baris profiles (ON DELETE
  // CASCADE di schema.sql).
  const { error } = await supabase.auth.admin.deleteUser(cashierId);
  if (error) {
    return NextResponse.json({ message: "Gagal menghapus akun kasir." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
