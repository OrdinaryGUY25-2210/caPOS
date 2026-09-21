import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerProfile } from "@/lib/getServerProfile";
import { createMidtransCoreApi, mapMidtransTransactionStatus, POS_QRIS_DEFAULT_EXPIRY_MS } from "@/lib/midtransCore";

/**
 * Dipoll oleh /pos setiap beberapa detik selagi menunggu pelanggan scan
 * QRIS Dinamis. Baca status dari `pos_qris_payments` yang di-update oleh
 * webhook (app/api/midtrans/notification) — TIDAK memanggil Midtrans
 * langsung di jalur normal, supaya tidak ada beban ekstra ke Core API
 * tiap polling.
 *
 * BARU — auto-expire: kalau status masih "pending" setelah lewat
 * POS_QRIS_DEFAULT_EXPIRY_MS (5 menit, default Midtrans untuk QRIS Core
 * API), kita cek SEKALI ke Midtrans (core.getStatus) untuk memastikan
 * (jaga-jaga webhook telat/gagal terkirim) sebelum menandainya "expired"
 * di DB — supaya kasir tidak terus menunggu kode QR yang sudah tidak
 * bisa dibayar lagi, dan tombol "Selesaikan Transaksi" di /pos otomatis
 * berhenti terkunci (lihat qrisDynamicNotPaid di app/pos/page.tsx —
 * kasir akan lihat opsi "Coba Lagi" begitu status ini berubah).
 */
function serviceClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const { profile } = await getServerProfile();
  if (!profile) {
    return NextResponse.json({ message: "Anda harus login." }, { status: 401 });
  }

  const svc = serviceClient();
  const { data: payment, error } = await svc
    .from("pos_qris_payments")
    .select("status, branch_id, tenant_id, order_id, created_at")
    .eq("order_id", orderId)
    .single();

  if (error || !payment) {
    return NextResponse.json({ message: "Transaksi tidak ditemukan." }, { status: 404 });
  }

  const isOwnerLike = profile.role === "owner" || profile.role === "super_admin";
  const sameTenant = payment.tenant_id === profile.tenant_id;
  const sameBranch = payment.branch_id === profile.branch_id;

  if (!sameTenant || (!isOwnerLike && !sameBranch)) {
    return NextResponse.json({ message: "Transaksi tidak ditemukan." }, { status: 404 });
  }

  const isPastDefaultExpiry = Date.now() - new Date(payment.created_at).getTime() > POS_QRIS_DEFAULT_EXPIRY_MS;

  if (payment.status === "pending" && isPastDefaultExpiry) {
    const { data: branch } = await svc
      .from("branches")
      .select("midtrans_server_key, midtrans_is_production")
      .eq("id", payment.branch_id)
      .single();

    if (branch?.midtrans_server_key) {
      const core = createMidtransCoreApi({ serverKey: branch.midtrans_server_key, isProduction: !!branch.midtrans_is_production });
      const check = await core.getStatus(orderId);
      // Kalau Midtrans TIDAK bisa dihubungi (mis. timeout), jangan langsung
      // vonis "expired" — biarkan polling berikutnya coba lagi, jangan
      // sampai transaksi yang sebetulnya sudah lunas malah dipaksa gagal
      // hanya karena 1x panggilan status API gagal.
      if (check.ok) {
        const resolvedStatus = mapMidtransTransactionStatus(check.transactionStatus, check.fraudStatus, "expired");
        if (resolvedStatus !== payment.status) {
          await svc.from("pos_qris_payments").update({ status: resolvedStatus, raw_response: check.raw }).eq("order_id", orderId);
        }
        return NextResponse.json({ status: resolvedStatus });
      }
    }
  }

  return NextResponse.json({ status: payment.status });
}
