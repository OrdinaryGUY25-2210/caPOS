import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { createMidtransCoreApi } from "@/lib/midtransCore";

function serviceClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Dipanggil dari halaman /order/[branch]/[table] (pelanggan, belum login)
 * setelah submit_qr_order() sukses. Membuat transaksi QRIS Dynamic lewat
 * Midtrans Core API — nominal diambil dari `qr_orders.total_amount` yang
 * sudah dihitung server saat submit_qr_order (BUKAN dari body request),
 * supaya pelanggan tidak bisa mengubah nominal QRIS dari browser.
 *
 * migration_022 — SEBELUMNYA endpoint ini SELALU memakai
 * MIDTRANS_SERVER_KEY milik PLATFORM caPOS sendiri (env var, sama yang
 * dipakai buat pembayaran langganan), beda dari alur QRIS Dinamis di
 * kasir (app/api/pos/qris-charge) yang dari awal didesain BYOK per cabang
 * (branches.midtrans_server_key, dibaca webhook notifikasi Midtrans).
 * Sekarang keduanya disatukan: kalau cabang sudah mengisi Server Key
 * sendiri di /dashboard/settings/payment (PRD), key ITU yang dipakai di
 * sini juga — uang customer self-order langsung masuk ke akun Midtrans
 * OWNER, bukan lewat akun caPOS. Kalau belum diisi, tetap jatuh ke key
 * platform seperti sebelumnya (tidak ada yang berubah untuk tenant yang
 * belum pakai fitur BYOK).
 */
export async function POST(request: Request) {
  // BARU — endpoint publik tanpa login sama sekali, sebelum ini tidak ada
  // pembatas apa pun. 10x/menit per IP: cukup longgar untuk pelanggan
  // beneran (submit_qr_order gagal lalu retry QRIS beberapa kali wajar),
  // tapi menahan script yang coba membanjiri Midtrans Core API (tiap
  // panggilan yang lolos ke Midtrans berpotensi kena biaya API ke tenant).
  const limited = rateLimitOrNull(request, "qris-charge", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const qrOrderId = body?.qr_order_id;
  if (!qrOrderId) {
    return NextResponse.json({ message: "qr_order_id wajib diisi." }, { status: 400 });
  }

  const svc = serviceClient();

  const { data: qrOrder, error } = await svc
    .from("qr_orders")
    .select("id, order_id, branch_id, total_amount, payment_method, payment_reference")
    .eq("id", qrOrderId)
    .single();

  if (error || !qrOrder) {
    return NextResponse.json({ message: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (qrOrder.payment_method !== "qris") {
    return NextResponse.json({ message: "Pesanan ini tidak memakai metode QRIS." }, { status: 400 });
  }

  // BYOK dulu (per cabang), platform key sebagai fallback.
  let serverKey = process.env.MIDTRANS_SERVER_KEY;
  let isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";

  if (qrOrder.branch_id) {
    const { data: branch } = await svc
      .from("branches")
      .select("midtrans_server_key, midtrans_is_production")
      .eq("id", qrOrder.branch_id)
      .single();
    if (branch?.midtrans_server_key) {
      serverKey = branch.midtrans_server_key;
      isProduction = !!branch.midtrans_is_production;
    }
  }

  if (!serverKey) {
    console.error("Tidak ada Midtrans server key (branch maupun platform) untuk qr_order:", qrOrderId);
    return NextResponse.json({ message: "Pembayaran QRIS belum dikonfigurasi. Silakan bayar di kasir." }, { status: 500 });
  }

  // Order ID Midtrans harus unik — pakai qr_order_id sebagai basis, aman
  // dipanggil ulang (mis. pelanggan refresh halaman) karena Midtrans akan
  // menolak/menimpa charge duplikat untuk order_id yang sama.
  const midtransOrderId = `QRORDER-${qrOrder.id}`;
  const core = createMidtransCoreApi({ serverKey, isProduction });
  const charge = await core.chargeQris({ orderId: midtransOrderId, grossAmount: Number(qrOrder.total_amount) });

  if (!charge.ok || !charge.qrUrl) {
    console.error("Midtrans QRIS charge gagal:", charge.raw);
    return NextResponse.json({ message: "Gagal membuat kode QRIS. Silakan bayar di kasir." }, { status: 502 });
  }

  await svc.from("qr_orders").update({ payment_reference: midtransOrderId }).eq("id", qrOrder.id);

  return NextResponse.json({ qr_url: charge.qrUrl, midtrans_order_id: midtransOrderId });
}
