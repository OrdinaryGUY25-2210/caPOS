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
const ALLOWED_ROLES = ["cashier", "manager"] as const;

function sanitize(input: unknown, max = 200) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

async function requireOwnerOrAdmin() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await (await supabase).auth.getUser();
  if (!user) return { error: "UNAUTHORIZED" as const };

  const { data: profile } = await (await supabase)
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  // Hanya OWNER (bukan manager) yang boleh menambah/menghapus karyawan —
  // manager punya akses dashboard luas, tapi menetapkan siapa jadi manager
  // dan mengelola daftar gaji/akun tetap wewenang Owner saja.
  if (!profile || profile.role !== "owner") {
    if (profile?.role === "super_admin") return { profile };
    return { error: "FORBIDDEN" as const };
  }

  return { profile };
}

export async function POST(request: Request) {
  const auth = await requireOwnerOrAdmin();
  if ("error" in auth) {
    return NextResponse.json(
      { message: "Hanya Owner yang boleh menambah karyawan." },
      { status: auth.error === "UNAUTHORIZED" ? 401 : 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const fullName = sanitize(body.fullName, 80);
  const email = sanitize(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const jobTitle = sanitize(body.jobTitle, 60);
  const role = ALLOWED_ROLES.includes(body.role) ? body.role : "cashier";

  const errors: string[] = [];
  if (!SAFE_TEXT_RE.test(fullName)) errors.push("Nama tidak valid.");
  if (!EMAIL_RE.test(email)) errors.push("Format email tidak valid.");
  if (password.length < 8) errors.push("Password minimal 8 karakter.");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.push("Password harus mengandung huruf dan angka.");
  }
  if (password !== confirmPassword) errors.push("Konfirmasi password tidak cocok.");
  if (errors.length > 0) {
    return NextResponse.json({ message: errors.join(" ") }, { status: 400 });
  }

  const supabase = serviceClient();

  // Akun karyawan langsung terkonfirmasi (email_confirm: true) karena yang
  // membuatkan adalah owner-nya sendiri (bukan pendaftaran publik), dan
  // password-nya sudah password ASLI yang dipilih owner/karyawan bersama
  // (bukan lagi "password sementara" yang wajib diganti nanti).
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    return NextResponse.json(
      { message: authError?.message.includes("already registered") ? "Email sudah terdaftar." : "Gagal membuat akun karyawan." },
      { status: 400 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: auth.profile.tenant_id,
    role,
    full_name: fullName,
    email,
    job_title: jobTitle || null,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(authUser.user.id);

    if (profileError.message.includes("FREE_TIER_CASHIER_LIMIT")) {
      return NextResponse.json(
        { message: "Paket Free Trial maksimal 2 akun karyawan tambahan. Upgrade ke Pro untuk tambah karyawan.", reason: "FREE_TIER_CASHIER_LIMIT" },
        { status: 403 }
      );
    }
    return NextResponse.json({ message: "Gagal menyimpan data karyawan." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const auth = await requireOwnerOrAdmin();
  if ("error" in auth) {
    return NextResponse.json(
      { message: "Hanya Owner yang boleh menghapus karyawan." },
      { status: auth.error === "UNAUTHORIZED" ? 401 : 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("id");
  if (!employeeId) {
    return NextResponse.json({ message: "ID karyawan wajib diisi." }, { status: 400 });
  }

  const supabase = serviceClient();

  const { data: target } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", employeeId)
    .single();

  if (!target || target.tenant_id !== auth.profile.tenant_id || !["cashier", "manager"].includes(target.role)) {
    return NextResponse.json({ message: "Karyawan tidak ditemukan di tenant Anda." }, { status: 404 });
  }

  const { error } = await supabase.auth.admin.deleteUser(employeeId);
  if (error) {
    return NextResponse.json({ message: "Gagal menghapus akun karyawan." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
