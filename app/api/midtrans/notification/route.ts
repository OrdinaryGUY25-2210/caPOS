import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "@/lib/midtransPlans";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Endpoint ini dipanggil LANGSUNG oleh server Midtrans (bukan oleh
 * browser user), jadi tidak ada sesi login di sini — otentikasinya lewat
 * `signature_key` yang wajib dicocokkan dengan hash SHA-512 milik kita
 * sendiri. Ini mencegah siapa pun memalsukan notifikasi "pembayaran
 * berhasil" dengan cara POST manual ke endpoint ini tanpa benar-benar
 * membayar — signature-nya butuh MIDTRANS_SERVER_KEY yang cuma kita tahu.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "Payload tidak valid." }, { status: 400 });
  }

  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    console.error("MIDTRANS_SERVER_KEY belum diset di environment.");
    return NextResponse.json({ message: "Server misconfigured." }, { status: 500 });
  }

  const expectedSignature = crypto
    .createHash("sha512")
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest("hex");

  if (signature_key !== expectedSignature) {
    console.error("Midtrans webhook: signature tidak cocok untuk order_id", order_id);
    return NextResponse.json({ message: "Invalid signature." }, { status: 403 });
  }

  const svc = serviceClient();

  const { data: payment } = await svc
    .from("payments")
    .select("*")
    .eq("order_id", order_id)
    .single();

  if (!payment) {
    console.error("Midtrans webhook: order_id tidak ditemukan di payments:", order_id);
    return NextResponse.json({ message: "Order tidak ditemukan." }, { status: 404 });
  }

  let newStatus: "pending" | "paid" | "failed" = payment.status;

  if (transaction_status === "capture" || transaction_status === "settlement") {
    // fraud_status cuma relevan untuk metode kartu kredit; metode lain
    // (QRIS, VA, dll) tidak mengirim field ini sama sekali.
    newStatus = !fraud_status || fraud_status === "accept" ? "paid" : "failed";
  } else if (transaction_status === "pending") {
    newStatus = "pending";
  } else if (["deny", "cancel", "expire", "failure"].includes(transaction_status)) {
    newStatus = "failed";
  }

  await svc
    .from("payments")
    .update({ status: newStatus, raw_response: body, updated_at: new Date().toISOString() })
    .eq("order_id", order_id);

  // Baru perpanjang langganan kalau statusnya benar-benar 'paid' — jangan
  // pernah perpanjang di status lain, walau transaction_status terlihat
  // "positif" (mis. masih 'pending' untuk metode transfer bank).
  if (newStatus === "paid") {
    const plan = PLANS[payment.plan as keyof typeof PLANS];
    const days = plan?.days ?? 30;

    await svc
      .from("subscriptions")
      .update({
        status: "active",
        valid_until: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", payment.tenant_id);
  }

  // Midtrans mengharapkan response 200 apa pun hasilnya (selama sudah
  // diproses) — response non-200 akan membuat Midtrans retry notifikasi
  // yang sama berkali-kali.
  return NextResponse.json({ message: "OK" });
}
