/**
 * Factory Midtrans Core API yang TERISOLASI dari alur langganan platform.
 *
 * Alur langganan (app/api/midtrans/create-transaction, .../notification)
 * SELALU pakai `process.env.MIDTRANS_SERVER_KEY` milik platform dan TIDAK
 * memanggil apa pun di file ini. File ini KHUSUS untuk QRIS Dinamis kasir
 * POS (app/api/pos/qris-charge) yang kredensialnya datang DINAMIS dari
 * kolom `branches.midtrans_*` milik masing-masing owner — jadi jangan
 * pernah menyimpan/menimpa instance global di sini, tiap panggilan harus
 * membuat instance baru dari config yang diberikan (lihat createMidtransCoreApi).
 */

export interface MidtransBranchConfig {
  serverKey: string;
  clientKey?: string | null;
  merchantId?: string | null;
  isProduction: boolean;
}

export interface MidtransChargeQrisParams {
  orderId: string;
  grossAmount: number;
}

export interface MidtransChargeResult {
  ok: boolean;
  /** URL gambar QR (actions[].name === "generate-qr-code") kalau sukses. */
  qrUrl: string | null;
  transactionId: string | null;
  transactionStatus: string | null;
  raw: any;
}

function baseUrlFor(isProduction: boolean) {
  return isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}

/**
 * Buat instance Core API baru dari kredensial SATU cabang. Tidak menyentuh
 * env var apa pun milik platform, tidak mempertahankan state antar
 * panggilan — aman dipanggil berkali-kali dengan config cabang berbeda
 * dalam request yang sama (mis. dari webhook yang memproses banyak notif).
 */
export function createMidtransCoreApi(config: MidtransBranchConfig) {
  if (!config.serverKey) {
    throw new Error("Midtrans server key kosong — cabang ini belum dikonfigurasi.");
  }

  const authHeader = "Basic " + Buffer.from(`${config.serverKey}:`).toString("base64");
  const baseUrl = baseUrlFor(config.isProduction);

  return {
    /** Buat charge QRIS Dinamis (Core API `/v2/charge`), dipakai kasir POS. */
    async chargeQris({ orderId, grossAmount }: MidtransChargeQrisParams): Promise<MidtransChargeResult> {
      const res = await fetch(`${baseUrl}/v2/charge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          payment_type: "qris",
          transaction_details: {
            order_id: orderId,
            gross_amount: Math.round(grossAmount),
          },
          qris: { acquirer: "gopay" },
        }),
      });

      const raw = await res.json().catch(() => null);
      const qrAction = (raw?.actions || []).find((a: any) => a.name === "generate-qr-code");

      return {
        ok: res.ok && !!raw,
        qrUrl: qrAction?.url ?? null,
        transactionId: raw?.transaction_id ?? null,
        transactionStatus: raw?.transaction_status ?? null,
        raw,
      };
    },

    /** Cek status transaksi terbaru (Core API `/v2/{order_id}/status`) — dipakai untuk polling dari POS kalau webhook belum masuk. */
    async getStatus(orderId: string): Promise<{ ok: boolean; transactionStatus: string | null; fraudStatus: string | null; raw: any }> {
      const res = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      const raw = await res.json().catch(() => null);
      return {
        ok: res.ok && !!raw,
        transactionStatus: raw?.transaction_status ?? null,
        fraudStatus: raw?.fraud_status ?? null,
        raw,
      };
    },

    /** Hitung signature SHA-512 notifikasi webhook memakai server key CABANG INI (bukan key platform). */
    verifySignature(params: { orderId: string; statusCode: string; grossAmount: string; signatureKey: string }) {
      const crypto = require("crypto") as typeof import("crypto");
      const expected = crypto
        .createHash("sha512")
        .update(`${params.orderId}${params.statusCode}${params.grossAmount}${config.serverKey}`)
        .digest("hex");
      return expected === params.signatureKey;
    },
  };
}

/** Prefix order_id khusus QRIS Dinamis kasir POS — dipakai untuk cabang di notification webhook & untuk membedakan dari "CAPOS-" (langganan) dan "QRORDER-" (self-order pelanggan). */
export const POS_QRIS_ORDER_PREFIX = "POS-";

/**
 * QRIS Dinamis Midtrans (Core API) defaultnya kedaluwarsa 5 menit sejak
 * dibuat kalau tidak ditentukan `custom_expiry` sendiri (kita tidak
 * mengirim itu di chargeQris() di atas, jadi ini nilai default Midtrans).
 * Dipakai app/api/pos/qris-status untuk tahu kapan boleh berhenti
 * menganggap sebuah charge yang masih "pending" itu mungkin sudah
 * kedaluwarsa di sisi Midtrans, dan perlu dicek ulang lewat getStatus().
 */
export const POS_QRIS_DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

/** Terjemahkan `transaction_status`/`fraud_status` Midtrans ke status internal kita — dipakai sama di webhook & polling status supaya logikanya tidak dobel-tulis beda tempat. */
export function mapMidtransTransactionStatus(
  transactionStatus: string | null | undefined,
  fraudStatus?: string | null,
  fallback: "pending" | "paid" | "failed" | "expired" = "pending"
): "pending" | "paid" | "failed" | "expired" {
  if (transactionStatus === "capture" || transactionStatus === "settlement") {
    return !fraudStatus || fraudStatus === "accept" ? "paid" : "failed";
  }
  if (transactionStatus === "pending") return "pending";
  if (transactionStatus === "expire") return "expired";
  if (["deny", "cancel", "failure"].includes(transactionStatus ?? "")) return "failed";
  return fallback;
}
