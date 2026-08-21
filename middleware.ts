import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Direct Role Routing: super_admin -> /admin, owner -> /dashboard, cashier -> /pos
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
  const publicPaths = ["/login", "/register"];
  const isPublic = publicPaths.some((p) => path.startsWith(p));

  if (!user && !isPublic && path !== "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const roleHome: Record<string, string> = {
      super_admin: "/admin",
      owner: "/dashboard",
      cashier: "/pos",
    };

    // Redirect logged-in users away from login/register to their home
    if ((path === "/" || path === "/login" || path === "/register") && profile?.role) {
      return NextResponse.redirect(new URL(roleHome[profile.role] ?? "/pos", request.url));
    }

    // Guard cross-role access (super_admin bypasses all restrictions)
    if (profile?.role && profile.role !== "super_admin") {
      if (path.startsWith("/admin")) {
        return NextResponse.redirect(new URL(roleHome[profile.role], request.url));
      }
      if (path.startsWith("/dashboard") && profile.role !== "owner") {
        return NextResponse.redirect(new URL(roleHome[profile.role], request.url));
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
