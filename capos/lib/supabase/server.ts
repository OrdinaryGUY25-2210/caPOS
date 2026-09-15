import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * `cookies()` dari `next/headers` SINKRON di Next.js 14, tapi jadi ASYNC
 * (return Promise) mulai Next.js 15. Fungsi ini sengaja dibuat `async` dan
 * memakai `await cookies()` supaya jalan benar di kedua versi:
 *  - Next 14: `cookies()` mengembalikan objek biasa (bukan Promise) — kalau
 *    sebuah nilai non-Promise di-`await`, JavaScript otomatis
 *    membungkusnya jadi Promise ter-resolve, jadi tetap valid tanpa error.
 *  - Next 15+/16: `cookies()` memang mengembalikan Promise, jadi wajib
 *    `await` — kalau tidak, TypeScript menolak build dengan error
 *    `Property 'get' does not exist on type 'Promise<...>'` (persis error
 *    yang muncul di build Vercel).
 *
 * Konsekuensinya: SEMUA pemanggil `createClient()` di file ini sekarang
 * wajib pakai `await createClient()`, bukan `createClient()` langsung.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // called from a Server Component — ignore, middleware refreshes session
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // ignore
          }
        },
      },
    }
  );
}
