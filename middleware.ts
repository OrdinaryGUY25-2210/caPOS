import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Lanjutkan request tanpa memblokir/redirect file statis
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Mencegah middleware berjalan pada file statis, Service Worker, Manifest, dan gambar
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
