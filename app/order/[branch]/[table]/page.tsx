import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import SelfOrderClient from "@/components/order/SelfOrderClient";
import type { QrOrderPageData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Halaman publik QR Self-Order — capos.id/order/[branch_slug]/[table_number].
 * TIDAK memerlukan login (lihat middleware.ts: "/order" ditambahkan ke
 * publicPaths). Satu panggilan RPC `get_qr_order_page` (anon key) memuat
 * SEMUA data yang dibutuhkan sekaligus — info cabang, meja, dan katalog
 * menu — supaya halaman tetap ringan & cepat di jaringan seluler.
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

  // QRIS statis milik owner (diunggah di /dashboard/settings, bucket publik
  // "menu-images", path `${tenant_id}/qris-code.jpg` — pola sama persis
  // dengan logo kafe). Dicek dengan service role di server component ini
  // (bukan anon) supaya tidak bergantung pada izin `list()` anon pada
  // bucket publik. Kalau owner belum pernah unggah, SelfOrderClient tetap
  // jatuh ke alur QRIS dinamis Midtrans yang sudah ada (tidak ada yang
  // berubah untuk tenant yang belum pakai fitur ini).
  let staticQrisUrl: string | null = null;
  if (pageData.branch?.tenant_id) {
    const svc = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: files } = await svc.storage
      .from("menu-images")
      .list(pageData.branch.tenant_id, { search: "qris-code" });
    if (files && files.length > 0) {
      const { data: pub } = svc.storage
        .from("menu-images")
        .getPublicUrl(`${pageData.branch.tenant_id}/qris-code.jpg`);
      staticQrisUrl = pub.publicUrl;
    }
  }

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
      staticQrisUrl={staticQrisUrl}
    />
  );
}
