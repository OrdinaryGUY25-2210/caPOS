// load-test.js — Uji ketahanan caPOS milik SENDIRI, bukan alat untuk
// menyerang server orang lain. Simulasi trafik BANYAK PENGGUNA WAJAR
// (lonjakan jam ramai kafe), bukan flood/DDoS.
//
// CARA PAKAI:
//   1. Install k6: https://k6.io/docs/get-started/installation/
//   2. Jalankan ke STAGING dulu, jangan langsung ke production:
//        k6 run -e BASE_URL=https://staging-kamu.vercel.app load-test.js
//   3. Kalau staging aman, baru (opsional & hati-hati) ke production di
//      luar jam sibuk kafe beneran:
//        k6 run -e BASE_URL=https://app-kamu.vercel.app load-test.js
//
// Script ini SENGAJA hanya memukul halaman/endpoint yang aman diulang-
// ulang (baca data, render halaman) — TIDAK memukul /api/register atau
// /api/orders/qris-charge berkali-kali, karena itu akan benar-benar bikin
// banyak tenant sampah & transaksi Midtrans sungguhan (kena biaya nyata).
// Kalau mau tes endpoint publik yang sudah di-rate-limit (lihat
// lib/rateLimit.ts), lakukan itu TERPISAH dengan jumlah request KECIL
// (5-10x) hanya untuk pastikan responsnya 429 saat limitnya kena, bukan
// disatukan ke skenario beban besar ini.

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    // Naik bertahap: 0 -> 50 -> 200 pengguna virtual, biar kelihatan di
    // titik mana caPOS mulai lambat/gagal, bukan langsung dihajar penuh.
    ramping_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },   // pemanasan
        { duration: "1m", target: 50 },    // ramai normal
        { duration: "1m", target: 200 },   // simulasi jam sibuk/viral
        { duration: "30s", target: 0 },    // turun lagi
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"], // 95% request harus di bawah 2 detik
    http_req_failed: ["rate<0.05"],     // toleransi gagal < 5%
  },
};

export default function () {
  // 1. Halaman landing / login — representasi trafik umum.
  const home = http.get(`${BASE_URL}/`);
  check(home, { "landing page 200": (r) => r.status === 200 });

  sleep(1);

  // 2. GANTI branch-slug/table-number di bawah dengan meja QR aktif
  //    milikmu sendiri kalau mau simulasikan pelanggan scan QR meja
  //    bersamaan (skenario paling relevan buat "banyak orang masuk
  //    sekaligus" di caPOS). Kalau tidak diisi, baris ini aman diskip.
  // const selfOrder = http.get(`${BASE_URL}/order/GANTI-BRANCH-SLUG/GANTI-NOMOR-MEJA`);
  // check(selfOrder, { "self-order page 200": (r) => r.status === 200 });

  sleep(Math.random() * 2); // jeda acak, meniru perilaku manusia nyata
}
