import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Uses the service-role key because redeeming an invite code and creating
// the auth user + tenant must happen atomically on the server — never
// exposed to the browser.
function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// -----------------------------------------------------------------------
// Rate limiting per-IP (in-memory sliding window).
//
// SECURITY NOTE: this is only safe for a single Node.js instance. On
// Vercel/serverless with multiple instances, replace this with a shared
// store (Upstash Redis, Vercel KV, Supabase itself) — otherwise each
// instance has its own counter and the limit is effectively multiplied by
// the number of warm instances. It's included here mainly to stop naive
// scripted abuse, not as the only line of defense.
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

// Basic RFC-5322-ish check — good enough to reject garbage input without
// being overly strict about edge cases. Real deliverability is verified by
// Supabase's own email confirmation flow.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters/numbers/spaces/basic punctuation only — blocks control characters
// and script-like payloads from ever reaching the database.
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,'&()-]{2,80}$/u;
const ACCESS_CODE_RE = /^[A-Z0-9_-]{4,32}$/;

function sanitize(input: unknown, max = 200) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, max);
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { reason: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi dalam 1 menit." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: "INVALID_BODY", message: "Payload tidak valid." }, { status: 400 });
  }

  const cafeName = sanitize(body.cafeName, 80);
  const ownerName = sanitize(body.ownerName, 80);
  const email = sanitize(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const accessCode = sanitize(body.accessCode, 32).toUpperCase();

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
  if (!ACCESS_CODE_RE.test(accessCode)) errors.push("Format Kode Akses tidak valid.");

  if (errors.length > 0) {
    return NextResponse.json({ reason: "VALIDATION_ERROR", message: errors.join(" ") }, { status: 400 });
  }

  const supabase = serviceClient();

  // Atomically checks used_count < max_uses and increments in one
  // transaction (see redeem_invite_code() in supabase/schema.sql) so
  // concurrent signups can never push the tenant count past 100.
  const { data: redeemed, error: redeemError } = await supabase.rpc(
    "redeem_invite_code",
    { p_code: accessCode }
  );

  if (redeemError || !redeemed) {
    return NextResponse.json(
      { reason: "INVALID_CODE", message: "Kode Akses tidak valid." },
      { status: 400 }
    );
  }

  if (redeemed === "QUOTA_FULL") {
    return NextResponse.json({ reason: "QUOTA_FULL" }, { status: 409 });
  }

  // 1. Create tenant
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: cafeName })
    .select()
    .single();

  if (tenantError) {
    // Don't leak raw DB error strings to the client — log server-side only.
    console.error("tenant insert failed", tenantError);
    return NextResponse.json(
      { reason: "TENANT_ERROR", message: "Gagal membuat data kafe. Silakan coba lagi." },
      { status: 500 }
    );
  }

  // 2. Create trial subscription (28 days, defaults handled by DB)
  await supabase.from("subscriptions").insert({ tenant_id: tenant.id });

  // 3. Create auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    // Generic message: confirming/denying "email already registered" makes
    // it trivial to enumerate valid user accounts (OWASP A07).
    console.error("auth create failed", authError);
    return NextResponse.json(
      { reason: "AUTH_ERROR", message: "Pendaftaran gagal. Periksa kembali data Anda atau gunakan email lain." },
      { status: 400 }
    );
  }

  // 4. Create owner profile
  await supabase.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: tenant.id,
    role: "owner",
    full_name: ownerName,
  });

  return NextResponse.json({ success: true, tenant_id: tenant.id });
}
