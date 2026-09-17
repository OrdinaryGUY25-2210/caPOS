import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { rateLimitOrNull } from "@/lib/rateLimit";

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
 * Memakai MIDTRANS_SERVER_KEY yang sama dengan yang sudah dipakai Phase 1
 * untuk pembayaran langganan (lihat app/api/midtrans/create-transaction).
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

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    console.error("MIDTRANS_SERVER_KEY belum diset di environment.");
    return NextResponse.json({ message: "Pembayaran QRIS belum dikonfigurasi. Silakan bayar di kasir." }, { status: 500 });
  }

  const svc = serviceClient();

  const { data: qrOrder, error } = await svc
    .from("qr_orders")
    .select("id, order_id, total_amount, payment_method, payment_reference")
    .eq("id", qrOrderId)
    .single();

  if (error || !qrOrder) {
    return NextResponse.json({ message: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (qrOrder.payment_method !== "qris") {
    return NextResponse.json({ message: "Pesanan ini tidak memakai metode QRIS." }, { status: 400 });
  }

  // Order ID Midtrans harus unik — pakai qr_order_id sebagai basis, aman
  // dipanggil ulang (mis. pelanggan refresh halaman) karena Midtrans akan
  // menolak/menimpa charge duplikat untuk order_id yang sama.
  const midtransOrderId = `QRORDER-${qrOrder.id}`;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const baseUrl = isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";

  const chargeRes = await fetch(`${baseUrl}/v2/charge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${serverKey}:`).toString("base64"),
    },
    body: JSON.stringify({
      payment_type: "qris",
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: Math.round(Number(qrOrder.total_amount)),
      },
      qris: { acquirer: "gopay" },
    }),
  });

  const chargeJson = await chargeRes.json().catch(() => null);

  if (!chargeRes.ok || !chargeJson) {
    console.error("Midtrans QRIS charge gagal:", chargeJson);
    return NextResponse.json({ message: "Gagal membuat kode QRIS. Silakan bayar di kasir." }, { status: 502 });
  }

  const qrAction = (chargeJson.actions || []).find((a: any) => a.name === "generate-qr-code");

  await svc.from("qr_orders").update({ payment_reference: midtransOrderId }).eq("id", qrOrder.id);

  return NextResponse.json({ qr_url: qrAction?.url ?? null, midtrans_order_id: midtransOrderId });
}
