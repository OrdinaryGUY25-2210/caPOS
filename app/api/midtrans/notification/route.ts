import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PLANS } from "@/lib/midtransPlans";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { createMidtransCoreApi, POS_QRIS_ORDER_PREFIX, mapMidtransTransactionStatus } from "@/lib/midtransCore";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type SupabaseSvc = ReturnType<typeof serviceClient>;

/**
 * migration_023 — kunci dedupe notifikasi. Status + status_code + fraud
 * + gross_amount ikut masuk supaya notifikasi berbeda untuk order yang
 * sama (mis. pending -> settlement) tetap diproses, sementara retry
 * notifikasi yang PERSIS sama tidak diulang (penting: webhook langganan
 * memperpanjang masa aktif setiap kali diproses).
 */
function webhookEventKey(body: Record<string, unknown>): string {
  return [
    String(body.order_id ?? ""),
    String(body.transaction_status ?? ""),
    String(body.status_code ?? ""),
    String(body.fraud_status ?? ""),
    String(body.gross_amount ?? ""),
  ].join("|");
}

/**
 * Klaim event webhook. Mengembalikan null kalau tabel dedupe tidak bisa
 * diakses (migrasi belum dijalankan) — pemanggil tetap memproses supaya
 * pembayaran tidak pernah tertahan gara-gara tabel audit.
 */
async function claimWebhookEvent(
  svc: SupabaseSvc,
  body: Record<string, unknown>
): Promise<{ id: string; alreadyProcessed: boolean } | null> {
  const eventKey = webhookEventKey(body);

  const { data: existing, error: findError } = await svc
    .from("midtrans_webhook_events")
    .select("id, processed")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (findError) {
    console.error("midtrans_webhook_events lookup gagal (dilewati):", findError.message);
    return null;
  }
  if (existing) {
    return { id: existing.id as string, alreadyProcessed: !!existing.processed };
  }

  const { data: created, error: insertError } = await svc
    .from("midtrans_webhook_events")
    .insert({
      event_key: eventKey,
      event_type: (body.notification_type as string) ?? (body.transaction_status as string) ?? null,
      order_id: (body.order_id as string) ?? null,
      transaction_status: (body.transaction_status as string) ?? null,
      status_code: (body.status_code as string) ?? null,
      gross_amount:
        body.gross_amount !== undefined && body.gross_amount !== null && Number.isFinite(Number(body.gross_amount))
          ? Number(body.gross_amount)
          : null,
      payload: body,
    })
    .select("id, processed")
    .single();

  if (insertError) {
    // Race: request lain menyisipkan event yang sama lebih dulu.
    if ((insertError as { code?: string }).code === "23505") {
      const { data: raced } = await svc
        .from("midtrans_webhook_events")
        .select("id, processed")
        .eq("event_key", eventKey)
        .maybeSingle();
      if (raced) return { id: raced.id as string, alreadyProcessed: !!raced.processed };
    }
    console.error("midtrans_webhook_events insert gagal (dilewati):", insertError.message);
    return null;
  }

  return { id: created.id as string, alreadyProcessed: !!created.processed };
}

async function markWebhookEvent(
  svc: SupabaseSvc,
  claim: { id: string } | null,
  processed: boolean,
  errorMessage: string | null = null
) {
  if (!claim) return;
  const { error } = await svc
    .from("midtrans_webhook_events")
    .update({
      processed,
      processed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq("id", claim.id);
  if (error) console.error("midtrans_webhook_events update gagal:", error.message);
}

/** Bandingkan nominal yang kita simpan dengan gross_amount dari Midtrans. */
function amountMatches(expected: unknown, grossAmount: unknown): boolean {
  const a = Number(expected);
  const b = Number(grossAmount);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01;
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

  // BARU — QRIS Dinamis kasir POS (Owner Settings, per-cabang). Order ID
  // selalu diberi prefix "POS-" saat dibuat (lihat app/api/pos/qris-charge).
  // Dicabangkan di sini SEBELUM baris `serverKey` di bawah karena transaksi
  // ini TIDAK memakai MIDTRANS_SERVER_KEY platform sama sekali — signature-nya
  // wajib dicocokkan pakai Server Key milik cabang yang membuat charge ini.
  if (typeof order_id === "string" && order_id.startsWith(POS_QRIS_ORDER_PREFIX)) {
    return handlePosQrisNotification(body);
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

  // migration_023 — JANGAN pernah mempercayai nominal dari notifikasi.
  // Signature hanya membuktikan pengirimnya Midtrans, bukan bahwa nominal
  // yang diklaim sama dengan tagihan yang kita simpan.
  if (!amountMatches(payment.amount, gross_amount)) {
    console.error(
      "Midtrans webhook: gross_amount tidak cocok dengan payments.amount",
      { order_id, gross_amount, expected: payment.amount }
    );
    const mismatchClaim = await claimWebhookEvent(svc, body);
    await markWebhookEvent(svc, mismatchClaim, true, "AMOUNT_MISMATCH");
    return NextResponse.json({ message: "OK (nominal tidak cocok, status tidak diubah)" });
  }

  const claim = await claimWebhookEvent(svc, body);
  if (claim?.alreadyProcessed) {
    return NextResponse.json({ message: "OK (sudah diproses)" });
  }

  const wasPaid = payment.status === "paid";
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

  // Notifikasi bisa datang tidak berurutan (settlement dulu, baru retry
  // "pending" yang tertinggal). Status `paid` bersifat FINAL: jangan pernah
  // menurunkannya ke pending/failed hanya karena notifikasi lama/terlambat,
  // supaya pembayaran sah tidak "hilang" dari laporan.
  if (payment.status === "paid") {
    newStatus = "paid";
  }

  const { error: updateError } = await svc
    .from("payments")
    .update({ status: newStatus, raw_response: body, updated_at: new Date().toISOString() })
    .eq("order_id", order_id);

  if (updateError) {
    await markWebhookEvent(svc, claim, false, "PAYMENT_UPDATE_FAILED: " + updateError.message);
    return NextResponse.json({ message: "Gagal memperbarui status pembayaran." }, { status: 500 });
  }

  // Perpanjang langganan HANYA SEKALI per baris `payments`. Penanda
  // `subscription_granted_at` membuat proses ini tahan retry: kalau
  // percobaan pertama sempat mengubah payment.status menjadi 'paid' tetapi
  // gagal saat update langganan, notifikasi retry tetap bisa melanjutkan
  // perpanjangan (kalau hanya mengandalkan "sebelumnya belum paid", retry
  // itu akan dilewati dan langganan tidak pernah diperpanjang).
  if (newStatus === "paid") {
    let grantClaimed = false;
    let markerError: string | null = null;

    const { data: grantRows, error: grantError } = await svc
      .from("payments")
      .update({ subscription_granted_at: new Date().toISOString() })
      .eq("id", payment.id)
      .is("subscription_granted_at", null)
      .select("id");

    if (grantError) {
      if (grantError.message.includes("subscription_granted_at")) {
        // Migrasi 023 belum diterapkan — pakai guard lama agar webhook
        // tetap berfungsi (hanya kurang tahan retry).
        grantClaimed = !wasPaid;
      } else {
        markerError = grantError.message;
      }
    } else {
      grantClaimed = (grantRows?.length ?? 0) > 0;
    }

    if (markerError) {
      await markWebhookEvent(svc, claim, false, "SUBSCRIPTION_MARKER_FAILED: " + markerError);
      return NextResponse.json({ message: "Gagal menandai perpanjangan langganan." }, { status: 500 });
    }

    if (grantClaimed) {
      const plan = PLANS[payment.plan as keyof typeof PLANS];
      const days = plan?.days ?? 30;

      const { error: subError } = await svc
        .from("subscriptions")
        .update({
          status: "active",
          plan: payment.plan,
          valid_until: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", payment.tenant_id);

      if (subError) {
        // Lepas penanda supaya retry berikutnya bisa mencoba lagi.
        await svc.from("payments").update({ subscription_granted_at: null }).eq("id", payment.id);
        await markWebhookEvent(svc, claim, false, "SUBSCRIPTION_UPDATE_FAILED: " + subError.message);
        return NextResponse.json({ message: "Gagal memperbarui langganan." }, { status: 500 });
      }

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
  }

  await markWebhookEvent(svc, claim, true, null);

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

  const { data: qrOrder } = await svc
    .from("qr_orders")
    .select("id, total_amount, payment_status")
    .eq("id", qrOrderId)
    .single();

  if (!qrOrder) {
    console.warn("Midtrans webhook (QR order): qr_order tidak ditemukan:", qrOrderId);
    return NextResponse.json({ message: "OK (order_id tidak dikenali, notifikasi diabaikan)" });
  }

  // migration_023 — validasi nominal: total_amount dihitung server saat
  // order dibuat, gross_amount dari Midtrans tidak boleh berbeda.
  if (!amountMatches(qrOrder.total_amount, gross_amount)) {
    console.error("Midtrans webhook (QR order): gross_amount tidak cocok", {
      order_id,
      gross_amount,
      expected: qrOrder.total_amount,
    });
    const mismatchClaim = await claimWebhookEvent(svc, body);
    await markWebhookEvent(svc, mismatchClaim, true, "AMOUNT_MISMATCH");
    return NextResponse.json({ message: "OK (nominal tidak cocok, status tidak diubah)" });
  }

  const claim = await claimWebhookEvent(svc, body);
  if (claim?.alreadyProcessed) {
    return NextResponse.json({ message: "OK (sudah diproses)" });
  }

  let newStatus: "pending" | "paid" | "failed" = "pending";
  if (transaction_status === "capture" || transaction_status === "settlement") {
    newStatus = !fraud_status || fraud_status === "accept" ? "paid" : "failed";
  } else if (transaction_status === "pending") {
    newStatus = "pending";
  } else if (["deny", "cancel", "expire", "failure"].includes(transaction_status)) {
    newStatus = "failed";
  }

  // Lihat catatan di handler pembayaran langganan: status paid bersifat
  // final. Notifikasi pending/failed yang datang terlambat tidak boleh
  // menurunkan order yang sudah lunas.
  if (qrOrder.payment_status === "paid") {
    newStatus = "paid";
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
    await markWebhookEvent(svc, claim, false, "MARK_QR_ORDER_FAILED: " + error.message);
    return NextResponse.json({ message: "Gagal memperbarui status pesanan." }, { status: 500 });
  }

  await markWebhookEvent(svc, claim, true, null);
  return NextResponse.json({ message: "OK" });
}

/**
 * Cabang khusus notifikasi QRIS Dinamis kasir POS (Owner Settings).
 * TERISOLASI TOTAL dari langganan platform & QRORDER-: ditulis ke tabel
 * `pos_qris_payments` yang baru, dan signature-nya diverifikasi memakai
 * `branches.midtrans_server_key` milik CABANG PEMILIK transaksi ini
 * (dilihat dari order_id -> baris pos_qris_payments -> branch_id), bukan
 * MIDTRANS_SERVER_KEY platform — karena tiap cabang punya key sendiri.
 */
async function handlePosQrisNotification(body: Record<string, unknown>) {
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body as {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
    transaction_status: string;
    fraud_status?: string;
  };

  const svc = serviceClient();

  const { data: payment } = await svc
    .from("pos_qris_payments")
    .select("id, branch_id, status, gross_amount")
    .eq("order_id", order_id)
    .single();

  if (!payment) {
    // Sama seperti webhook langganan di atas — tetap balas 200 (bisa jadi
    // tombol "Test notification URL" dashboard Midtrans, atau race
    // condition insert baris pending yang belum selesai).
    console.warn("Midtrans webhook (POS QRIS): order_id tidak ditemukan di pos_qris_payments:", order_id);
    return NextResponse.json({ message: "OK (order_id tidak dikenali, notifikasi diabaikan)" });
  }

  const { data: branch } = await svc
    .from("branches")
    .select("midtrans_server_key, midtrans_is_production")
    .eq("id", payment.branch_id)
    .single();

  if (!branch?.midtrans_server_key) {
    console.error("Midtrans webhook (POS QRIS): cabang", payment.branch_id, "tidak lagi punya server key.");
    return NextResponse.json({ message: "Server misconfigured." }, { status: 500 });
  }

  // isProduction tidak berpengaruh ke perhitungan signature (cuma dipakai
  // untuk memilih base URL charge/status), tapi tetap diisi benar untuk
  // konsistensi kalau nanti core.getStatus() dipanggil dari sini juga.
  const core = createMidtransCoreApi({ serverKey: branch.midtrans_server_key, isProduction: !!branch.midtrans_is_production });
  const validSignature = core.verifySignature({
    orderId: order_id,
    statusCode: status_code,
    grossAmount: gross_amount,
    signatureKey: signature_key,
  });

  if (!validSignature) {
    console.error("Midtrans webhook (POS QRIS): signature tidak cocok untuk order_id", order_id);
    return NextResponse.json({ message: "Invalid signature." }, { status: 403 });
  }

  // migration_023 — nominal charge POS QRIS disimpan saat charge dibuat.
  if (!amountMatches(payment.gross_amount, gross_amount)) {
    console.error("Midtrans webhook (POS QRIS): gross_amount tidak cocok", {
      order_id,
      gross_amount,
      expected: payment.gross_amount,
    });
    const mismatchClaim = await claimWebhookEvent(svc, body);
    await markWebhookEvent(svc, mismatchClaim, true, "AMOUNT_MISMATCH");
    return NextResponse.json({ message: "OK (nominal tidak cocok, status tidak diubah)" });
  }

  const claim = await claimWebhookEvent(svc, body);
  if (claim?.alreadyProcessed) {
    return NextResponse.json({ message: "OK (sudah diproses)" });
  }

  let newStatus: "pending" | "paid" | "failed" | "expired" = payment.status;
  newStatus = mapMidtransTransactionStatus(transaction_status, fraud_status, payment.status);

  // Status paid bersifat final; notifikasi pending/expired/failed yang
  // datang terlambat tidak boleh menurunkan QRIS yang sudah lunas.
  if (payment.status === "paid") {
    newStatus = "paid";
  }

  const { error: updateError } = await svc
    .from("pos_qris_payments")
    .update({ status: newStatus, raw_response: body })
    .eq("id", payment.id);

  if (updateError) {
    await markWebhookEvent(svc, claim, false, "POS_QRIS_UPDATE_FAILED: " + updateError.message);
    return NextResponse.json({ message: "Gagal memperbarui status QRIS." }, { status: 500 });
  }

  await markWebhookEvent(svc, claim, true, null);
  return NextResponse.json({ message: "OK" });
}
