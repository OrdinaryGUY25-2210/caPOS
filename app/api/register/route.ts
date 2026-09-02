import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { generateReferralCode } from "@/lib/generateReferralCode";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Anon client: dipakai KHUSUS untuk memanggil auth.signUp(). Ini penting —
// auth.admin.createUser() (lewat service role) TIDAK mengirim email
// verifikasi sama sekali walau email_confirm diset false (perilaku resmi
// Supabase). Yang benar-benar mengirim email konfirmasi adalah signUp()
// biasa, dan itu tidak butuh service role.
function anonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,'&()-]{2,80}$/u;
const REFERRAL_CODE_RE = /^[A-Z0-9]{4,12}$/;

function sanitize(input: unknown, max = 200) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { message: "Terlalu banyak percobaan. Coba lagi dalam 1 menit." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Payload tidak valid." }, { status: 400 });
  }

  const cafeName = sanitize(body.cafeName, 80);
  const ownerName = sanitize(body.ownerName, 80);
  const email = sanitize(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  // Kode referral OPSIONAL — boleh dikosongkan sama sekali.
  const referralCodeInput = sanitize(body.referralCode, 20).toUpperCase();

  const errors: string[] = [];
  if (!SAFE_TEXT_RE.test(cafeName)) errors.push("Nama kafe tidak valid.");
  if (!SAFE_TEXT_RE.test(ownerName)) errors.push("Nama pemilik tidak valid.");
  if (!EMAIL_RE.test(email)) errors.push("Format email tidak valid.");
  if (password.length < 8) errors.push("Password minimal 8 karakter.");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.push("Password harus mengandung huruf dan angka.");
  }
  if (password !== confirmPassword) errors.push("Konfirmasi password tidak cocok.");
  // Cuma divalidasi formatnya kalau memang diisi — kosong itu valid.
  if (referralCodeInput && !REFERRAL_CODE_RE.test(referralCodeInput)) {
    errors.push("Format kode referral tidak valid.");
  }

  if (errors.length > 0) {
    return NextResponse.json({ message: errors.join(" ") }, { status: 400 });
  }

  const supabase = serviceClient();

  // 1. Create tenant — registrasi terbuka untuk siapa saja, tiap orang
  // otomatis dapat 28 hari trial.
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: cafeName })
    .select()
    .single();

  if (tenantError) {
    console.error("tenant insert failed", tenantError);
    return NextResponse.json(
      { message: "Gagal membuat data kafe. Silakan coba lagi." },
      { status: 500 }
    );
  }

  // 2. Cek kode referral SEBELUM membuat subscription, supaya kolom
  // pending_signup_discount_pct / super_trial_ends_at bisa langsung diisi
  // di satu insert (bukan insert lalu update terpisah).
  const subscriptionFields: Record<string, unknown> = { tenant_id: tenant.id };
  let referralOutcome: "none" | "invalid" | "super_admin" | "referrer" = "none";

  if (referralCodeInput) {
    const superAdminCode = process.env.SUPER_ADMIN_REFERRAL_CODE;

    if (superAdminCode && referralCodeInput === superAdminCode.toUpperCase()) {
      // Kode khusus Super Admin: 5 hari akses Supreme penuh + tetap dapat
      // diskon 2% pendaftar baru. Tidak masuk tabel referral_redemptions
      // karena bukan kode milik tenant mana pun.
      subscriptionFields.super_trial_ends_at = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      subscriptionFields.pending_signup_discount_pct = 2;
      subscriptionFields.referred_by_code = referralCodeInput;
      referralOutcome = "super_admin";
    } else {
      const { data: redeemResult, error: redeemError } = await supabase.rpc("redeem_referral_code", {
        p_code: referralCodeInput,
        p_new_tenant_id: tenant.id,
      });

      if (!redeemError && redeemResult === "referrer") {
        subscriptionFields.pending_signup_discount_pct = 2;
        subscriptionFields.referred_by_code = referralCodeInput;
        referralOutcome = "referrer";
      } else {
        referralOutcome = "invalid";
      }
    }
  }

  if (referralOutcome === "invalid") {
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json(
      { message: "Kode referral tidak ditemukan atau tidak valid." },
      { status: 400 }
    );
  }

  // 3. Create trial subscription (28 hari default, plus field referral kalau ada)
  await supabase.from("subscriptions").insert(subscriptionFields);

  // 4. Buat kode referral PERMANEN milik tenant baru ini sendiri — setiap
  // tenant otomatis dapat 1 kode unik untuk dibagikan, terlepas dari
  // apakah dia sendiri pakai kode orang lain saat daftar atau tidak.
  let ownReferralCode = generateReferralCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error: refError } = await supabase
      .from("referrals")
      .insert({ tenant_id: tenant.id, code: ownReferralCode });
    if (!refError) break;
    ownReferralCode = generateReferralCode(); // tabrakan kode (sangat jarang) — coba lagi
  }

  // 5. Create auth user DAN kirim email verifikasi asli (kode OTP).
  const { data: authUser, error: authError } = await anonClient().auth.signUp({
    email,
    password,
  });

  if (authError || !authUser.user) {
    console.error("auth signUp failed", authError);
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json(
      { message: "Pendaftaran gagal. Periksa kembali data Anda atau gunakan email lain." },
      { status: 400 }
    );
  }

  // 6. Create owner profile
  await supabase.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: tenant.id,
    role: "owner",
    full_name: ownerName,
    email,
  });

  return NextResponse.json({
    success: true,
    tenant_id: tenant.id,
    requiresEmailConfirmation: true,
  });
}
