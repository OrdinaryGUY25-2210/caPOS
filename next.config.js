/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
  // Security headers (OWASP "Security Misconfiguration" / A05:2021).
  // Without these, the app is more exposed to clickjacking (no framing
  // protection), MIME-sniffing attacks, and has no baseline Content-Security
  // -Policy at all. Tune connect-src/img-src further if you add more
  // third-party domains later.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // ZAP 90004: COOP memisahkan konteks browsing kita dari situs lain
          // (mitigasi XS-Leaks / window.opener). Aman untuk alur pembayaran
          // di app ini karena Midtrans dipakai lewat Core API server-side dan
          // redirect, bukan popup + window.opener.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // ZAP 90004: mencegah resource kita di-embed situs lain. Tidak
          // menghalangi pemuatan aset milik sendiri maupun gambar Supabase.
          //
          // CATATAN: Cross-Origin-Embedder-Policy (COEP) SENGAJA tidak
          // dipasang. Nilai protektifnya (`require-corp`/`credentialless`)
          // akan memblokir gambar Supabase Storage dan iframe Midtrans yang
          // tidak mengirim header CORS/CORP, sehingga dapat mematahkan
          // pembayaran & foto produk.
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' dipertahankan karena Next.js menyuntikkan
              // bootstrap/inline style saat runtime. Menghapusnya butuh nonce
              // lewat proxy/middleware (di luar cakupan perubahan ini) dan
              // berisiko mematahkan hidrasi.
              "script-src 'self' 'unsafe-inline' https://app.midtrans.com https://app.sandbox.midtrans.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.midtrans.com https://api.sandbox.midtrans.com https://app.midtrans.com https://app.sandbox.midtrans.com",
              "frame-src 'self' https://app.midtrans.com https://app.sandbox.midtrans.com",
              "frame-ancestors 'none'",
              // ZAP 10055: directive tanpa fallback ke default-src wajib
              // didefinisikan eksplisit (object-src, base-uri, form-action).
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
