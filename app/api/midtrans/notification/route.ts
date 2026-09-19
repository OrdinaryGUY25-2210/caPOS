import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "@/lib/midtransPlans";
import { rateLimitOrNull } from "@/lib/rateLimit";

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
  // BARU — limit longgar (30x/menit per IP) khusus buat menahan flood
  // garbage request yang bahkan tidak lolos verifikasi signature di bawah
  // (biar tidak buang compute time hash SHA-512 + query DB berulang-ulang
  // untuk tiap request sampah). Limitnya sengaja tidak ketat supaya tidak
  // pernah menolak notifikasi ASLI dari Midtrans saat traffic ramai.
  const limited = rateLimitOrNull(request, "midtrans-notification", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "Payload tidak valid." }, { status: 400 });
  }


  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

  // Digabung dengan webhook Phase 4 (QR Self-Order) supaya cukup SATU
  // Payment Notification URL di Midtrans Dashboard — order_id pesanan QR
  // selalu diberi prefix "QRORDER-" saat dibuat (lihat submit_qr_order /
  // charge QRIS di app/api/orders/qris-charge), jadi tinggal dicabangkan
  // di sini sebelum masuk ke logika langganan di bawah.
  if (typeof order_id === "string" && order_id.startsWith("QRORDER-")) {
    return handleQrOrderNotification(body);
  }

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
    // PENTING — tetap balas 200 di sini, JANGAN 404.
    //
    // Signature di atas sudah tervalidasi cocok (kalau tidak, kita sudah
    // return 403 sebelum sampai baris ini) — jadi notifikasi ini memang
    // benar berasal dari Midtrans, cuma order_id-nya tidak/tidak lagi ada
    // di tabel `payments` kita. Ini terjadi di dua situasi normal:
    //  1. Tombol "Test notification URL" di dashboard Midtrans — mereka
    //     sengaja mengirim order_id palsu (`payment_notif_test_...`) yang
    //     memang tidak pernah dan tidak akan pernah ada di DB kita, cuma
    //     untuk mengetes konektivitas endpoint. Dashboard Midtrans
    //     menganggap tes ini GAGAL kalau responnya bukan 200 — sebelum
    //     fix ini, tombol testnya SELALU gagal walau endpoint-nya sehat.
    //  2. Race condition asli di production: notifikasi settlement kadang
    //     sampai duluan sepersekian detik sebelum baris `payments`-nya
    //     sendiri selesai ter-insert. Kalau kita balas non-2xx di sini,
    //     Midtrans akan retry otomatis beberapa kali — itu bagus, tapi
    //     404 juga bukan cara yang tepat untuk memicunya (409/425 lebih
    //     akurat kalau suatu saat mau dibedakan dari "order_id ini memang
    //     tidak akan pernah ada").
    // Intinya: 404 di sini TIDAK memberi manfaat keamanan apapun (signature
    // sudah membuktikan ini benar dari Midtrans, bukan orang iseng), jadi
    // aman & lebih benar untuk selalu ack 200 + catat di log server saja.
    console.warn("Midtrans webhook: order_id tidak ditemukan di payments (kemungkinan tes dashboard atau race condition):", order_id);
    return NextResponse.json({ message: "OK (order_id tidak dikenali, notifikasi diabaikan)" });
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
        plan: payment.plan,
        valid_until: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", payment.tenant_id);

    // Proses reward referral: (1) beri +3% ke referrer tenant ini kalau
    // ada & belum pernah, (2) RESET akumulasi diskon tenant ini sendiri
    // ke 0 — terjadi SETIAP KALI dia top up, berapa pun akumulasinya saat
    // itu (tidak menunggu penuh 5/5), dan (3) konsumsi diskon 2%
    // pendaftar baru kalau masih ada.
    const { error: referralError } = await svc.rpc("process_referral_on_payment", {
      p_tenant_id: payment.tenant_id,
    });
    if (referralError) {
      console.error("process_referral_on_payment failed:", referralError);
    }
  }

  // Midtrans mengharapkan response 200 apa pun hasilnya (selama sudah
  // diproses) — response non-200 akan membuat Midtrans retry notifikasi
  // yang sama berkali-kali.
  return NextResponse.json({ message: "OK" });
}

/**
 * Cabang khusus notifikasi pembayaran pesanan QRIS Self-Order (Phase 4).
 * Ditulis ke tabel `qr_orders` (via RPC mark_qr_order_paid), BUKAN ke
 * `payments`/`subscriptions` seperti webhook langganan di atas.
 */
async function handleQrOrderNotification(body: Record<string, unknown>) {
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body as {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
    transaction_status: string;
    fraud_status?: string;
  };

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
    console.error("Midtrans webhook (QR order): signature tidak cocok untuk order_id", order_id);
    return NextResponse.json({ message: "Invalid signature." }, { status: 403 });
  }

  const qrOrderId = order_id.replace("QRORDER-", "");
  const svc = serviceClient();

  let newStatus: "pending" | "paid" | "failed" = "pending";
  if (transaction_status === "capture" || transaction_status === "settlement") {
    newStatus = !fraud_status || fraud_status === "accept" ? "paid" : "failed";
  } else if (transaction_status === "pending") {
    newStatus = "pending";
  } else if (["deny", "cancel", "expire", "failure"].includes(transaction_status)) {
    newStatus = "failed";
  }

  // mark_qr_order_paid() TIDAK di-grant ke anon/authenticated (lihat
  // migration Phase 4) — hanya bisa dipanggil lewat service role key,
  // persis seperti yang dipakai di sini.
  const { error } = await svc.rpc("mark_qr_order_paid", {
    p_qr_order_id: qrOrderId,
    p_payment_reference: order_id,
    p_status: newStatus,
  });

  if (error) {
    console.error("mark_qr_order_paid gagal:", error);
    return NextResponse.json({ message: "Gagal memperbarui status pesanan." }, { status: 500 });
  }

  return NextResponse.json({ message: "OK" });
}
