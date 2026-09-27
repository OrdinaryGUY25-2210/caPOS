import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import SelfOrderClient from "@/components/order/SelfOrderClient";
import type { QrOrderPageData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Halaman publik QR Self-Order — capos.id/order/[branch_slug]/[table_number].
 * TIDAK memerlukan login (lihat middleware.ts: "/order" ditambahkan ke
 * publicPaths). Satu panggilan RPC `get_qr_order_page` (anon key) memuat
 * SEMUA data yang dibutuhkan sekaligus — info cabang, meja, katalog menu,
 * dan (sejak migration_022) mode QRIS + setelan audio — supaya halaman
 * tetap ringan & cepat di jaringan seluler.
 *
 * Dijalankan sebagai Server Component (bukan client fetch) supaya HTML
 * pertama yang sampai ke HP pelanggan sudah berisi menu, bukan skeleton
 * kosong menunggu JS load — penting untuk UX "super cepat" yang diminta.
 */
export default async function SelfOrderPage({
  params,
}: {
  params: { branch: string; table: string };
}) {
  // Anon key publik — sama seperti createClient() di lib/supabase/client.ts,
  // tapi dipanggil dari server (tanpa cookie sesi) karena pelanggan tidak login.
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.rpc("get_qr_order_page", {
    p_branch_slug: params.branch,
    p_table_number: decodeURIComponent(params.table),
  });

  const pageData = (data as QrOrderPageData) ?? { error: "branch_not_found" };

  if (error || pageData.error || !pageData.branch || !pageData.table) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6 text-center">
        <div>
          <p className="text-4xl mb-3">🍽️</p>
          <h1 className="text-lg font-bold text-neutral-900">Meja tidak ditemukan</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Link QR ini sepertinya tidak valid atau sudah tidak aktif. Silakan panggil staf kami untuk bantuan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SelfOrderClient
      branchSlug={params.branch}
      tableNumber={pageData.table.table_number}
      branchName={pageData.branch.name}
      tableCapacity={pageData.table.capacity}
      products={pageData.products ?? []}
      // Migrasi 020 — dipakai murni sebagai nama topik broadcast realtime
      // `products-<tenant_id>` untuk notifikasi Sold Out/Menu 86 instan,
      // BUKAN untuk query apa pun langsung ke tabel dari klien publik ini.
      tenantId={pageData.branch.tenant_id}
      // migration_022 — PRD "QRIS Self-Service & Storage Audio": diambil
      // langsung dari kolom `branches` lewat RPC, bukan lagi dari
      // storage.list() heuristik (lihat riwayat git untuk versi lama;
      // dibuang karena hardcode ekstensi ".jpg" salah untuk unggahan PNG).
      staticQrisUrl={pageData.branch.static_qris_image_url ?? null}
      qrisMode={pageData.branch.qris_mode ?? "DYNAMIC"}
      soundSettings={{
        enabled: pageData.branch.sound_enabled ?? true,
        tone: pageData.branch.sound_tone ?? "bell_chime",
        volume: pageData.branch.sound_volume ?? 0.8,
      }}
    />
  );
}
