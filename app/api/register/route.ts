import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client: dipakai untuk membuat tenant/profile — operasi yang
// harus bisa menulis ke DB SEBELUM user punya sesi login sendiri. Kunci ini
// tidak pernah dikirim ke browser.
function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Anon client: dipakai KHUSUS untuk memanggil auth.signUp(). Ini penting —
// auth.admin.createUser() (lewat service role) TIDAK mengirim email
// verifikasi sama sekali walau email_confirm diset false (ini perilaku
// resmi Supabase, sering bikin bingung developer). Yang benar-benar
// mengirim email konfirmasi adalah auth.signUp() biasa, dan itu tidak
// butuh service role — anon key sudah cukup, sama seperti kalau signUp
// dipanggil langsung dari browser.
function anonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// -----------------------------------------------------------------------
// Rate limiting per-IP (in-memory sliding window).
//
// SECURITY NOTE: this is only safe for a single Node.js instance. On
// Vercel/serverless with multiple instances, replace this with a shared
// store (Upstash Redis, Vercel KV, Supabase itself) — otherwise each
// instance has its own counter and the limit is effectively multiplied by
// the number of warm instances. Ini penting terutama SEKARANG karena
// pendaftaran tidak lagi dijaga kode akses — endpoint ini satu-satunya
// penghalang dari spam akun massal.
// -----------------------------------------------------------------------
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

  // Server-side validation — the client's `required`/`minLength` attributes
  // only help UX; anyone can call this endpoint directly with curl/Postman
  // and skip the browser entirely, so every rule must be re-checked here.
  const errors: string[] = [];
  if (!SAFE_TEXT_RE.test(cafeName)) errors.push("Nama kafe tidak valid.");
  if (!SAFE_TEXT_RE.test(ownerName)) errors.push("Nama pemilik tidak valid.");
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

  // 1. Create tenant — tidak ada lagi gerbang kode akses/kuota. Registrasi
  // terbuka untuk siapa saja, tiap orang otomatis dapat 28 hari trial
  // (lihat DEFAULT trial_ends_at di tabel subscriptions).
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

  // 2. Create trial subscription (28 days, defaults handled by DB)
  await supabase.from("subscriptions").insert({ tenant_id: tenant.id });

  // 3. Create auth user DAN kirim email verifikasi asli (kode OTP).
  const { data: authUser, error: authError } = await anonClient().auth.signUp({
    email,
    password,
  });

  if (authError || !authUser.user) {
    // Generic message: confirming/denying "email already registered" makes
    // it trivial to enumerate valid user accounts (OWASP A07).
    console.error("auth signUp failed", authError);
    // Rollback: jangan sampai ada tenant "yatim" tanpa pemilik.
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json(
      { message: "Pendaftaran gagal. Periksa kembali data Anda atau gunakan email lain." },
      { status: 400 }
    );
  }

  // 4. Create owner profile lewat service client (user belum punya sesi
  // login sendiri sampai OTP diverifikasi, jadi insert ini butuh hak
  // akses elevated, bukan RLS milik user biasa).
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
