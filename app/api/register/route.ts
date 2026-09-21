import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { generateReferralCode } from "@/lib/generateReferralCode";
import { rateLimitOrNull } from "@/lib/rateLimit";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,'&()-]{2,80}$/u;
const REFERRAL_CODE_RE = /^[A-Z0-9]{4,12}$/;

function sanitize(input: unknown, max = 200) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

export async function POST(request: Request) {
  // BUG FIX (evaluasi audit): sebelumnya endpoint ini punya rate limiter
  // sendiri (in-memory Map lokal, tanpa pembersihan berkala) yang
  // terpisah dari lib/rateLimit.ts yang sudah dipakai endpoint publik
  // lain (qris-charge, notification). Disatukan ke sini — perilakunya
  // sama (5x/menit per IP), tapi sekarang konsisten & otomatis
  // dibersihkan (lihat sweep() di lib/rateLimit.ts).
  const limited = rateLimitOrNull(request, "register", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

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

  // 0. Cek email sudah terdaftar SEBELUM membuat apa pun. Tanpa ini, kalau
  // emailnya sudah dipakai, tenant/subscription/referral tetap kebuat dulu
  // (langkah 1-4 di bawah) baru auth.signUp() gagal/obfuscated di langkah 5 —
  // hasilnya tenant "nyangkut" tanpa auth user yang valid. Profiles.email
  // selalu diisi tiap kali akun jadi (baik dari sini maupun /api/employees),
  // jadi ini cara paling murah untuk deteksi dupe tanpa perlu admin API.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      { message: "Email ini sudah terdaftar. Silakan login, atau gunakan email lain untuk mendaftar." },
      { status: 409 }
    );
  }

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
    // Coba dulu sebagai kode khusus Admin (bisa banyak, masing-masing
    // punya masa berlaku & lama trial sendiri — lihat migration_010).
    const { data: specialRows, error: specialError } = await supabase.rpc("redeem_special_code", {
      p_code: referralCodeInput,
      p_new_tenant_id: tenant.id,
    });
    const specialResult = Array.isArray(specialRows) ? specialRows[0] : null;

    if (!specialError && specialResult) {
      subscriptionFields.super_trial_ends_at = new Date(
        Date.now() + Number(specialResult.trial_days) * 24 * 60 * 60 * 1000
      ).toISOString();
      subscriptionFields.pending_signup_discount_pct = Number(specialResult.discount_pct);
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

  // Supabase signUp() TIDAK mengembalikan error untuk email yang sudah
  // terdaftar & terkonfirmasi (supaya tidak bocor mana email yang valid) —
  // sebagai gantinya ia balas "sukses" tapi user.identities kosong ([]).
  // Ini jaring pengaman kedua di belakang cek langkah 0 di atas.
  const isDuplicateEmail =
    authError?.message?.toLowerCase().includes("already registered") ||
    (authUser?.user && Array.isArray(authUser.user.identities) && authUser.user.identities.length === 0);

  if (authError || !authUser.user || isDuplicateEmail) {
    if (!isDuplicateEmail) console.error("auth signUp failed", authError);
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json(
      {
        message: isDuplicateEmail
          ? "Email ini sudah terdaftar. Silakan login, atau gunakan email lain untuk mendaftar."
          : "Pendaftaran gagal. Periksa kembali data Anda atau gunakan email lain.",
      },
      { status: 400 }
    );
  }

  // 6. Create owner profile.
  // BUG FIX (evaluasi audit): sebelumnya insert ini tidak dicek error-nya
  // sama sekali — kalau gagal (race condition, constraint, dsb), auth
  // user & tenant sudah terlanjur dibuat tapi profilnya tidak ada, dan
  // response TETAP bilang { success: true } ke pengguna. Hasilnya akun
  // "setengah jadi": tidak pernah bisa login normal (getCurrentProfile()
  // akan selalu null), padahal pengguna sudah diberi tahu pendaftaran
  // berhasil. Sekarang: kalau gagal, bersihkan semua yang sudah terlanjur
  // dibuat (auth user + tenant, sama seperti jalur gagal lain di atas)
  // dan beri tahu pengguna dengan jujur supaya mereka coba daftar ulang,
  // bukan menunggu email verifikasi yang tidak akan pernah berguna.
  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: tenant.id,
    role: "owner",
    full_name: ownerName,
    email,
  });

  if (profileError) {
    console.error("owner profile insert failed", profileError);
    await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {});
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json(
      { message: "Pendaftaran gagal menyimpan data akun. Silakan coba lagi." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    tenant_id: tenant.id,
    requiresEmailConfirmation: true,
  });
}
