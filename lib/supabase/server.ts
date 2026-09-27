import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * `cookies()` dari `next/headers` sudah ASYNC (return Promise) sejak
 * Next.js 15, jadi WAJIB di-`await`. Konsekuensinya SEMUA pemanggil
 * `createClient()` di file ini harus `await createClient()`.
 *
 * Adapter cookies memakai bentuk `getAll`/`setAll` (bentuk lama
 * `get`/`set`/`remove` sudah dihapus di @supabase/ssr >= 0.5).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // dipanggil dari Server Component — cookie hanya bisa ditulis
            // di Server Action / Route Handler, jadi diabaikan di sini
          }
        },
      },
    }
  );
}
