/**
 * Rate limiter ringan untuk endpoint publik (tidak butuh login) — BARU,
 * tidak menyentuh endpoint yang sudah pakai session cookie/RLS (itu sudah
 * terlindungi lewat auth, jadi penyerang anonim tidak bisa langsung
 * membanjirinya tanpa akun valid).
 *
 * PENTING — batasannya harus jujur disampaikan:
 * 1. Ini in-memory (Map biasa), jalan PER-INSTANCE serverless Vercel.
 *    Cukup ampuh menahan bot/script kasar yang hajar dari 1 sumber
 *    berulang-ulang dalam waktu singkat (instance yang sama sering
 *    dipakai ulang selama traffic-nya masih ramai dari IP itu), TAPI
 *    tidak reset dijamin sinkron kalau request-nya menyebar ke banyak
 *    cold start/region berbeda — bukan penghitung global yang presisi.
 * 2. Ini SAMA SEKALI BUKAN proteksi DDoS volumetrik (ribuan/jutaan
 *    request per detik dari botnet). Serangan seukuran itu harus
 *    ditangkis di level jaringan/edge (Vercel & Cloudflare punya mitigasi
 *    bawaan sebelum request bahkan sampai ke kode ini) — rate limit di
 *    sini cuma lapis tambahan untuk penyalahgunaan skala kecil-menengah
 *    (scraping agresif, brute force, spam form) yang lolos dari lapis
 *    infrastruktur.
 * 3. Kalau traffic caPOS sudah besar & butuh penghitung yang benar-benar
 *    akurat lintas region, ganti isi checkRateLimit() ini dengan Upstash
 *    Redis (@upstash/ratelimit) — signature fungsinya sengaja dibuat
 *    supaya gampang diganti tanpa menyentuh route yang memanggilnya.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bersihkan bucket kedaluwarsa dari waktu ke waktu supaya Map ini tidak
// terus membesar selama instance-nya hidup (bukan soal keamanan, cuma
// jaga memori).
let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number; resetAt: number } {
  sweep();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Ambil IP client dari header proxy Vercel — bukan sumber identitas yang bisa dipalsukan penuh, tapi cukup untuk rate limit best-effort. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Helper siap pakai untuk route handler: return Response 429 kalau limit kena, atau null kalau boleh lanjut. */
export function rateLimitOrNull(
  request: Request,
  routeKey: string,
  opts: { limit: number; windowMs: number }
): Response | null {
  const ip = getClientIp(request);
  const { allowed, resetAt } = checkRateLimit(`${routeKey}:${ip}`, opts);
  if (allowed) return null;

  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ message: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi." }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) } }
  );
}
