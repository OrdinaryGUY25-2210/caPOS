import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 mengganti konvensi `middleware` menjadi `proxy`
// (nama file middleware.ts -> proxy.ts, dan export middleware -> proxy).
export function proxy() {
  // Lanjutkan request tanpa memblokir/redirect file statis
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Mencegah proxy berjalan pada file statis, Service Worker, Manifest, dan gambar
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
