// Harga & durasi paket — dipakai oleh app/api/midtrans/create-transaction
// dan app/api/midtrans/notification supaya nilainya selalu konsisten di
// kedua tempat (bikin transaksi vs. menentukan berapa lama perpanjangan
// setelah dibayar).
export const PLANS = {
  monthly: { label: "Bulanan", amount: 100000, days: 30 },
  yearly: { label: "Tahunan", amount: 850000, days: 365 },
} as const;

export type PlanKey = keyof typeof PLANS;
