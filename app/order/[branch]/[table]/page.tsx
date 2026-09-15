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
    />
  );
}
