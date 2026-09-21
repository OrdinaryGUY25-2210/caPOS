import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Direct Role Routing: super_admin -> /admin, owner/manager -> /dashboard,
// cashier -> /pos, kitchen -> /kitchen (migration_16: role "Dapur")
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const publicPaths = ["/login", "/register", "/forgot-password", "/order", "/reserve"];
  const isPublic = publicPaths.some((p) => path.startsWith(p));

  if (!user && !isPublic && path !== "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    // BUG FIX (ERR_TOO_MANY_REDIRECTS untuk akun yang dinonaktifkan):
    // sebelumnya blok ini cuma cek `profile?.role`, tidak pernah cek
    // `is_active`. Akibatnya: /pos atau /dashboard layout.tsx melempar
    // akun nonaktif ke /login?deactivated=1 (sesi Supabase masih valid
    // sesaat sebelum sign-out client-side selesai) -> middleware ini
    // melihat masih ada `user` + `role` lalu langsung melempar BALIK ke
    // /pos -> /pos menolak lagi -> lempar ke /login lagi -> looping
    // selamanya. Sekarang: akun yang is_active === false TIDAK ikut
    // dilempar "pulang" dari /login, supaya dia bisa mendarat dengan
    // tenang di halaman login dan lihat pesan alasannya.
    const isDeactivated = profile?.is_active === false;

    const roleHome: Record<string, string> = {
      super_admin: "/admin",
      owner: "/dashboard",
      manager: "/dashboard",
      cashier: "/pos",
      kitchen: "/kitchen",
    };

    // Redirect logged-in users away from login/register to their home
    // (KECUALI akun yang sudah dinonaktifkan — lihat catatan di atas).
    if ((path === "/" || path === "/login" || path === "/register") && profile?.role && !isDeactivated) {
      return NextResponse.redirect(new URL(roleHome[profile.role] ?? "/pos", request.url));
    }

    // Akun nonaktif mencoba buka halaman mana pun SELAIN /login (dan path
    // publik lain): lempar ke /login?deactivated=1 di sini juga (bukan
    // cuma di /pos & /dashboard layout.tsx) supaya /kitchen dan /admin
    // ikut terlindungi, dan supaya pengecekan ini konsisten terjadi di
    // SATU tempat sebelum request sampai ke layout mana pun. `isPublic`
    // sudah mencakup "/login" (lihat definisi di atas), jadi cukup satu
    // syarat ini saja.
    if (isDeactivated && !isPublic) {
      return NextResponse.redirect(new URL("/login?deactivated=1", request.url));
    }

    // BARU — fix PWA "nyangkut" di /pos untuk role Dapur: manifest.json
    // punya start_url tetap "/pos" untuk semua role, jadi kalau sesi login
    // masih aktif, PWA langsung buka ke /pos tanpa pernah lewat "/"/"/login"
    // di atas (redirect di atas jadi tidak pernah kepicu). Cek eksplisit di
    // sini supaya kitchen-role yang mendarat di /pos tetap dilempar ke
    // /kitchen, apa pun jalur masuknya.
    if (profile?.role === "kitchen" && path.startsWith("/pos")) {
      return NextResponse.redirect(new URL("/kitchen", request.url));
    }

    // Guard cross-role access (super_admin bypasses all restrictions).
    // Saat memblokir, tambahkan query param `?access_denied=<path-tujuan>`
    // ke URL redirect — ini dibaca oleh komponen AccessDeniedNotice di sisi
    // client untuk menampilkan notifikasi singkat ("Anda tidak punya akses
    // ke halaman itu") alih-alih diam-diam melempar user tanpa penjelasan.
    if (profile?.role && profile.role !== "super_admin") {
      if (path.startsWith("/admin")) {
        const url = new URL(roleHome[profile.role], request.url);
        url.searchParams.set("access_denied", path);
        return NextResponse.redirect(url);
      }
      // manager DIPERLAKUKAN SAMA seperti owner untuk akses dashboard —
      // cuma cashier yang diblokir dari /dashboard. Pengajuan izin/sakit
      // untuk kasir ditaruh di dalam /pos (lihat components/PosNavbar),
      // bukan di /dashboard/attendance, supaya kasir tidak perlu melihat
      // layout dashboard penuh (sidebar dengan semua menu Owner/Manager)
      // cuma untuk mengajukan izin.
      if (path.startsWith("/dashboard") && profile.role !== "owner" && profile.role !== "manager") {
        const url = new URL(roleHome[profile.role], request.url);
        url.searchParams.set("access_denied", path);
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
